// JURIA — Tâches internes (plan d'action)
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const router = express.Router();

// GET /api/taches?dossier_id=...  |  ?mine=1  (mes tâches)
router.get("/", async (req, res) => {
  const { dossier_id, mine } = req.query;
  const params = [];
  let where = "";
  if (dossier_id) { params.push(dossier_id); where = `WHERE t.dossier_id = $${params.length}`; }
  else if (mine) { params.push(req.user.sub); where = `WHERE t.responsable_id = $${params.length}`; }
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.titre, t.type, t.priorite, t.statut, t.echeance, t.validation_requise,
              d.numero AS dossier_numero,
              u.prenom || ' ' || u.nom AS responsable
       FROM taches t
       LEFT JOIN dossiers d ON d.id = t.dossier_id
       LEFT JOIN utilisateurs u ON u.id = t.responsable_id
       ${where}
       ORDER BY t.echeance NULLS LAST, t.cree_le DESC
       LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/taches  { dossier_id?, titre, type?, priorite?, echeance?, responsable_id?, validation_requise? }
router.post("/", requirePermission("taches.creer"), async (req, res) => {
  const b = req.body || {};
  if (!b.titre) return res.status(400).json({ error: "titre requis" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO taches
         (dossier_id, titre, type, priorite, statut, echeance, responsable_id, validation_requise, cree_par)
       VALUES ($1,$2,COALESCE($3::type_tache,'autre'),COALESCE($4::priorite_tache,'normale'),'a_faire',$5,
               COALESCE($6::uuid,$8::uuid),COALESCE($7,false),$8)
       RETURNING id, titre, statut, priorite, echeance`,
      [b.dossier_id || null, b.titre, b.type, b.priorite, b.echeance || null,
       b.responsable_id || null, b.validation_requise, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/taches/:id  { statut }
router.put("/:id", requirePermission("taches.statut.modifier"), async (req, res) => {
  const { statut } = req.body || {};
  const permis = ["a_faire", "en_cours", "a_valider", "termine", "annule"];
  if (!permis.includes(statut)) return res.status(400).json({ error: "statut invalide" });
  try {
    const { rows } = await pool.query(
      "UPDATE taches SET statut = $1 WHERE id = $2 RETURNING id, statut",
      [statut, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Tâche introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/taches/:id/valider  (réservé aux associés)
router.post("/:id/valider", requirePermission("taches.valider"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE taches SET statut = 'termine', valide_par = $1, valide_le = now()
       WHERE id = $2 RETURNING id, statut`,
      [req.user.sub, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Tâche introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
