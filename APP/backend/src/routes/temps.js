// JURIA — Temps passé (timesheet)
const express = require("express");
const { pool } = require("../db");
const router = express.Router();

// GET /api/temps?dossier_id=...   (sinon : mes saisies)
router.get("/", async (req, res) => {
  const { dossier_id } = req.query;
  const params = [];
  let where = "WHERE t.utilisateur_id = $1";
  params.push(req.user.sub);
  if (dossier_id) { params.push(dossier_id); where = `WHERE t.dossier_id = $${params.length}`; }
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.date_saisie, t.duree_minutes, t.taux_horaire, t.facturable, t.description,
              d.numero AS dossier_numero, u.prenom || ' ' || u.nom AS auteur
       FROM temps t
       JOIN dossiers d ON d.id = t.dossier_id
       JOIN utilisateurs u ON u.id = t.utilisateur_id
       ${where}
       ORDER BY t.date_saisie DESC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/temps  { dossier_id, duree_minutes, taux_horaire?, facturable?, description?, date_saisie? }
router.post("/", async (req, res) => {
  const b = req.body || {};
  if (!b.dossier_id || !b.duree_minutes) {
    return res.status(400).json({ error: "dossier_id et duree_minutes requis" });
  }
  try {
    // Taux par défaut = taux horaire de l'utilisateur si non fourni
    let taux = b.taux_horaire;
    if (taux === undefined || taux === null || taux === "") {
      const u = await pool.query("SELECT taux_horaire FROM utilisateurs WHERE id = $1", [req.user.sub]);
      taux = u.rows[0] ? u.rows[0].taux_horaire : 0;
    }
    const { rows } = await pool.query(
      `INSERT INTO temps (dossier_id, utilisateur_id, date_saisie, duree_minutes, taux_horaire, facturable, description)
       VALUES ($1,$2,COALESCE($3, current_date),$4,$5,COALESCE($6,true),$7)
       RETURNING id, date_saisie, duree_minutes, taux_horaire, facturable`,
      [b.dossier_id, req.user.sub, b.date_saisie || null, b.duree_minutes, taux, b.facturable, b.description]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
