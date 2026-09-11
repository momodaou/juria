// JURIA — Diligences (planning des rendez-vous/démarches de terrain :
// audition en juridiction, enquête, formalité, expertise…) — gap comblé le
// 11/09/2026. La table et son catalogue listes_valeurs('type_diligence')
// existaient depuis le tout premier schéma, mais seul le déclencheur
// automatique de courriers.js y écrivait (POST courrier de type
// "convocation" sur un dossier) — aucune route pour les consulter,
// en créer une à la main, ou faire évoluer leur statut. Trouvé en
// répondant à une question de l'utilisateur sur l'interconnexion entre
// Registre du courrier, Rôle d'audience et les dossiers.
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const router = express.Router();

// GET /api/diligences?dossier_id=&statut=  — même permission de
// consultation que le reste du module Rôle d'audience.
router.get("/", requirePermission("audiences.consulter"), async (req, res) => {
  const { dossier_id, statut } = req.query;
  const params = [];
  const clauses = [];
  if (dossier_id) { params.push(dossier_id); clauses.push(`dl.dossier_id = $${params.length}`); }
  if (statut) { params.push(statut); clauses.push(`dl.statut = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT dl.id, dl.type_diligence, dl.type_precision, dl.dossier_id,
              d.numero AS dossier_numero, d.intitule AS dossier_intitule,
              dl.membre_id, u.prenom || ' ' || u.nom AS membre_nom,
              dl.date_diligence, dl.heure, dl.lieu, dl.objet, dl.statut,
              dl.observations, dl.courrier_id
       FROM diligences dl
       LEFT JOIN dossiers d ON d.id = dl.dossier_id
       LEFT JOIN utilisateurs u ON u.id = dl.membre_id
       ${where}
       ORDER BY dl.date_diligence, dl.heure NULLS LAST
       LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/diligences
// { type_diligence?, type_precision?, dossier_id?, membre_id?, date_diligence,
//   heure?, lieu?, objet?, observations? } — dossier_id optionnel : une
// diligence peut exister sans dossier précis (ex. formalité générale de
// greffe), contrairement aux audiences du rôle hebdomadaire.
router.post("/", requirePermission("audiences.diligence.gerer"), async (req, res) => {
  const b = req.body || {};
  if (!b.date_diligence) return res.status(400).json({ error: "date_diligence requis" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO diligences
         (type_diligence, type_precision, dossier_id, membre_id, date_diligence, heure, lieu, objet, observations, cree_par)
       VALUES (COALESCE($1,'diligence'),$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, type_diligence, date_diligence, statut`,
      [b.type_diligence || null, b.type_precision || null, b.dossier_id || null, b.membre_id || null,
       b.date_diligence, b.heure || null, b.lieu || null, b.objet || null, b.observations || null, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/diligences/:id/statut  { statut: 'fait'|'reporte'|'annule' }
router.put("/:id/statut", requirePermission("audiences.diligence.gerer"), async (req, res) => {
  const { statut } = req.body || {};
  if (!["fait", "reporte", "annule", "a_faire"].includes(statut)) {
    return res.status(400).json({ error: "Statut invalide" });
  }
  try {
    const { rows } = await pool.query(
      "UPDATE diligences SET statut = $1 WHERE id = $2 RETURNING id, statut",
      [statut, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Diligence introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
