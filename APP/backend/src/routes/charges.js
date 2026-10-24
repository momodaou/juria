// JURIA — État mensuel des charges (24/10/2026).
// Fonctionnement du cabinet : l'administratrice générale (ou le comptable)
// prépare chaque mois un état des charges à payer (fixes + ponctuelles) ; les
// associés approuvent, rejettent ou REPORTENT chaque ligne et orientent le
// moyen de paiement ; l'approbation crée une dépense « validée » dans le
// circuit existant (le décaissement n'est pas modifié). Une ligne reportée
// revient dans l'état du mois suivant avec son retard. Les salaires restent
// dans le module RH. Permissions réutilisées (aucune nouvelle action
// cataloguée) : consulter / creer (préparer) / decision (approuver).
const express = require("express");
const { pool } = require("../db");
const { logAudit } = require("../audit");
const { preparerDecaissement } = require("../moyensPaiement");
const { requirePermission, estAutorise } = require("../permissions");
const { genererEtatChargesPdf } = require("../etatChargesPdf");
const router = express.Router();

const SEUIL_ALERTE_RETARD = 2; // mois de report à partir desquels la ligne est signalée

// « 2026-10 » ou « 2026-10-17 » → « 2026-10-01 » ; null si invalide.
function premierDuMois(v) {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(String(v || ""));
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

const entier = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
const montantValide = (v) => Number.isInteger(v) && v >= 0;

// Moyen + compte compatibles (références non exigées avant le paiement effectif).
async function reglement(b) {
  if (!b.mode_paiement) return { valeurs: { mode_paiement: null, compte_id: null } };
  return preparerDecaissement(pool, { mode_paiement: b.mode_paiement, compte_id: b.compte_id || null }, { exigerReferences: false });
}

const SQL_LIGNES = `
  SELECT l.*, l.periode_debut::text AS periode_debut, l.periode_fin::text AS periode_fin, c.intitule AS compte_intitule, d.statut AS depense_statut,
         u.prenom || ' ' || u.nom AS decide_par_nom
  FROM etats_charges_lignes l
  LEFT JOIN comptes_bancaires c ON c.id = l.compte_id
  LEFT JOIN depenses d ON d.id = l.depense_id
  LEFT JOIN utilisateurs u ON u.id = l.decide_par
  WHERE l.etat_id = $1
  ORDER BY l.ordre, l.cree_le`;

async function chargerEtat(id) {
  const { rows: [etat] } = await pool.query(
    `SELECT e.*, e.mois::text AS mois, p.prenom || ' ' || p.nom AS prepare_par_nom
     FROM etats_charges e LEFT JOIN utilisateurs p ON p.id = e.prepare_par WHERE e.id = $1`, [id]);
  if (!etat) return null;
  const { rows: lignes } = await pool.query(SQL_LIGNES, [id]);
  const somme = (f) => lignes.filter(f).reduce((s, l) => s + Number(l.montant), 0);
  etat.lignes = lignes;
  etat.totaux = {
    total: somme((l) => l.decision !== "rejetee"),
    approuve: somme((l) => l.decision === "approuvee"),
    reporte: somme((l) => l.decision === "reportee"),
    rejete: somme((l) => l.decision === "rejetee"),
    a_decider: somme((l) => l.decision === "en_attente"),
  };
  etat.en_retard = lignes.filter((l) => l.retard_mois >= SEUIL_ALERTE_RETARD && l.decision === "en_attente").length;
  return etat;
}

// ---------------------------------------------------------------------
// Catalogue des charges habituelles
// ---------------------------------------------------------------------
router.get("/modeles", requirePermission("depenses.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, c.intitule AS compte_intitule FROM charges_modeles m
       LEFT JOIN comptes_bancaires c ON c.id = m.compte_id
       WHERE ($1::boolean OR m.actif) ORDER BY m.actif DESC, m.libelle`, [req.query.inactifs === "true"]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

async function ecrireModele(req, res, id) {
  const b = req.body || {};
  const montant = entier(b.montant_habituel ?? 0);
  if (!b.libelle || !String(b.libelle).trim()) return res.status(400).json({ error: "Le libellé est requis." });
  if (!montantValide(montant)) return res.status(400).json({ error: "Montant habituel invalide (entier en FCFA)." });
  const periodicite = b.periodicite || "mensuelle";
  if (!["mensuelle", "trimestrielle", "annuelle"].includes(periodicite)) return res.status(400).json({ error: "Périodicité invalide." });
  const moisEch = entier(b.mois_echeance);
  if (periodicite !== "mensuelle" && !(moisEch >= 1 && moisEch <= 12)) return res.status(400).json({ error: "Précisez le mois d'échéance (1 à 12) pour une charge trimestrielle ou annuelle." });
  const regl = await reglement(b);
  if (regl.erreur) return res.status(400).json({ error: regl.erreur });
  const v = [String(b.libelle).trim(), b.categorie || "autre", b.type || "fixe", montant, !!b.montant_variable,
    periodicite, periodicite === "mensuelle" ? null : moisEch, regl.valeurs.mode_paiement, regl.valeurs.compte_id];
  try {
    const sql = id
      ? `UPDATE charges_modeles SET libelle=$1, categorie=$2::categorie_depense, type=$3::type_depense, montant_habituel=$4,
           montant_variable=$5, periodicite=$6, mois_echeance=$7, mode_paiement=$8::mode_paiement, compte_id=$9::uuid,
           actif = COALESCE($11::boolean, actif)
         WHERE id=$10::uuid RETURNING *`
      : `INSERT INTO charges_modeles (libelle,categorie,type,montant_habituel,montant_variable,periodicite,mois_echeance,mode_paiement,compte_id,cree_par)
         VALUES ($1,$2::categorie_depense,$3::type_depense,$4,$5,$6,$7,$8::mode_paiement,$9::uuid,$10::uuid) RETURNING *`;
    const params = id ? [...v, id, typeof b.actif === "boolean" ? b.actif : null] : [...v, req.user.sub];
    const { rows } = await pool.query(sql, params);
    if (!rows[0]) return res.status(404).json({ error: "Charge introuvable." });
    res.status(id ? 200 : 201).json(rows[0]);
  } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
}
router.post("/modeles", requirePermission("depenses.creer"), (req, res) => ecrireModele(req, res, null));
router.put("/modeles/:id", requirePermission("depenses.creer"), (req, res) => ecrireModele(req, res, req.params.id));
// Retrait du catalogue = désactivation (les états déjà préparés ne changent pas).
router.delete("/modeles/:id", requirePermission("depenses.creer"), async (req, res) => {
  try {
    const { rowCount } = await pool.query("UPDATE charges_modeles SET actif = FALSE WHERE id = $1::uuid", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Charge introuvable." });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// ---------------------------------------------------------------------
// États mensuels
// ---------------------------------------------------------------------
router.get("/etats", requirePermission("depenses.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.mois::text AS mois, e.statut, e.soumis_le, e.clos_le,
              count(l.id)::int AS nb_lignes,
              COALESCE(sum(l.montant) FILTER (WHERE l.decision <> 'rejetee'), 0)::bigint AS total,
              count(l.id) FILTER (WHERE l.decision = 'en_attente')::int AS nb_a_decider,
              count(l.id) FILTER (WHERE l.decision = 'reportee')::int AS nb_reportees,
              count(l.id) FILTER (WHERE l.retard_mois >= $1 AND l.decision <> 'rejetee')::int AS nb_en_retard
       FROM etats_charges e LEFT JOIN etats_charges_lignes l ON l.etat_id = e.id
       GROUP BY e.id ORDER BY e.mois DESC`, [SEUIL_ALERTE_RETARD]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

router.get("/etats/:id", requirePermission("depenses.consulter"), async (req, res) => {
  try {
    const etat = await chargerEtat(req.params.id);
    if (!etat) return res.status(404).json({ error: "État introuvable." });
    res.json(etat);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/charges/etats { mois } — crée l'état du mois, pré-rempli par le
// catalogue (selon la périodicité) et par les lignes REPORTÉES des mois précédents.
router.post("/etats", requirePermission("depenses.creer"), async (req, res) => {
  const mois = premierDuMois((req.body || {}).mois);
  if (!mois) return res.status(400).json({ error: "Mois invalide (AAAA-MM)." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [etat] } = await client.query(
      `INSERT INTO etats_charges (mois, prepare_par) VALUES ($1::date, $2::uuid)
       ON CONFLICT (mois) DO NOTHING RETURNING id, mois::text AS mois`, [mois, req.user.sub]);
    if (!etat) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Un état existe déjà pour ce mois." }); }
    // Charges reportées non encore reprises.
    await client.query(
      `INSERT INTO etats_charges_lignes
         (etat_id, modele_id, libelle, categorie, type, montant, periode_debut, periode_fin, observation,
          mode_paiement, compte_id, report_de, retard_mois, ordre)
       SELECT $1::uuid, l.modele_id, l.libelle, l.categorie, l.type, l.montant, l.periode_debut, l.periode_fin, l.observation,
              l.mode_paiement, l.compte_id, l.id, l.retard_mois + 1, 0
       FROM etats_charges_lignes l JOIN etats_charges e ON e.id = l.etat_id
       WHERE l.decision = 'reportee' AND e.mois < $2::date
         AND NOT EXISTS (SELECT 1 FROM etats_charges_lignes s WHERE s.report_de = l.id)
       ORDER BY e.mois, l.ordre, l.cree_le`, [etat.id, mois]);
    // Charges habituelles du mois (mensuelles ; trimestrielles/annuelles à leur échéance).
    await client.query(
      `INSERT INTO etats_charges_lignes
         (etat_id, modele_id, libelle, categorie, type, montant, periode_debut, periode_fin, mode_paiement, compte_id, ordre)
       SELECT $1::uuid, m.id, m.libelle, m.categorie, m.type, m.montant_habituel, $2::date,
              ($2::date + CASE m.periodicite WHEN 'mensuelle' THEN interval '1 month' WHEN 'trimestrielle' THEN interval '3 months' ELSE interval '12 months' END
               - interval '1 day')::date,
              m.mode_paiement, m.compte_id, 10
       FROM charges_modeles m
       WHERE m.actif AND (m.periodicite = 'mensuelle'
          OR (m.periodicite = 'annuelle' AND m.mois_echeance = EXTRACT(MONTH FROM $2::date))
          OR (m.periodicite = 'trimestrielle' AND MOD(EXTRACT(MONTH FROM $2::date)::int - m.mois_echeance + 12, 3) = 0))
       ORDER BY m.libelle`, [etat.id, mois]);
    await client.query("COMMIT");
    await logAudit({ utilisateurId: req.user.sub, action: "etat_charges_cree", entite: "etat_charges", entiteId: etat.id, details: { mois } });
    res.status(201).json(await chargerEtat(etat.id));
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  } finally { client.release(); }
});

router.put("/etats/:id", requirePermission("depenses.creer"), async (req, res) => {
  try {
    const { rowCount } = await pool.query("UPDATE etats_charges SET note = $1 WHERE id = $2::uuid AND statut = 'en_preparation'",
      [(req.body || {}).note || null, req.params.id]);
    if (!rowCount) return res.status(409).json({ error: "État introuvable ou déjà soumis." });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

async function etatDe(id) {
  const { rows: [e] } = await pool.query("SELECT id, statut FROM etats_charges WHERE id = $1::uuid", [id]);
  return e;
}

// Ajout d'une ligne ponctuelle (état en préparation).
router.post("/etats/:id/lignes", requirePermission("depenses.creer"), async (req, res) => {
  const b = req.body || {};
  const montant = entier(b.montant);
  if (!b.libelle || !String(b.libelle).trim()) return res.status(400).json({ error: "Le libellé est requis." });
  if (!montantValide(montant)) return res.status(400).json({ error: "Montant invalide (entier en FCFA)." });
  const regl = await reglement(b);
  if (regl.erreur) return res.status(400).json({ error: regl.erreur });
  try {
    const etat = await etatDe(req.params.id);
    if (!etat) return res.status(404).json({ error: "État introuvable." });
    if (etat.statut !== "en_preparation") return res.status(409).json({ error: "L'état est déjà soumis : rouvrez-le pour ajouter une ligne." });
    const { rows } = await pool.query(
      `INSERT INTO etats_charges_lignes
         (etat_id, libelle, categorie, type, montant, periode_debut, periode_fin, observation, mode_paiement, compte_id, ordre)
       SELECT e.id, $2, $3::categorie_depense, $4::type_depense, $5, COALESCE($6::date, e.mois),
              COALESCE($7::date, $6::date, (e.mois + interval '1 month' - interval '1 day')::date), $8, $9::mode_paiement, $10::uuid, 20
       FROM etats_charges e WHERE e.id = $1::uuid RETURNING *`,
      [req.params.id, String(b.libelle).trim(), b.categorie || "autre", b.type || "ponctuelle", montant,
       b.periode_debut || null, b.periode_fin || null, b.observation || null, regl.valeurs.mode_paiement, regl.valeurs.compte_id]);
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
});

// Modification d'une ligne : préparation (tous les champs) ou, une fois l'état
// soumis, les associés peuvent corriger montant / moyen / compte d'une ligne en attente.
router.put("/etats/:id/lignes/:ligneId", requirePermission("depenses.consulter"), async (req, res) => {
  const b = req.body || {};
  try {
    const etat = await etatDe(req.params.id);
    if (!etat) return res.status(404).json({ error: "État introuvable." });
    const { rows: [l] } = await pool.query("SELECT * FROM etats_charges_lignes WHERE id = $1::uuid AND etat_id = $2::uuid", [req.params.ligneId, req.params.id]);
    if (!l) return res.status(404).json({ error: "Ligne introuvable." });
    const prepa = etat.statut === "en_preparation";
    const code = prepa ? "depenses.creer" : "depenses.decision";
    if (!(await estAutorise(req.user.role, code, req.user.sub))) return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
    if (etat.statut === "clos" || (!prepa && l.decision !== "en_attente")) return res.status(409).json({ error: "Cette ligne n'est plus modifiable." });
    const montant = b.montant === undefined ? Number(l.montant) : entier(b.montant);
    if (!montantValide(montant)) return res.status(400).json({ error: "Montant invalide (entier en FCFA)." });
    const regl = ("mode_paiement" in b || "compte_id" in b)
      ? await reglement({ mode_paiement: "mode_paiement" in b ? b.mode_paiement : l.mode_paiement, compte_id: "compte_id" in b ? b.compte_id : l.compte_id })
      : { valeurs: { mode_paiement: l.mode_paiement, compte_id: l.compte_id } };
    if (regl.erreur) return res.status(400).json({ error: regl.erreur });
    const libelle = prepa && b.libelle !== undefined ? String(b.libelle).trim() : l.libelle;
    if (!libelle) return res.status(400).json({ error: "Le libellé est requis." });
    const { rows } = await pool.query(
      `UPDATE etats_charges_lignes SET libelle=$1, categorie=$2::categorie_depense, type=$3::type_depense, montant=$4,
         periode_debut=$5::date, periode_fin=$6::date, observation=$7, mode_paiement=$8::mode_paiement, compte_id=$9::uuid
       WHERE id=$10::uuid RETURNING *`,
      [libelle, prepa && b.categorie ? b.categorie : l.categorie, prepa && b.type ? b.type : l.type, montant,
       prepa && "periode_debut" in b ? b.periode_debut || null : l.periode_debut,
       prepa && "periode_fin" in b ? b.periode_fin || null : l.periode_fin,
       prepa && "observation" in b ? b.observation || null : l.observation,
       regl.valeurs.mode_paiement, regl.valeurs.compte_id, l.id]);
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
});

router.delete("/etats/:id/lignes/:ligneId", requirePermission("depenses.creer"), async (req, res) => {
  try {
    const etat = await etatDe(req.params.id);
    if (!etat) return res.status(404).json({ error: "État introuvable." });
    if (etat.statut !== "en_preparation") return res.status(409).json({ error: "L'état est déjà soumis." });
    const { rows: [l] } = await pool.query("SELECT report_de FROM etats_charges_lignes WHERE id = $1::uuid AND etat_id = $2::uuid", [req.params.ligneId, req.params.id]);
    if (!l) return res.status(404).json({ error: "Ligne introuvable." });
    if (l.report_de) return res.status(409).json({ error: "Une charge reportée ne se supprime pas : les associés la rejettent s'il n'y a plus lieu de la payer." });
    await pool.query("DELETE FROM etats_charges_lignes WHERE id = $1::uuid", [req.params.ligneId]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Soumission aux associés / réouverture (tant qu'aucune décision n'a été prise).
router.post("/etats/:id/soumettre", requirePermission("depenses.creer"), async (req, res) => {
  try {
    const { rows: [n] } = await pool.query("SELECT count(*)::int AS n FROM etats_charges_lignes WHERE etat_id = $1::uuid", [req.params.id]);
    if (!n.n) return res.status(400).json({ error: "L'état est vide : ajoutez au moins une charge." });
    const { rowCount } = await pool.query(
      "UPDATE etats_charges SET statut = 'soumis', soumis_le = now() WHERE id = $1::uuid AND statut = 'en_preparation'", [req.params.id]);
    if (!rowCount) return res.status(409).json({ error: "État introuvable ou déjà soumis." });
    await logAudit({ utilisateurId: req.user.sub, action: "etat_charges_soumis", entite: "etat_charges", entiteId: req.params.id });
    res.json(await chargerEtat(req.params.id));
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

router.post("/etats/:id/rouvrir", requirePermission("depenses.creer"), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE etats_charges SET statut = 'en_preparation', soumis_le = NULL
       WHERE id = $1::uuid AND statut = 'soumis'
         AND NOT EXISTS (SELECT 1 FROM etats_charges_lignes WHERE etat_id = $1::uuid AND decision <> 'en_attente')`, [req.params.id]);
    if (!rowCount) return res.status(409).json({ error: "Impossible de rouvrir : l'état n'est pas soumis ou des décisions ont déjà été prises." });
    await logAudit({ utilisateurId: req.user.sub, action: "etat_charges_rouvert", entite: "etat_charges", entiteId: req.params.id });
    res.json(await chargerEtat(req.params.id));
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Décision des associés sur une ligne : approuvee (crée la dépense validée),
// rejetee (motif obligatoire) ou reportee (revient le mois suivant).
// Le moyen / compte / montant peuvent être orientés dans la même requête.
router.post("/etats/:id/lignes/:ligneId/decision", requirePermission("depenses.decision"), async (req, res) => {
  const b = req.body || {};
  if (!["approuvee", "rejetee", "reportee"].includes(b.decision)) return res.status(400).json({ error: "Décision invalide (approuvee, rejetee ou reportee)." });
  if (b.decision === "rejetee" && !String(b.motif || "").trim()) return res.status(400).json({ error: "Un motif est obligatoire pour rejeter une charge." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [l] } = await client.query(
      `SELECT l.*, e.statut AS etat_statut, e.mois::text AS mois FROM etats_charges_lignes l JOIN etats_charges e ON e.id = l.etat_id
       WHERE l.id = $1::uuid AND l.etat_id = $2::uuid FOR UPDATE OF l`, [req.params.ligneId, req.params.id]);
    if (!l) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Ligne introuvable." }); }
    if (l.etat_statut !== "soumis") { await client.query("ROLLBACK"); return res.status(409).json({ error: "L'état doit être soumis aux associés pour décider." }); }
    if (l.decision !== "en_attente") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Cette ligne a déjà fait l'objet d'une décision." }); }
    const montant = b.montant === undefined ? Number(l.montant) : entier(b.montant);
    if (!montantValide(montant)) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Montant invalide (entier en FCFA)." }); }
    const regl = await reglement({
      mode_paiement: "mode_paiement" in b ? b.mode_paiement : l.mode_paiement,
      compte_id: "compte_id" in b ? b.compte_id : l.compte_id });
    if (regl.erreur) { await client.query("ROLLBACK"); return res.status(400).json({ error: regl.erreur }); }
    const v = regl.valeurs;
    let depenseId = null;
    if (b.decision === "approuvee") {
      if (montant <= 0) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Le montant doit être positif pour approuver." }); }
      const { rows: [d] } = await client.query(
        `INSERT INTO depenses
           (nature, type, categorie, libelle, montant, date_depense, mode_paiement, compte_id, statut,
            soumis_par, valide_par, valide_le, cree_par)
         VALUES ('cabinet', $1::type_depense, $2::categorie_depense, $3, $4, current_date, $5::mode_paiement, $6::uuid, 'validee',
                 $7::uuid, $8::uuid, now(), $7::uuid)
         RETURNING id`,
        [l.type, l.categorie, `${l.libelle} — état des charges ${String(l.mois).slice(0, 7)}`, montant, v.mode_paiement, v.compte_id,
         (await client.query("SELECT prepare_par FROM etats_charges WHERE id = $1::uuid", [req.params.id])).rows[0].prepare_par || req.user.sub,
         req.user.sub]);
      depenseId = d.id;
    }
    const { rows: [maj] } = await client.query(
      `UPDATE etats_charges_lignes SET decision = $1, motif = $2, montant = $3, mode_paiement = $4::mode_paiement, compte_id = $5::uuid,
         decide_par = $6::uuid, decide_le = now(), depense_id = $7::uuid
       WHERE id = $8::uuid RETURNING *`,
      [b.decision, b.motif ? String(b.motif).trim() : null, montant, v.mode_paiement, v.compte_id, req.user.sub, depenseId, l.id]);
    await client.query("COMMIT");
    await logAudit({ utilisateurId: req.user.sub, action: `etat_charges_${b.decision}`, entite: "etat_charges_ligne", entiteId: l.id,
      details: { libelle: l.libelle, montant, retard_mois: l.retard_mois } });
    res.json(maj);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

// Clôture : toutes les lignes doivent avoir fait l'objet d'une décision.
router.post("/etats/:id/cloturer", requirePermission("depenses.decision"), async (req, res) => {
  try {
    const { rows: [r] } = await pool.query(
      "SELECT count(*)::int AS n FROM etats_charges_lignes WHERE etat_id = $1::uuid AND decision = 'en_attente'", [req.params.id]);
    if (r.n) return res.status(409).json({ error: `${r.n} ligne(s) attendent encore une décision (approuver, rejeter ou reporter).` });
    const { rowCount } = await pool.query(
      "UPDATE etats_charges SET statut = 'clos', clos_par = $2::uuid, clos_le = now() WHERE id = $1::uuid AND statut = 'soumis'", [req.params.id, req.user.sub]);
    if (!rowCount) return res.status(409).json({ error: "L'état n'est pas soumis aux associés." });
    await logAudit({ utilisateurId: req.user.sub, action: "etat_charges_clos", entite: "etat_charges", entiteId: req.params.id });
    res.json(await chargerEtat(req.params.id));
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// PDF paysage pour les associés (aperçu / impression).
router.get("/etats/:id/pdf", requirePermission("depenses.consulter"), async (req, res) => {
  try {
    const etat = await chargerEtat(req.params.id);
    if (!etat) return res.status(404).json({ error: "État introuvable." });
    const { rows: [c] } = await pool.query("SELECT raison_sociale FROM parametres_cabinet WHERE id = 1");
    const pdf = await genererEtatChargesPdf({ etat, lignes: etat.lignes, raisonSociale: c && c.raison_sociale });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="etat-charges-${String(etat.mois).slice(0, 7)}.pdf"`);
    res.send(pdf);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

module.exports = router;
