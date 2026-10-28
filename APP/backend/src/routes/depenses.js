// JURIA — Dépenses & caisse : charges fixes/ponctuelles avec circuit de
// validation (soumise → validée/rejetée → décaissée), petite caisse,
// comptes du cabinet, vignettes de plaidoirie (stock).
const express = require("express");
const { pool } = require("../db");
const multer = require("multer");
const { parserNumeros } = require("../vignettesNumeros");
const { saveObject, readObject, deleteObject, FichierIntrouvableError, enteteContentDisposition } = require("../storage");
const { filtreTypeFichier } = require("../uploadFilter");
const { logAudit } = require("../audit");
const { DECAISSEMENT, DECAISSEMENT_PAR_CODE, comptesEligibles, preparerDecaissement } = require("../moyensPaiement");
const { requirePermission, estAutorise } = require("../permissions");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 }, fileFilter: filtreTypeFichier });
const router = express.Router();

// Nature d'une dépense (16/10/2026) : « dossier » (charge liée à une
// procédure — dossier obligatoire) ou « cabinet » (fonctionnement propre du
// cabinet — jamais de dossier). Déduite du dossier_id si non fournie, pour
// rester compatible avec les appelants antérieurs.
function resoudreNature(b, existant) {
  const nature = b.nature || (b.dossier_id ? "dossier" : existant ? existant.nature : "cabinet");
  if (!["dossier", "cabinet"].includes(nature)) return { erreur: "nature invalide (dossier ou cabinet)." };
  const dossierId = nature === "cabinet" ? null : (b.dossier_id || (existant && existant.dossier_id) || null);
  if (nature === "dossier" && !dossierId) return { erreur: "Une charge liée à un dossier doit préciser le dossier." };
  return { nature, dossierId };
}

// GET /api/depenses?type=&statut=&dossier_id=&petite_caisse=&a_refacturer=
// Liste des dépenses du cabinet — donnée financière, pas juste une commodité
// de suivi personnel (contrairement aux rétrocessions/bulletins, une dépense
// n'a pas de « propriétaire » au sens rémunération) : gardée entièrement
// derrière depenses.consulter, sans exception pour ses propres soumissions
// — y compris pour le filtre a_refacturer (alimente le panneau « Facturer
// les temps / débours » de l'écran Facturation, réservé aux mêmes profils).
// a_refacturer=true : ne renvoie que les dépenses réellement décaissées,
// marquées refacturables au client, pas encore rattachées à une facture
// (diagnostic Facturation, 25/08/2026 — d.facture_id, prévu au schéma sous
// une autre forme (avance_pour_client/refacture) mais jamais câblé, cf.
// HISTORY.md).
router.get("/", requirePermission("depenses.consulter"), async (req, res) => {
  const { type, statut, dossier_id, petite_caisse, a_refacturer, nature } = req.query;
  const params = [];
  const clauses = [];
  if (type) { params.push(type); clauses.push(`d.type = $${params.length}::type_depense`); }
  if (statut) { params.push(statut); clauses.push(`d.statut = $${params.length}::statut_depense`); }
  if (dossier_id) { params.push(dossier_id); clauses.push(`d.dossier_id = $${params.length}`); }
  if (nature) { params.push(nature); clauses.push(`d.nature = $${params.length}`); }
  if (petite_caisse !== undefined) { params.push(petite_caisse === "true"); clauses.push(`d.petite_caisse = $${params.length}`); }
  if (a_refacturer === "true") {
    clauses.push("d.refacturable_client = TRUE", "d.statut = 'decaissee'", "d.facture_id IS NULL");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.type, d.categorie, d.libelle, d.montant, d.date_depense, d.mode_paiement, d.references_paiement,
              d.petite_caisse, d.justificatif, d.refacturable_client, d.statut, d.recurrente,
              d.facture_id, d.dossier_id, d.nature, d.beneficiaire, c.intitule AS compte,
              (SELECT COUNT(*) FROM depense_pieces p WHERE p.depense_id = d.id)::int AS nb_pieces,
              (SELECT COUNT(*) FROM depense_pieces p WHERE p.depense_id = d.id AND p.type = 'devis')::int AS nb_devis,
              EXISTS (SELECT 1 FROM depense_pieces p WHERE p.depense_id = d.id AND p.retenu) AS devis_retenu, dos.numero AS dossier_numero,
              d.soumis_par AS soumis_par_id, u.prenom || ' ' || u.nom AS soumis_par,
              d.engagee_par AS engagee_par_id, d.apres_coup_statut, d.apres_coup_motif,
              d.annulee_le, d.annulation_motif, d.statut_avant_annulation
       FROM depenses d
       LEFT JOIN comptes_bancaires c ON c.id = d.compte_id
       LEFT JOIN dossiers dos ON dos.id = d.dossier_id
       LEFT JOIN utilisateurs u ON u.id = d.soumis_par
       ${where}
       ORDER BY d.date_depense DESC, d.cree_le DESC LIMIT 300`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/depenses/verifier-doublon?libelle=&montant=&date_depense=&dossier_id=
// (26/09/2026, audit doublons) — signale, sans jamais bloquer, une dépense
// déjà soumise avec le même libellé/montant/date (2 dépenses réellement
// identiques le même jour restent possibles — l'utilisateur décide).
router.get("/verifier-doublon", requirePermission("depenses.creer"), async (req, res) => {
  const { libelle, montant, date_depense, dossier_id } = req.query;
  if (!libelle || montant == null) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.libelle, d.montant, d.date_depense, d.statut
       FROM depenses d
       WHERE d.libelle ILIKE $1 AND d.montant = $2 AND d.date_depense = COALESCE($3, current_date)
         AND ($4::uuid IS NULL OR d.dossier_id = $4)`,
      [libelle, montant, date_depense || null, dossier_id || null]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/depenses
// { type, categorie, libelle, montant, date_depense?, mode_paiement?, compte_id?,
//   petite_caisse?, justificatif?, refacturable_client?, dossier_id?, recurrente? }
router.post("/", requirePermission("depenses.creer"), async (req, res) => {
  const b = req.body || {};
  if (!b.type || !b.libelle || b.montant == null) return res.status(400).json({ error: "type, libelle et montant requis" });
  const n = resoudreNature(b, null);
  if (n.erreur) return res.status(400).json({ error: n.erreur });
  // Moyen, compte compatible et références (non exigées avant le paiement effectif).
  let regl = { valeurs: { mode_paiement: null, compte_id: b.compte_id || null, references: {} } };
  if (b.mode_paiement) {
    regl = await preparerDecaissement(pool, b, { exigerReferences: false });
    if (regl.erreur) return res.status(400).json({ error: regl.erreur });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO depenses
         (nature, type, categorie, libelle, montant, date_depense, mode_paiement, compte_id,
          petite_caisse, justificatif, refacturable_client, dossier_id, recurrente,
          soumis_par, cree_par, references_paiement, beneficiaire)
       VALUES ($14,$1::type_depense,COALESCE($2::categorie_depense,'autre'),$3,$4,COALESCE($5,current_date),
               $6,$7,COALESCE($8,false),COALESCE($9,false),COALESCE($10,false),$11,COALESCE($12,false),$13,$13,$15::jsonb,$16)
       RETURNING id, nature, type, categorie, libelle, montant, statut`,
      [b.type, b.categorie, b.libelle, b.montant, b.date_depense || null, regl.valeurs.mode_paiement,
       regl.valeurs.compte_id, b.petite_caisse, b.justificatif, n.nature === "dossier" ? b.refacturable_client : false,
       n.dossierId, b.recurrente, req.user.sub, n.nature, JSON.stringify(regl.valeurs.references),
       String(b.beneficiaire || '').trim().slice(0, 160) || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------
// Petite caisse renforcée (17/10/2026) : engagement d'une petite dépense
// SANS validation préalable, validée APRÈS COUP par un associé AUTRE que
// l'engageur. Garde-fous : plafond par dépense (paramétré), solde du mois
// (dotation − dépenses) jamais dépassé, moyen de paiement obligatoire,
// tout est tracé. Au-delà du plafond : circuit normal (soumise → validée).
// ---------------------------------------------------------------------
router.post("/engager", requirePermission("depenses.engager"), async (req, res) => {
  const b = req.body || {};
  const montant = Math.round(Number(b.montant));
  if (!b.libelle || !(montant > 0)) return res.status(400).json({ error: "libelle et montant positif requis" });
  if (!b.mode_paiement) return res.status(400).json({ error: "Moyen de paiement requis (mobile money recommandé)." });
  const n = resoudreNature(b, null);
  if (n.erreur) return res.status(400).json({ error: n.erreur });
  // L'argent sort tout de suite : les références du moyen sont exigées.
  const regl = await preparerDecaissement(pool, b, { exigerReferences: true });
  if (regl.erreur) return res.status(400).json({ error: regl.erreur });
  try {
    const par = await pool.query("SELECT petite_caisse_plafond_depense AS plafond FROM parametres_cabinet WHERE id = 1");
    const plafond = par.rows[0]?.plafond;
    if (plafond == null) {
      return res.status(409).json({ error: "Le plafond par dépense de la petite caisse n'est pas encore défini (Accès & permissions → Seuils). Passez par le circuit normal de validation." });
    }
    if (montant > Number(plafond)) {
      return res.status(409).json({ error: `Montant supérieur au plafond de la petite caisse (${Number(plafond)}). Soumettez la dépense au circuit normal de validation.` });
    }
    const mois = premierDuMois(b.date_depense ? new Date(b.date_depense) : new Date());
    const caisse = await soldePetiteCaisse(mois);
    if (!caisse.dotee) {
      return res.status(409).json({ error: "La petite caisse n'est pas dotée pour ce mois." });
    }
    if (montant > caisse.solde) {
      return res.status(409).json({ error: `Solde de la petite caisse insuffisant (reste ${caisse.solde}).`, solde: caisse.solde });
    }
    const { rows } = await pool.query(
      `INSERT INTO depenses
         (nature, type, categorie, libelle, montant, date_depense, mode_paiement, compte_id,
          petite_caisse, justificatif, refacturable_client, dossier_id,
          statut, soumis_par, cree_par, engagee_par, engagee_le, decaisse_par, decaisse_le, apres_coup_statut, references_paiement)
       VALUES ($1,'ponctuelle',COALESCE($2::categorie_depense,'autre'),$3,$4,COALESCE($5::date,current_date),$6::mode_paiement,$7,
               TRUE,COALESCE($8,false),$9,$10,
               'decaissee',$11,$11,$11,now(),$11,now(),'a_valider',$12::jsonb)
       RETURNING id, nature, libelle, montant, statut, apres_coup_statut`,
      [n.nature, b.categorie || null, b.libelle, montant, b.date_depense || null, regl.valeurs.mode_paiement, regl.valeurs.compte_id,
       b.justificatif, n.nature === "dossier" ? !!b.refacturable_client : false, n.dossierId, req.user.sub, JSON.stringify(regl.valeurs.references)]
    );
    await logAudit({ utilisateurId: req.user.sub, action: "engager_depense", entite: "depenses", entiteId: rows[0].id,
      details: { montant, libelle: b.libelle, mode_paiement: b.mode_paiement, solde_avant: caisse.solde }, ip: req.ip });
    res.status(201).json({ ...rows[0], solde_restant: caisse.solde - montant });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// Validation (ou contestation) APRÈS COUP d'une dépense engagée — associés
// (depenses.decision), jamais l'engageur lui-même.
router.post("/:id/valider-apres-coup", requirePermission("depenses.decision"), async (req, res) => {
  const { decision, motif } = req.body || {};
  if (!["validee", "contestee"].includes(decision)) return res.status(400).json({ error: "decision : validee ou contestee" });
  if (decision === "contestee" && !motif) return res.status(400).json({ error: "Un motif est requis pour contester une dépense." });
  try {
    const { rows: [d] } = await pool.query("SELECT engagee_par, apres_coup_statut FROM depenses WHERE id = $1", [req.params.id]);
    if (!d) return res.status(404).json({ error: "Dépense introuvable" });
    if (d.apres_coup_statut !== "a_valider") return res.status(409).json({ error: "Cette dépense n'est pas en attente de validation après coup." });
    if (d.engagee_par === req.user.sub) {
      return res.status(403).json({ error: "Vous ne pouvez pas valider une dépense que vous avez vous-même engagée : un autre associé doit le faire." });
    }
    const { rows } = await pool.query(
      `UPDATE depenses SET apres_coup_statut = $1::varchar, apres_coup_par = $2::uuid, apres_coup_le = now(), apres_coup_motif = $3,
              valide_par = CASE WHEN $1::varchar = 'validee' THEN $2::uuid ELSE valide_par END,
              valide_le = CASE WHEN $1::varchar = 'validee' THEN now() ELSE valide_le END
       WHERE id = $4 AND apres_coup_statut = 'a_valider' RETURNING id, apres_coup_statut`,
      [decision, req.user.sub, motif || null, req.params.id]
    );
    if (!rows[0]) return res.status(409).json({ error: "Déjà traitée entre-temps." });
    await logAudit({ utilisateurId: req.user.sub, action: decision === "validee" ? "valider_apres_coup" : "contester_depense", entite: "depenses", entiteId: req.params.id, details: { motif: motif || null }, ip: req.ip });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Rapprochement mensuel : le solde réel du porte-monnaie (relevé de
// l'opérateur ou comptage des espèces) est comparé au solde calculé par JURIA.
router.post("/petite-caisse/rapprochement", requirePermission("depenses.petite_caisse.doter"), async (req, res) => {
  const b = req.body || {};
  if (b.solde_reel == null || isNaN(Number(b.solde_reel))) return res.status(400).json({ error: "solde_reel requis" });
  try {
    const mois = b.mois || premierDuMois();
    const { solde } = await soldePetiteCaisse(mois);
    const reel = Math.round(Number(b.solde_reel));
    const { rows } = await pool.query(
      `INSERT INTO rapprochements_petite_caisse (mois, solde_calcule, solde_reel, ecart, note, fait_par)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, mois, solde_calcule, solde_reel, ecart, note, fait_le`,
      [mois, solde, reel, reel - solde, b.note || null, req.user.sub]
    );
    await logAudit({ utilisateurId: req.user.sub, action: "rapprochement_petite_caisse", entite: "depenses", entiteId: rows[0].id, details: { mois, ecart: rows[0].ecart }, ip: req.ip });
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
});

router.get("/petite-caisse/rapprochements", requirePermission("depenses.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.mois, r.solde_calcule, r.solde_reel, r.ecart, r.note, r.fait_le, u.prenom || ' ' || u.nom AS fait_par
       FROM rapprochements_petite_caisse r LEFT JOIN utilisateurs u ON u.id = r.fait_par
       ORDER BY r.fait_le DESC LIMIT 24`);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Annulation d'une dépense VALIDÉE ou DÉCAISSÉE, avec motif (associés,
// depenses.decision) — 17/10/2026. Jamais de suppression : la ligne reste,
// barrée et tracée. Passe en statut « rejetee » pour être exclue d'elle-même
// de toutes les sommes. Refusée si la dépense est déjà refacturée sur une
// facture, liée à une vignette de plaidoirie ou à une échéance administrative
// (il faudrait d'abord défaire ces liens).
router.post("/:id/annuler", requirePermission("depenses.decision"), async (req, res) => {
  const motif = ((req.body || {}).motif || "").trim();
  if (!motif) return res.status(400).json({ error: "Un motif est requis pour annuler une dépense." });
  try {
    const { rows: [d] } = await pool.query("SELECT statut, facture_id FROM depenses WHERE id = $1", [req.params.id]);
    if (!d) return res.status(404).json({ error: "Dépense introuvable" });
    if (!["validee", "decaissee"].includes(d.statut)) {
      return res.status(409).json({ error: "Seule une dépense validée ou décaissée peut être annulée (une dépense soumise se rejette ou se retire)." });
    }
    if (d.facture_id) return res.status(409).json({ error: "Dépense déjà refacturée sur une facture : retirez-la de la facture (ou annulez la facture) avant de l'annuler." });
    const lie = await pool.query(
      `SELECT (SELECT count(*) FROM vignettes_plaidoirie WHERE depense_id = $1) AS vignettes,
              (SELECT count(*) FROM echeances_administratives WHERE depense_id = $1) AS echeances`, [req.params.id]);
    if (Number(lie.rows[0].vignettes) > 0) return res.status(409).json({ error: "Dépense liée à une vignette de plaidoirie : non annulable ici." });
    if (Number(lie.rows[0].echeances) > 0) return res.status(409).json({ error: "Dépense liée à une échéance administrative : non annulable ici." });
    const { rows } = await pool.query(
      `UPDATE depenses SET statut_avant_annulation = statut, statut = 'rejetee'::statut_depense,
              annulee_le = now(), annulee_par = $1::uuid, annulation_motif = $2, motif_rejet = $2
       WHERE id = $3 AND statut IN ('validee','decaissee') AND facture_id IS NULL
       RETURNING id, statut, statut_avant_annulation`,
      [req.user.sub, motif, req.params.id]
    );
    if (!rows[0]) return res.status(409).json({ error: "Déjà traitée entre-temps." });
    await logAudit({ utilisateurId: req.user.sub, action: "annuler_depense", entite: "depenses", entiteId: req.params.id, details: { motif, statut_avant: rows[0].statut_avant_annulation }, ip: req.ip });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Historique des dotations mensuelles de la petite caisse.
router.get("/petite-caisse/dotations", requirePermission("depenses.petite_caisse.doter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.mois, d.montant_alloue, d.cree_le, u.prenom || ' ' || u.nom AS par
       FROM dotations_petite_caisse d LEFT JOIN utilisateurs u ON u.id = d.administrateur_id
       ORDER BY d.mois DESC LIMIT 24`);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Achats de vignettes (approvisionnements) — consultation et suppression d'un
// achat saisi par erreur, tant qu'aucun de ses numéros n'a servi.
router.get("/vignettes/achats", requirePermission("depenses.vignettes.mouvement"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT v.id, v.quantite, v.numero_debut, v.numero_fin, v.date_mouvement, u.prenom || ' ' || u.nom AS par,
              (SELECT count(*) FROM vignettes_numeros_stock n WHERE n.achat_id = v.id)::int AS nb_numeros,
              (SELECT count(*) FROM vignettes_numeros_stock n WHERE n.achat_id = v.id AND NOT n.disponible)::int AS nb_utilises
       FROM vignettes_plaidoirie v LEFT JOIN utilisateurs u ON u.id = v.cree_par
       WHERE v.mouvement = 'achat' ORDER BY v.date_mouvement DESC, v.id LIMIT 50`);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

router.delete("/vignettes/achats/:id", requirePermission("depenses.vignettes.mouvement"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [a] } = await client.query("SELECT quantite FROM vignettes_plaidoirie WHERE id = $1 AND mouvement = 'achat' FOR UPDATE", [req.params.id]);
    if (!a) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Achat introuvable" }); }
    const utilises = await client.query("SELECT count(*) AS n FROM vignettes_numeros_stock WHERE achat_id = $1 AND NOT disponible", [req.params.id]);
    if (Number(utilises.rows[0].n) > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Des vignettes de cet achat ont déjà été utilisées : suppression impossible." });
    }
    const stock = await client.query("SELECT stock FROM v_stock_vignettes");
    if (Number(stock.rows[0].stock) - Number(a.quantite) < 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Supprimer cet achat rendrait le stock négatif (des vignettes ont déjà été utilisées)." });
    }
    await client.query("DELETE FROM vignettes_numeros_stock WHERE achat_id = $1", [req.params.id]);
    await client.query("DELETE FROM vignettes_plaidoirie WHERE id = $1", [req.params.id]);
    await client.query("COMMIT");
    await logAudit({ utilisateurId: req.user.sub, action: "supprimer_achat_vignettes", entite: "vignettes_plaidoirie", entiteId: req.params.id, details: { quantite: a.quantite }, ip: req.ip });
    res.status(204).end();
  } catch (e) { await client.query("ROLLBACK"); console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
  finally { client.release(); }
});

// Vignettes utilisées (28/10/2026) — liste et annulation d'une utilisation (saisie de test ou d'erreur,
// y compris une vignette « orpheline » dont l'instance a été retirée du dossier). Le numéro redevient
// disponible dans le stock et la dépense « Vignette de plaidoirie n°… » créée à l'utilisation est supprimée.
router.get("/vignettes/utilisations", requirePermission("depenses.vignettes.mouvement"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT v.id, v.numero_vignette, v.date_mouvement, v.refacturee, v.instance_id,
              d.numero AS dossier_numero, d.intitule AS dossier_intitule, u.prenom || ' ' || u.nom AS par
       FROM vignettes_plaidoirie v
       LEFT JOIN dossiers d ON d.id = v.dossier_id
       LEFT JOIN utilisateurs u ON u.id = v.cree_par
       WHERE v.mouvement = 'utilisation' ORDER BY v.date_mouvement DESC, v.cree_le DESC LIMIT 100`);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

router.delete("/vignettes/utilisations/:id", requirePermission("depenses.vignettes.mouvement"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [u] } = await client.query(
      "SELECT id, numero_vignette, dossier_id, depense_id FROM vignettes_plaidoirie WHERE id = $1 AND mouvement = 'utilisation' FOR UPDATE", [req.params.id]);
    if (!u) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Utilisation introuvable" }); }
    await client.query("UPDATE vignettes_numeros_stock SET disponible = TRUE, utilisation_id = NULL WHERE utilisation_id = $1", [u.id]);
    await client.query("DELETE FROM vignettes_plaidoirie WHERE id = $1", [u.id]);
    if (u.depense_id) await client.query("DELETE FROM depenses WHERE id = $1 AND categorie = 'vignette_plaidoirie'", [u.depense_id]);
    await client.query("COMMIT");
    await logAudit({ utilisateurId: req.user.sub, action: "annuler_utilisation_vignette", entite: "vignettes_plaidoirie", entiteId: u.id,
      details: { numero_vignette: u.numero_vignette, dossier_id: u.dossier_id }, ip: req.ip });
    res.status(204).end();
  } catch (e) {
    await client.query("ROLLBACK"); console.error(e);
    if (e.code === "23503") return res.status(409).json({ error: "La dépense liée à cette vignette est référencée ailleurs : annulation impossible." });
    res.status(500).json({ error: "Erreur serveur" });
  } finally { client.release(); }
});

// PUT /api/depenses/:id — corriger une dépense avant décision (19/09/2026,
// gap comblé — jusqu'ici seul recours : la rejeter puis la resaisir).
// Restreint au déposant lui-même OU à quelqu'un habilité à décider
// (depenses.decision) — pas n'importe qui avec depenses.creer, pour éviter
// qu'une tierce personne corrige la dépense d'un collègue sans lien avec
// elle. Verrouillée dès que la décision est prise (statut ≠ 'soumise') —
// même principe que les autres corrections « avant qu'un engagement soit
// pris » déjà dans JURIA (facture non payée, instance...).
router.put("/:id", requirePermission("depenses.creer"), async (req, res) => {
  const b = req.body || {};
  try {
    const { rows: [actuelle] } = await pool.query("SELECT soumis_par, statut, nature, dossier_id FROM depenses WHERE id = $1", [req.params.id]);
    if (!actuelle) return res.status(404).json({ error: "Dépense introuvable" });
    const n = resoudreNature(b, actuelle);
    if (n.erreur) return res.status(400).json({ error: n.erreur });
    const estDeposant = actuelle.soumis_par === req.user.sub;
    if (!estDeposant && !(await estAutorise(req.user.role, "depenses.decision", req.user.sub))) {
      return res.status(403).json({ error: "Seul le déposant ou une personne habilitée à décider peut corriger cette dépense." });
    }
    if (actuelle.statut !== "soumise") {
      return res.status(409).json({ error: "Dépense déjà traitée — non modifiable." });
    }
    // Moyen fourni : compte et références revalidés (compte vidé si le moyen n'en a pas).
    const modeFourni = !!b.mode_paiement;
    let regl = { valeurs: { mode_paiement: null, compte_id: null, references: {} } };
    if (modeFourni) {
      regl = await preparerDecaissement(pool, b, { exigerReferences: false });
      if (regl.erreur) return res.status(400).json({ error: regl.erreur });
    }
    const { rows } = await pool.query(
      `UPDATE depenses SET
         type = COALESCE($1::type_depense, type),
         categorie = COALESCE($2::categorie_depense, categorie),
         libelle = COALESCE($3, libelle),
         montant = COALESCE($4, montant),
         date_depense = COALESCE($5, date_depense),
         mode_paiement = COALESCE($6::mode_paiement, mode_paiement),
         compte_id = CASE WHEN $14::boolean THEN $7::uuid ELSE compte_id END,
         references_paiement = CASE WHEN $14::boolean THEN $15::jsonb ELSE references_paiement END,
         petite_caisse = COALESCE($8, petite_caisse),
         justificatif = COALESCE($9, justificatif),
         refacturable_client = COALESCE($10, refacturable_client),
         nature = $13,
         dossier_id = $11,
         beneficiaire = CASE WHEN $16::boolean THEN $17 ELSE beneficiaire END
       WHERE id = $12 AND statut = 'soumise'
       RETURNING id, type, categorie, libelle, montant, statut`,
      [b.type || null, b.categorie || null, b.libelle || null, b.montant ?? null,
       b.date_depense || null, regl.valeurs.mode_paiement, regl.valeurs.compte_id,
       b.petite_caisse, b.justificatif, n.nature === "dossier" ? b.refacturable_client : (b.refacturable_client === undefined ? undefined : false), n.dossierId, req.params.id, n.nature,
       modeFourni, JSON.stringify(regl.valeurs.references),
       Object.prototype.hasOwnProperty.call(b, "beneficiaire"), String(b.beneficiaire || "").trim().slice(0, 160) || null]
    );
    if (!rows[0]) return res.status(409).json({ error: "Dépense déjà traitée entre-temps — non modifiable." });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/depenses/:id — retirer une dépense soumise par erreur, avant
// toute décision (25/09/2026 — le déposant pouvait la corriger mais pas la
// retirer, contrairement aux congés/rétrocessions). Même contrôle que le PUT :
// déposant lui-même OU personne habilitée à décider ; verrouillé dès qu'une
// décision est prise (une dépense validée/rejetée reste tracée).
router.delete("/:id", requirePermission("depenses.creer"), async (req, res) => {
  try {
    const { rows: [actuelle] } = await pool.query("SELECT soumis_par, statut FROM depenses WHERE id = $1", [req.params.id]);
    if (!actuelle) return res.status(404).json({ error: "Dépense introuvable" });
    if (actuelle.soumis_par !== req.user.sub && !(await estAutorise(req.user.role, "depenses.decision", req.user.sub))) {
      return res.status(403).json({ error: "Seul le déposant ou une personne habilitée à décider peut retirer cette dépense." });
    }
    const { rowCount } = await pool.query("DELETE FROM depenses WHERE id = $1 AND statut = 'soumise'", [req.params.id]);
    if (!rowCount) return res.status(409).json({ error: "Dépense déjà traitée — non retirable." });
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ---------------------------------------------------------------------
// Pièces d'une dépense (16/10/2026) : devis (plusieurs possibles, soumis
// pour choix), facture, preuve de paiement. Un devis n'est jamais
// obligatoire. Seul le valideur (depenses.decision) « retient » un devis.
// Dépôt de facture / preuve possible à tout moment, y compris après
// décaissement (justificatif différé) ; un devis seulement tant que la
// dépense est « soumise » (après décision il n'a plus d'objet).
// ---------------------------------------------------------------------
async function peutGererPieces(req, depenseId) {
  const { rows: [d] } = await pool.query("SELECT soumis_par, statut FROM depenses WHERE id = $1", [depenseId]);
  if (!d) return { code: 404, erreur: "Dépense introuvable" };
  const decideur = await estAutorise(req.user.role, "depenses.decision", req.user.sub);
  if (d.soumis_par !== req.user.sub && !decideur) {
    return { code: 403, erreur: "Seul le déposant ou une personne habilitée à décider peut gérer les pièces de cette dépense." };
  }
  return { depense: d, decideur };
}

router.get("/:id/pieces", requirePermission("depenses.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.type, p.nom, p.type_mime, p.taille_octets, p.retenu, p.retenu_le, p.ajoute_le,
              u.prenom || ' ' || u.nom AS ajoute_par
       FROM depense_pieces p LEFT JOIN utilisateurs u ON u.id = p.ajoute_par
       WHERE p.depense_id = $1 ORDER BY p.ajoute_le`, [req.params.id]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

router.post("/:id/pieces", requirePermission("depenses.creer"), upload.single("fichier"), async (req, res) => {
  const type = (req.body && req.body.type) || "autre";
  if (!["devis", "facture", "preuve_paiement", "autre"].includes(type)) return res.status(400).json({ error: "type de pièce invalide" });
  if (!req.file) return res.status(400).json({ error: "Fichier manquant" });
  try {
    const g = await peutGererPieces(req, req.params.id);
    if (g.erreur) return res.status(g.code).json({ error: g.erreur });
    if (type === "devis" && g.depense.statut !== "soumise") {
      return res.status(409).json({ error: "Un devis ne peut être ajouté que tant que la dépense n'a pas été traitée." });
    }
    const dest = `depenses/${req.params.id}/${Date.now()}_${req.file.originalname}`.replace(/\s+/g, "_");
    const chemin = await saveObject(req.file.buffer, dest, req.file.mimetype);
    const { rows } = await pool.query(
      `INSERT INTO depense_pieces (depense_id, type, nom, type_mime, taille_octets, chemin_storage, ajoute_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, type, nom, retenu`,
      [req.params.id, type, req.file.originalname, req.file.mimetype, req.file.size, chemin, req.user.sub]);
    await logAudit({ utilisateurId: req.user.sub, action: "ajouter_piece_depense", entite: "depenses", entiteId: req.params.id, details: { piece_id: rows[0].id, type, nom: req.file.originalname }, ip: req.ip });
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
});

router.get("/:id/pieces/:pieceId/fichier", requirePermission("depenses.consulter"), async (req, res) => {
  try {
    const { rows: [p] } = await pool.query("SELECT nom, type_mime, chemin_storage FROM depense_pieces WHERE id = $1 AND depense_id = $2", [req.params.pieceId, req.params.id]);
    if (!p) return res.status(404).json({ error: "Pièce introuvable" });
    const buf = await readObject(p.chemin_storage);
    res.setHeader("Content-Type", p.type_mime || "application/octet-stream");
    res.setHeader("Content-Disposition", enteteContentDisposition(p.nom));
    res.send(buf);
  } catch (e) {
    if (e instanceof FichierIntrouvableError) return res.status(404).json({ error: "Le fichier de cette pièce n'est plus disponible dans le stockage." });
    console.error(e); res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/:id/pieces/:pieceId/retenir", requirePermission("depenses.decision"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [d] } = await client.query("SELECT statut FROM depenses WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!d) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Dépense introuvable" }); }
    if (d.statut !== "soumise") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Le choix du devis se fait avant la décision sur la dépense." }); }
    const { rows: [p] } = await client.query("SELECT type FROM depense_pieces WHERE id = $1 AND depense_id = $2", [req.params.pieceId, req.params.id]);
    if (!p) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Pièce introuvable" }); }
    if (p.type !== "devis") { await client.query("ROLLBACK"); return res.status(400).json({ error: "Seul un devis peut être retenu." }); }
    await client.query("UPDATE depense_pieces SET retenu = FALSE, retenu_par = NULL, retenu_le = NULL WHERE depense_id = $1 AND retenu", [req.params.id]);
    await client.query("UPDATE depense_pieces SET retenu = TRUE, retenu_par = $1, retenu_le = now() WHERE id = $2", [req.user.sub, req.params.pieceId]);
    await client.query("COMMIT");
    await logAudit({ utilisateurId: req.user.sub, action: "retenir_devis_depense", entite: "depenses", entiteId: req.params.id, details: { piece_id: req.params.pieceId }, ip: req.ip });
    res.json({ depense_id: req.params.id, piece_id: req.params.pieceId, retenu: true });
  } catch (e) { await client.query("ROLLBACK"); console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
  finally { client.release(); }
});

router.delete("/:id/pieces/:pieceId", requirePermission("depenses.creer"), async (req, res) => {
  try {
    const g = await peutGererPieces(req, req.params.id);
    if (g.erreur) return res.status(g.code).json({ error: g.erreur });
    if (g.depense.statut !== "soumise" && !g.decideur) {
      return res.status(403).json({ error: "Après la décision, seule une personne habilitée à décider peut retirer une pièce." });
    }
    const { rows: [p] } = await pool.query("DELETE FROM depense_pieces WHERE id = $1 AND depense_id = $2 RETURNING chemin_storage, nom, type", [req.params.pieceId, req.params.id]);
    if (!p) return res.status(404).json({ error: "Pièce introuvable" });
    await deleteObject(p.chemin_storage);
    await logAudit({ utilisateurId: req.user.sub, action: "retirer_piece_depense", entite: "depenses", entiteId: req.params.id, details: { nom: p.nom, type: p.type }, ip: req.ip });
    res.status(204).end();
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/depenses/:id/decision  { statut: 'validee'|'rejetee', motif_rejet? }  (gérant : associé/admin)
router.post("/:id/decision", requirePermission("depenses.decision"), async (req, res) => {
  const { statut, motif_rejet } = req.body || {};
  if (!["validee", "rejetee"].includes(statut)) return res.status(400).json({ error: "Statut invalide" });
  try {
    const { rows } = await pool.query(
      `UPDATE depenses SET statut = $1::statut_depense, motif_rejet = $2, valide_par = $3, valide_le = now()
       WHERE id = $4 AND statut = 'soumise' RETURNING id, statut`,
      [statut, motif_rejet || null, req.user.sub, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Dépense introuvable ou déjà traitée" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/depenses/:id/decaisser  (comptabilité : comptable/associe/admin)
router.post("/:id/decaisser", requirePermission("depenses.decaisser"), async (req, res) => {
  const b = req.body || {};
  try {
    const { rows: [d] } = await pool.query(
      "SELECT statut, montant, mode_paiement, compte_id, references_paiement FROM depenses WHERE id = $1", [req.params.id]);
    if (!d || d.statut !== "validee") return res.status(404).json({ error: "La dépense doit être validée avant décaissement" });
    // Justificatif exigé au-delà d'un seuil (réglage facultatif, 0 = désactivé) : au moins une facture ou une pièce « autre ».
    const { rows: [par] } = await pool.query("SELECT seuil_justificatif_decaissement AS seuil FROM parametres_cabinet WHERE id = 1");
    const seuil = Number(par && par.seuil);
    if (seuil > 0 && Number(d.montant) >= seuil) {
      const { rows: [j] } = await pool.query("SELECT 1 FROM depense_pieces WHERE depense_id = $1 AND type IN ('facture','autre') LIMIT 1", [req.params.id]);
      if (!j) {
        return res.status(409).json({ error: `Un justificatif (facture ou autre pièce) est exigé avant de décaisser une dépense de ${seuil.toLocaleString("fr-FR")} FCFA ou plus : ajoutez-le dans « Pièces / devis ».` });
      }
    }
    // Le moyen, le compte et les références peuvent être précisés ou corrigés au
    // décaissement ; les références du moyen sont alors exigées (l'argent sort).
    const regl = await preparerDecaissement(pool, {
      mode_paiement: b.mode_paiement || d.mode_paiement,
      compte_id: b.compte_id !== undefined ? b.compte_id : d.compte_id,
      references: b.references !== undefined ? b.references : d.references_paiement,
    }, { exigerReferences: true });
    if (regl.erreur) return res.status(400).json({ error: regl.erreur });
    const v = regl.valeurs;
    const { rows } = await pool.query(
      `UPDATE depenses SET statut = 'decaissee', decaisse_par = $1, decaisse_le = now(),
              mode_paiement = $3::mode_paiement, compte_id = $4::uuid, references_paiement = $5::jsonb
       WHERE id = $2 AND statut = 'validee' RETURNING id, statut`,
      [req.user.sub, req.params.id, v.mode_paiement, v.compte_id, JSON.stringify(v.references)]
    );
    if (!rows[0]) return res.status(404).json({ error: "La dépense doit être validée avant décaissement" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/depenses/moyens-paiement — moyens de décaissement et leurs références (20/10/2026).
router.get("/moyens-paiement", (req, res) => {
  res.json(DECAISSEMENT.map((m) => ({ code: m.code, libelle: m.libelle, famille: m.famille, frais: false, champs: m.champs })));
});

// GET /api/depenses/moyens-paiement/:code/comptes — comptes pouvant servir à ce moyen.
router.get("/moyens-paiement/:code/comptes", async (req, res) => {
  const moyen = DECAISSEMENT_PAR_CODE[req.params.code];
  if (!moyen) return res.status(404).json({ error: "Moyen inconnu" });
  try { res.json(await comptesEligibles(pool, moyen)); }
  catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// GET /api/depenses/comptes
router.get("/comptes", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, intitule, type, banque, operateur, telephone FROM comptes_bancaires WHERE actif = TRUE ORDER BY intitule");
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Solde de la petite caisse d'un mois : dotation − dépenses (hors rejetées).
async function soldePetiteCaisse(mois) {
  const dotation = await pool.query("SELECT montant_alloue FROM dotations_petite_caisse WHERE mois = $1", [mois]);
  const depense = await pool.query(
    `SELECT COALESCE(SUM(montant),0) AS total FROM depenses
     WHERE petite_caisse = TRUE AND statut <> 'rejetee' AND date_trunc('month', date_depense) = $1::date`,
    [mois]
  );
  const alloue = Number(dotation.rows[0]?.montant_alloue ?? 0);
  const total = Number(depense.rows[0].total);
  return { dotation: alloue, dotee: dotation.rows.length > 0, depense: total, solde: alloue - total };
}
const premierDuMois = (d = new Date()) => d.toISOString().slice(0, 8) + "01";

// GET /api/depenses/petite-caisse?mois=YYYY-MM-01
router.get("/petite-caisse", async (req, res) => {
  const mois = req.query.mois || premierDuMois();
  try {
    const { dotation, depense, solde } = await soldePetiteCaisse(mois);
    const par = await pool.query("SELECT petite_caisse_plafond_depense AS plafond FROM parametres_cabinet WHERE id = 1");
    res.json({ mois, dotation, depense, solde, plafond_depense: par.rows[0]?.plafond ?? null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/depenses/petite-caisse  { mois, montant_alloue }  (administrateur)
router.post("/petite-caisse", requirePermission("depenses.petite_caisse.doter"), async (req, res) => {
  const { mois, montant_alloue } = req.body || {};
  if (!mois || montant_alloue == null) return res.status(400).json({ error: "mois et montant_alloue requis" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO dotations_petite_caisse (mois, montant_alloue, administrateur_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (mois) DO UPDATE SET montant_alloue = EXCLUDED.montant_alloue
       RETURNING mois, montant_alloue`,
      [mois, montant_alloue, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// GET /api/depenses/vignettes/stock — expose aussi le seuil d'alerte
// (08/10/2026) pour que l'écran puisse colorer la tuile sans requête
// séparée.
router.get("/vignettes/stock", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT (SELECT stock::int FROM v_stock_vignettes) AS stock, seuil_alerte_vignettes AS seuil FROM parametres_cabinet WHERE id = 1"
    );
    res.json({ stock: rows[0]?.stock ?? 0, seuil: rows[0]?.seuil ?? 10 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/depenses/vignettes/numeros-disponibles (08/10/2026) — numéros
// individuels connus à l'avance (achat avec plage renseignée) et pas
// encore consommés ; sert à proposer un numéro plutôt que de le ressaisir
// à la main quand il est déjà connu.
router.get("/vignettes/numeros-disponibles", requirePermission("depenses.vignettes.mouvement"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT numero FROM vignettes_numeros_stock WHERE disponible = TRUE ORDER BY numero ASC"
    );
    res.json(rows.map((r) => r.numero));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/depenses/vignettes  { quantite, numero_debut?, numero_fin? }
// (08/10/2026) — réservé à l'approvisionnement (achat) : la consommation
// ("utilisation") passe désormais exclusivement par
// POST /api/dossiers/:id/instances/:instanceId/vignette, seul endroit qui
// applique les règles de traçabilité (instance, numéro, mode d'honoraires
// renseigné). Laisser "utilisation" ici en parallèle aurait recréé la
// faille qu'on cherche justement à combler.
router.post("/vignettes", requirePermission("depenses.vignettes.mouvement"), async (req, res) => {
  const b = req.body || {};
  if (b.mouvement && b.mouvement !== "achat") {
    return res.status(400).json({ error: "La consommation d'une vignette se fait désormais depuis l'instance du dossier concerné (fiche dossier → Instances)." });
  }
  // Liste libre de numéros/plages (16/10/2026) — prioritaire sur l'ancienne
  // saisie "début/fin" (continue uniquement), conservée pour compatibilité.
  let numeros = null;
  if (b.numeros != null && String(b.numeros).trim() !== "") {
    const r = parserNumeros(b.numeros);
    if (r.erreur) return res.status(400).json({ error: r.erreur });
    numeros = r.numeros;
  }
  const plageFournie = numeros === null && (b.numero_debut != null || b.numero_fin != null);
  if (plageFournie && (b.numero_debut == null || b.numero_fin == null || b.numero_fin < b.numero_debut)) {
    return res.status(400).json({ error: "numero_debut et numero_fin doivent être fournis ensemble, avec numero_fin >= numero_debut." });
  }
  if (plageFournie) numeros = Array.from({ length: b.numero_fin - b.numero_debut + 1 }, (_, i) => b.numero_debut + i);
  const quantite = numeros ? numeros.length : b.quantite;
  if (!quantite) return res.status(400).json({ error: "quantite (ou une liste de numéros) requise" });
  if (numeros) {
    const deja = await pool.query("SELECT numero FROM vignettes_numeros_stock WHERE numero = ANY($1::int[]) LIMIT 5", [numeros]);
    if (deja.rows.length) {
      return res.status(409).json({ error: `Numéro(s) déjà enregistré(s) : ${deja.rows.map((r) => String(r.numero).padStart(7, "0")).join(", ")}.` });
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [achat] } = await client.query(
      `INSERT INTO vignettes_plaidoirie (mouvement, quantite, numero_debut, numero_fin, cree_par)
       VALUES ('achat', $1, $2, $3, $4)
       RETURNING id, mouvement, quantite, date_mouvement`,
      [quantite, plageFournie ? b.numero_debut : null, plageFournie ? b.numero_fin : null, req.user.sub]
    );
    if (numeros) {
      await client.query(
        "INSERT INTO vignettes_numeros_stock (numero, achat_id) SELECT unnest($1::int[]), $2",
        [numeros, achat.id]
      );
    }
    await client.query("COMMIT");
    res.status(201).json(achat);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

module.exports = router;
