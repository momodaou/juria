// JURIA — fonds de tiers (compte CARPA du cabinet), 20/10/2026.
// Sommes reçues pour le compte de clients et destinées à les désintéresser :
// ce ne sont pas des honoraires. Réception (+), reversement au client (−),
// imputation d'honoraires (−, avec l'accord du client : crée un paiement sur la
// facture). Le solde est calculé sur les mouvements valides, jamais saisi.
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const { logAudit } = require("../audit");
const { MOYENS, DECAISSEMENT, comptesEligibles, preparerReglement, preparerDecaissement, referenceCourte } = require("../moyensPaiement");
const { majStatut } = require("./factures");
const router = express.Router();

const MOYENS_RECEPTION = ["virement", "virement_etranger", "cheque", "especes", "western_union", "moneygram"];
const MOYENS_REVERSEMENT = ["virement", "cheque"];
const CARPA = ["carpa"];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const aujourdhui = () => new Date().toISOString().slice(0, 10);

const SOLDE = "COALESCE(SUM(CASE WHEN type = 'reception' THEN montant ELSE -montant END), 0)::bigint";
async function solde(db, clientId, dossierId = null) {
  const params = [clientId];
  let filtre = "";
  if (dossierId) { params.push(dossierId); filtre = " AND dossier_id = $2"; }
  const { rows: [r] } = await db.query(`SELECT ${SOLDE} AS solde FROM fonds_tiers_mouvements WHERE client_id = $1 AND statut = 'valide'${filtre}`, params);
  return Number(r.solde);
}

// Valide client / dossier / montant / date communs aux trois mouvements.
async function validerBase(db, b) {
  const montant = Math.round(Number(b.montant));
  if (!(montant > 0)) return { erreur: "Le montant doit être positif." };
  const date = b.date_mouvement || aujourdhui();
  if (!DATE.test(String(date)) || new Date(date) > new Date()) return { erreur: "Date invalide (ni vide, ni dans le futur)." };
  if (!b.client_id) return { erreur: "Le client est requis." };
  const { rows: [c] } = await db.query("SELECT id FROM clients WHERE id = $1", [b.client_id]);
  if (!c) return { erreur: "Client introuvable." };
  let dossierId = null;
  if (b.dossier_id) {
    const { rows: [d] } = await db.query("SELECT id FROM dossiers WHERE id = $1 AND client_id = $2", [b.dossier_id, b.client_id]);
    if (!d) return { erreur: "Ce dossier n'appartient pas à ce client." };
    dossierId = d.id;
  }
  return { montant, date, clientId: b.client_id, dossierId };
}

// Exécute `corps(client)` dans une transaction qui verrouille le client (soldes sans course).
async function transactionClient(clientId, corps) {
  const cnx = await pool.connect();
  try {
    await cnx.query("BEGIN");
    await cnx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(clientId)]);
    const r = await corps(cnx);
    if (r && r.erreur) { await cnx.query("ROLLBACK"); return r; }
    await cnx.query("COMMIT");
    return r;
  } catch (e) {
    await cnx.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    cnx.release();
  }
}

const reponse = (res, r, ok = 201) => (r.erreur ? res.status(r.statut || 400).json({ error: r.erreur }) : res.status(ok).json(r));

// GET /api/fonds-tiers/comptes — comptes CARPA actifs.
router.get("/comptes", requirePermission("fonds_tiers.consulter"), async (req, res) => {
  try { res.json(await comptesEligibles(pool, {}, { types: CARPA })); }
  catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// GET /api/fonds-tiers/moyens/:sens — moyens admis (reception | reversement) et leurs références.
router.get("/moyens/:sens", requirePermission("fonds_tiers.consulter"), (req, res) => {
  const reception = req.params.sens === "reception";
  if (!reception && req.params.sens !== "reversement") return res.status(404).json({ error: "Sens inconnu" });
  const source = reception ? MOYENS.filter((m) => MOYENS_RECEPTION.includes(m.code)) : DECAISSEMENT.filter((m) => MOYENS_REVERSEMENT.includes(m.code));
  res.json(source.map((m) => ({ code: m.code, libelle: m.libelle, famille: m.famille, frais: false, champs: m.champs })));
});

// GET /api/fonds-tiers/soldes — une ligne par client (et par dossier le cas échéant).
router.get("/soldes", requirePermission("fonds_tiers.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.client_id, COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client,
              m.dossier_id, d.numero AS dossier_numero, d.intitule AS dossier_intitule,
              COALESCE(SUM(CASE WHEN m.type = 'reception' THEN m.montant END), 0)::bigint AS recu,
              COALESCE(SUM(CASE WHEN m.type <> 'reception' THEN m.montant END), 0)::bigint AS sorti,
              ${SOLDE.replace(/type/g, "m.type").replace(/montant/g, "m.montant")} AS solde,
              MAX(m.date_mouvement) AS dernier
       FROM fonds_tiers_mouvements m
       JOIN clients c ON c.id = m.client_id
       LEFT JOIN dossiers d ON d.id = m.dossier_id
       WHERE m.statut = 'valide'
       GROUP BY m.client_id, c.denomination, c.prenom, c.nom, m.dossier_id, d.numero, d.intitule
       ORDER BY client, d.numero NULLS FIRST`
    );
    res.json(rows.map((r) => ({ ...r, recu: Number(r.recu), sorti: Number(r.sorti), solde: Number(r.solde) })));
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// GET /api/fonds-tiers/mouvements?client_id=&dossier_id=
router.get("/mouvements", requirePermission("fonds_tiers.consulter"), async (req, res) => {
  const params = []; const clauses = [];
  if (req.query.client_id) { params.push(req.query.client_id); clauses.push(`m.client_id = $${params.length}::uuid`); }
  if (req.query.dossier_id) { params.push(req.query.dossier_id); clauses.push(`m.dossier_id = $${params.length}::uuid`); }
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.type, m.client_id, COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client,
              m.dossier_id, d.numero AS dossier_numero, m.montant, m.date_mouvement, m.mode, m.compte_id, cb.intitule AS compte,
              m.references_paiement, m.tiers, m.motif, m.facture_id, f.numero AS facture_numero, m.statut, m.annule_motif, m.annule_le,
              u.prenom || ' ' || u.nom AS auteur, m.cree_le
       FROM fonds_tiers_mouvements m
       JOIN clients c ON c.id = m.client_id
       LEFT JOIN dossiers d ON d.id = m.dossier_id
       LEFT JOIN comptes_bancaires cb ON cb.id = m.compte_id
       LEFT JOIN factures f ON f.id = m.facture_id
       LEFT JOIN utilisateurs u ON u.id = m.cree_par
       ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""}
       ORDER BY m.date_mouvement DESC, m.cree_le DESC LIMIT 300`, params);
    res.json(rows.map((r) => ({ ...r, montant: Number(r.montant) })));
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/fonds-tiers/receptions
// { client_id, dossier_id?, montant, date_mouvement?, mode, compte_id?, references?, tiers? (payeur), motif? }
router.post("/receptions", requirePermission("fonds_tiers.enregistrer"), async (req, res) => {
  const b = req.body || {};
  try {
    const base = await validerBase(pool, b);
    if (base.erreur) return res.status(400).json({ error: base.erreur });
    if (!MOYENS_RECEPTION.includes(b.mode)) return res.status(400).json({ error: "Moyen de paiement non admis pour une réception sur la CARPA." });
    const regl = await preparerReglement(pool, { ...b, frais_retenus: undefined }, { montant: base.montant, types: CARPA });
    if (regl.erreur) return res.status(400).json({ error: regl.erreur });
    let compteId = regl.valeurs.compte_id;
    if (!compteId) {
      const carpa = await comptesEligibles(pool, {}, { types: CARPA });
      if (carpa.length === 1) compteId = carpa[0].id;
      else return res.status(400).json({ error: carpa.length ? "Précisez le compte CARPA qui reçoit les fonds." : "Aucun compte CARPA enregistré : créez-le dans Accès & permissions → Comptes du cabinet." });
    }
    const r = await transactionClient(base.clientId, async (cnx) => {
      const { rows: [m] } = await cnx.query(
        `INSERT INTO fonds_tiers_mouvements (type, client_id, dossier_id, montant, date_mouvement, mode, compte_id, references_paiement, tiers, motif, cree_par)
         VALUES ('reception',$1,$2,$3,$4::date,$5::mode_paiement,$6::uuid,$7::jsonb,$8,$9,$10) RETURNING id`,
        [base.clientId, base.dossierId, base.montant, base.date, b.mode, compteId, JSON.stringify(regl.valeurs.references), b.tiers || null, b.motif || null, req.user.sub]);
      return { id: m.id, solde: await solde(cnx, base.clientId, base.dossierId) };
    });
    if (!r.erreur) await logAudit({ utilisateurId: req.user.sub, action: "fonds_tiers_reception", entite: "fonds_tiers", entiteId: r.id, details: { client_id: base.clientId, montant: base.montant, mode: b.mode }, ip: req.ip });
    reponse(res, r);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/fonds-tiers/reversements
// { client_id, dossier_id?, montant, date_mouvement?, mode (virement|cheque), compte_id?, references?, tiers? (bénéficiaire), motif? }
router.post("/reversements", requirePermission("fonds_tiers.reverser"), async (req, res) => {
  const b = req.body || {};
  try {
    const base = await validerBase(pool, b);
    if (base.erreur) return res.status(400).json({ error: base.erreur });
    if (!MOYENS_REVERSEMENT.includes(b.mode_paiement || b.mode)) return res.status(400).json({ error: "Un reversement se fait par virement ou par chèque." });
    const regl = await preparerDecaissement(pool, { mode_paiement: b.mode_paiement || b.mode, compte_id: b.compte_id, references: b.references }, { exigerReferences: true, types: CARPA });
    if (regl.erreur) return res.status(400).json({ error: regl.erreur });
    let compteId = regl.valeurs.compte_id;
    if (!compteId) {
      const carpa = await comptesEligibles(pool, {}, { types: CARPA });
      if (carpa.length === 1) compteId = carpa[0].id;
      else return res.status(400).json({ error: "Précisez le compte CARPA débité." });
    }
    const r = await transactionClient(base.clientId, async (cnx) => {
      const disponible = await solde(cnx, base.clientId, base.dossierId);
      if (base.montant > disponible) return { erreur: `Solde insuffisant : ${disponible} FCFA disponibles${base.dossierId ? " pour ce dossier" : ""}.`, statut: 409 };
      const { rows: [m] } = await cnx.query(
        `INSERT INTO fonds_tiers_mouvements (type, client_id, dossier_id, montant, date_mouvement, mode, compte_id, references_paiement, tiers, motif, cree_par)
         VALUES ('reversement',$1,$2,$3,$4::date,$5::mode_paiement,$6::uuid,$7::jsonb,$8,$9,$10) RETURNING id`,
        [base.clientId, base.dossierId, base.montant, base.date, regl.valeurs.mode_paiement, compteId, JSON.stringify(regl.valeurs.references), b.tiers || null, b.motif || null, req.user.sub]);
      return { id: m.id, solde: disponible - base.montant };
    });
    if (!r.erreur) await logAudit({ utilisateurId: req.user.sub, action: "fonds_tiers_reversement", entite: "fonds_tiers", entiteId: r.id, details: { client_id: base.clientId, montant: base.montant }, ip: req.ip });
    reponse(res, r);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/fonds-tiers/imputations
// { client_id, dossier_id?, facture_id, montant, date_mouvement?, compte_id (compte de fonctionnement qui reçoit),
//   numero_operation?, motif? } — avec l'accord du client : crée un paiement sur la facture.
router.post("/imputations", requirePermission("fonds_tiers.reverser"), async (req, res) => {
  const b = req.body || {};
  try {
    const base = await validerBase(pool, b);
    if (base.erreur) return res.status(400).json({ error: base.erreur });
    if (!b.facture_id) return res.status(400).json({ error: "La facture à régler est requise." });
    const dest = await pool.query("SELECT id FROM comptes_bancaires WHERE id = $1 AND actif = TRUE AND type = 'fonctionnement'", [b.compte_id]);
    if (!dest.rows[0]) return res.status(400).json({ error: "Choisissez le compte de fonctionnement qui reçoit les honoraires." });
    const r = await transactionClient(base.clientId, async (cnx) => {
      const { rows: [f] } = await cnx.query(
        `SELECT f.id, f.statut, f.devise, f.montant_ttc, f.client_id,
                COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.facture_id = f.id), 0) AS regle
         FROM factures f WHERE f.id = $1`, [b.facture_id]);
      if (!f || f.client_id !== base.clientId) return { erreur: "Cette facture n'appartient pas à ce client.", statut: 400 };
      if (f.statut === "annulee") return { erreur: "Facture annulée : imputation impossible.", statut: 409 };
      if (f.devise !== "XOF") return { erreur: "Les fonds de tiers s'imputent sur une facture en FCFA.", statut: 400 };
      const reliquat = Number(f.montant_ttc) - Number(f.regle);
      if (base.montant > reliquat) return { erreur: `Le montant dépasse le reliquat de la facture (${reliquat}).`, statut: 409 };
      const disponible = await solde(cnx, base.clientId, base.dossierId);
      if (base.montant > disponible) return { erreur: `Solde insuffisant : ${disponible} FCFA disponibles${base.dossierId ? " pour ce dossier" : ""}.`, statut: 409 };
      const refs = { origine: "fonds_tiers" };
      if (b.numero_operation) refs.numero_operation = String(b.numero_operation).trim();
      const { rows: [p] } = await cnx.query(
        `INSERT INTO paiements (facture_id, montant, mode, date_paiement, reference, devise, taux_applique, montant_xof,
                                compte_id, references_paiement, frais_retenus, montant_verse, frais_a_charge)
         VALUES ($1,$2,'virement',$3::date,$4,'XOF',1,$2,$5::uuid,$6::jsonb,0,$2,'cabinet') RETURNING id`,
        [f.id, base.montant, base.date, refs.numero_operation || "Imputation fonds de tiers (CARPA)", b.compte_id, JSON.stringify(refs)]);
      const { rows: [m] } = await cnx.query(
        `INSERT INTO fonds_tiers_mouvements (type, client_id, dossier_id, montant, date_mouvement, mode, compte_id, references_paiement, motif, facture_id, paiement_id, cree_par)
         VALUES ('imputation',$1,$2,$3,$4::date,'virement',$5::uuid,$6::jsonb,$7,$8,$9,$10) RETURNING id`,
        [base.clientId, base.dossierId, base.montant, base.date, b.compte_id, JSON.stringify(refs), b.motif || null, f.id, p.id, req.user.sub]);
      return { id: m.id, paiement_id: p.id, facture_id: f.id, solde: disponible - base.montant };
    });
    if (!r.erreur) {
      const statutFacture = await majStatut(r.facture_id);
      await logAudit({ utilisateurId: req.user.sub, action: "fonds_tiers_imputation", entite: "fonds_tiers", entiteId: r.id, details: { client_id: base.clientId, montant: base.montant, facture_id: r.facture_id }, ip: req.ip });
      return res.status(201).json({ ...r, statut_facture: statutFacture });
    }
    reponse(res, r);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/fonds-tiers/:id/annuler { motif } — annulation tracée d'un mouvement valide.
// Une réception n'est annulable que si le solde reste positif ; une imputation retire
// le paiement correspondant de la facture (refusé si une rétrocession a déjà été décaissée).
router.post("/:id/annuler", requirePermission("fonds_tiers.reverser"), async (req, res) => {
  const motif = String((req.body || {}).motif || "").trim();
  if (!motif) return res.status(400).json({ error: "Le motif d'annulation est obligatoire." });
  try {
    const { rows: [m0] } = await pool.query("SELECT client_id FROM fonds_tiers_mouvements WHERE id = $1", [req.params.id]);
    if (!m0) return res.status(404).json({ error: "Mouvement introuvable" });
    const r = await transactionClient(m0.client_id, async (cnx) => {
      const { rows: [m] } = await cnx.query("SELECT * FROM fonds_tiers_mouvements WHERE id = $1 FOR UPDATE", [req.params.id]);
      if (m.statut !== "valide") return { erreur: "Ce mouvement est déjà annulé.", statut: 409 };
      if (m.type === "reception") {
        const apresClient = (await solde(cnx, m.client_id)) - Number(m.montant);
        const apresDossier = m.dossier_id ? (await solde(cnx, m.client_id, m.dossier_id)) - Number(m.montant) : 0;
        if (apresClient < 0 || apresDossier < 0) return { erreur: "Annulation impossible : des reversements ou imputations ont déjà utilisé ces fonds.", statut: 409 };
      }
      if (m.type === "imputation" && m.paiement_id) {
        const { rows: [retro] } = await cnx.query("SELECT 1 FROM retrocessions WHERE facture_id = $1 AND statut = 'decaissee' LIMIT 1", [m.facture_id]);
        if (retro) return { erreur: "Une rétrocession liée à cette facture a déjà été décaissée sur la base de cet encaissement : annulation refusée.", statut: 409 };
        await cnx.query("UPDATE fonds_tiers_mouvements SET paiement_id = NULL WHERE id = $1", [m.id]);
        await cnx.query("DELETE FROM paiements WHERE id = $1", [m.paiement_id]);
      }
      await cnx.query("UPDATE fonds_tiers_mouvements SET statut = 'annule', annule_motif = $2, annule_par = $3, annule_le = now() WHERE id = $1", [m.id, motif, req.user.sub]);
      return { id: m.id, type: m.type, facture_id: m.facture_id, solde: await solde(cnx, m.client_id) };
    });
    if (!r.erreur) {
      if (r.type === "imputation" && r.facture_id) await majStatut(r.facture_id);
      await logAudit({ utilisateurId: req.user.sub, action: "fonds_tiers_annulation", entite: "fonds_tiers", entiteId: r.id, details: { motif, type: r.type }, ip: req.ip });
      return res.json(r);
    }
    reponse(res, r, 200);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

module.exports = router;
