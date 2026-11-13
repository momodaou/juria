// JURIA — Avocats apporteurs (13/11/2026) : désignation par dossier (ou par client sous convention-cadre), statut de
// rétrocession de la convention, exclusion d'une facture. Les montants sont créés par retrocessionsAuto.js.
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const { logAudit } = require("../audit");
const auto = require("../retrocessionsAuto");
const router = express.Router();

const estAssocie = (role) => role === "associe" || role === "associe_fondateur";

async function lister(colonne, id) {
  const { rows } = await pool.query(
    `SELECT a.utilisateur_id, a.part_pct, u.prenom || ' ' || u.nom AS nom, u.role::text AS role
     FROM apporteurs a JOIN utilisateurs u ON u.id = a.utilisateur_id WHERE a.${colonne} = $1 ORDER BY a.cree_le, u.nom`, [id]);
  return rows.map((r) => ({ ...r, part_pct: Number(r.part_pct), qualite: auto.qualiteDuRole(r.role), taux: auto.TAUX[auto.qualiteDuRole(r.role)] }));
}

// GET /api/apporteurs?dossier_id= | ?client_id=   (rémunération individuelle : même palier que la consultation des rétrocessions)
router.get("/", requirePermission("retrocessions.consulter"), async (req, res) => {
  const { dossier_id, client_id } = req.query;
  if (!dossier_id && !client_id) return res.status(400).json({ error: "dossier_id ou client_id requis" });
  try {
    const effet = await auto.dateEffet();
    const out = { date_effet: effet, apporteurs: await lister(dossier_id ? "dossier_id" : "client_id", dossier_id || client_id) };
    if (dossier_id) {
      const { rows: [d] } = await pool.query("SELECT date_ouverture::text AS d FROM dossiers WHERE id = $1", [dossier_id]);
      if (!d) return res.status(404).json({ error: "Dossier introuvable" });
      out.eligible = d.d >= effet;
      const { rows: [v] } = await pool.query("SELECT 1 FROM retrocessions WHERE dossier_id = $1 AND origine = 'apport' LIMIT 1", [dossier_id]);
      out.verrouille = !!v;
    } else {
      const { rows: [c] } = await pool.query("SELECT retro_abonnement, abonnement_periodicite FROM clients WHERE id = $1", [client_id]);
      if (!c) return res.status(404).json({ error: "Client introuvable" });
      out.retro_abonnement = c.retro_abonnement;
      out.sous_convention = !!c.abonnement_periodicite;
      const { rows: [v] } = await pool.query(
        `SELECT 1 FROM retrocessions r JOIN factures f ON f.id = r.facture_id WHERE f.client_id = $1 AND f.mode = 'abonnement' AND r.origine = 'apport' LIMIT 1`, [client_id]);
      out.verrouille = !!v;
    }
    res.json(out);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

async function remplacer(req, res, colonne, id) {
  const n = await auto.normaliserApporteurs((req.body || {}).apporteurs);
  if (n.erreur) return res.status(400).json({ error: n.erreur });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [v] } = colonne === "dossier_id"
      ? await client.query("SELECT 1 FROM retrocessions WHERE dossier_id = $1 AND origine = 'apport' LIMIT 1", [id])
      : await client.query(`SELECT 1 FROM retrocessions r JOIN factures f ON f.id = r.facture_id WHERE f.client_id = $1 AND f.mode = 'abonnement' AND r.origine = 'apport' LIMIT 1`, [id]);
    if (v && !estAssocie(req.user.role)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Des rétrocessions ont déjà été calculées : seul un associé peut modifier les apporteurs." });
    }
    await client.query(`DELETE FROM apporteurs WHERE ${colonne} = $1`, [id]);
    for (const a of n.apporteurs) {
      await client.query(`INSERT INTO apporteurs (${colonne}, utilisateur_id, part_pct, cree_par) VALUES ($1,$2,$3,$4)`, [id, a.utilisateur_id, a.part_pct, req.user.sub]);
    }
    const crees = colonne === "dossier_id" ? await auto.rattraperDossier(id, client) : await auto.rattraperClient(id, client);
    await client.query("COMMIT");
    await logAudit({ utilisateurId: req.user.sub, action: "designer_apporteurs", entite: colonne === "dossier_id" ? "dossiers" : "clients", entiteId: id,
      details: { apporteurs: n.apporteurs, retrocessions_rattrapees: crees }, ip: req.ip });
    res.json({ apporteurs: await lister(colonne, id), retrocessions_creees: crees });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
}

// PUT /api/apporteurs/dossier/:id  { apporteurs: [{ utilisateur_id, part_pct? }] }  (liste vide = aucun apporteur)
router.put("/dossier/:id", requirePermission("retrocessions.creer"), async (req, res) => {
  try {
    const { rows: [d] } = await pool.query("SELECT date_ouverture::text AS d FROM dossiers WHERE id = $1", [req.params.id]);
    if (!d) return res.status(404).json({ error: "Dossier introuvable" });
    const effet = await auto.dateEffet();
    const liste = (req.body || {}).apporteurs;
    if (Array.isArray(liste) && liste.length && d.d < effet) {
      return res.status(400).json({ error: `Ce dossier a été ouvert avant le ${effet} : les rétrocessions ne s'appliquent qu'aux dossiers apportés à compter de cette date.` });
    }
    await remplacer(req, res, "dossier_id", req.params.id);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// PUT /api/apporteurs/client/:id  { apporteurs: [...] }  — apporteurs d'une convention-cadre (abonnement)
router.put("/client/:id", requirePermission("retrocessions.creer"), async (req, res) => {
  try {
    const { rows: [c] } = await pool.query("SELECT 1 FROM clients WHERE id = $1", [req.params.id]);
    if (!c) return res.status(404).json({ error: "Client introuvable" });
    await remplacer(req, res, "client_id", req.params.id);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// PUT /api/apporteurs/client/:id/convention  { retro_abonnement: 'aucune' | 'une_fois' }
router.put("/client/:id/convention", requirePermission("retrocessions.creer"), async (req, res) => {
  const v = (req.body || {}).retro_abonnement;
  if (!["aucune", "une_fois"].includes(v)) return res.status(400).json({ error: "retro_abonnement : « aucune » ou « une_fois »." });
  try {
    const { rows: [c] } = await pool.query("UPDATE clients SET retro_abonnement = $1 WHERE id = $2 RETURNING id, retro_abonnement", [v, req.params.id]);
    if (!c) return res.status(404).json({ error: "Client introuvable" });
    await logAudit({ utilisateurId: req.user.sub, action: "statut_retro_convention", entite: "clients", entiteId: req.params.id, details: { retro_abonnement: v }, ip: req.ip });
    const crees = v === "une_fois" ? await auto.rattraperClient(req.params.id) : 0;
    res.json({ ...c, retrocessions_creees: crees });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// PUT /api/apporteurs/facture/:id/exclusion  { exclue: bool, motif? }
// Exclut une facture de la rétrocession (incident postérieur à une procédure préalable…). Les rétrocessions automatiques non
// décaissées de cette facture sont retirées ; si l'une est déjà décaissée, refus.
router.put("/facture/:id/exclusion", requirePermission("retrocessions.creer"), async (req, res) => {
  const exclue = !!(req.body || {}).exclue;
  const motif = ((req.body || {}).motif || "").toString().trim() || null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [f] } = await client.query("SELECT id FROM factures WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!f) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Facture introuvable" }); }
    if (exclue) {
      const { rows: [dec] } = await client.query("SELECT 1 FROM retrocessions WHERE facture_id = $1 AND origine = 'apport' AND statut = 'decaissee' LIMIT 1", [req.params.id]);
      if (dec) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Une rétrocession de cette facture est déjà décaissée : exclusion impossible." }); }
      await client.query("DELETE FROM retrocessions WHERE facture_id = $1 AND origine = 'apport'", [req.params.id]);
    }
    await client.query("UPDATE factures SET retro_exclue = $1, retro_exclue_motif = $2 WHERE id = $3", [exclue, exclue ? motif : null, req.params.id]);
    const crees = exclue ? [] : await auto.declencherPourFacture(req.params.id, client);
    await client.query("COMMIT");
    await logAudit({ utilisateurId: req.user.sub, action: exclue ? "exclure_facture_retro" : "reintegrer_facture_retro", entite: "factures", entiteId: req.params.id, details: { motif }, ip: req.ip });
    res.json({ id: req.params.id, retro_exclue: exclue, retrocessions_creees: crees.length });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

module.exports = router;
