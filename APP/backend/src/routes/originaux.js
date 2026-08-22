// JURIA — Registre des originaux et pièces physiques confiés par le client
// (titres de propriété, contrats originaux, pièces d'identité…) — à restituer en fin de dossier.
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const router = express.Router();

// GET /api/originaux?client_id=&dossier_id=&restitue=false
router.get("/", async (req, res) => {
  const { client_id, dossier_id, restitue } = req.query;
  const params = [];
  const clauses = [];
  if (client_id) { params.push(client_id); clauses.push(`o.client_id = $${params.length}`); }
  if (dossier_id) { params.push(dossier_id); clauses.push(`o.dossier_id = $${params.length}`); }
  if (restitue !== undefined) { params.push(restitue === "true"); clauses.push(`o.restitue = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.type_piece, o.description, o.recu_le, o.emplacement,
              o.restitue, o.restitue_le, o.restitue_a,
              COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client_nom,
              d.numero AS dossier_numero
       FROM originaux_confies o
       LEFT JOIN clients c ON c.id = o.client_id
       LEFT JOIN dossiers d ON d.id = o.dossier_id
       ${where}
       ORDER BY o.restitue ASC, o.recu_le DESC`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/originaux
// body : { client_id, dossier_id?, type_piece, description, emplacement?, recu_le? }
router.post("/", requirePermission("originaux.creer"), async (req, res) => {
  const b = req.body || {};
  if (!b.description) return res.status(400).json({ error: "description requise" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO originaux_confies
         (client_id, dossier_id, type_piece, description, emplacement, recu_le, recu_par)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6, current_date),$7)
       RETURNING id, type_piece, description, recu_le, emplacement, restitue`,
      [b.client_id || null, b.dossier_id || null, b.type_piece || null,
       b.description, b.emplacement || null, b.recu_le || null, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/originaux/:id/restituer   { restitue_a }
router.post("/:id/restituer", requirePermission("originaux.restituer"), async (req, res) => {
  const { restitue_a } = req.body || {};
  if (!restitue_a) return res.status(400).json({ error: "restitue_a requis (à qui l'original est remis)" });
  try {
    const { rows } = await pool.query(
      `UPDATE originaux_confies
       SET restitue = TRUE, restitue_le = current_date, restitue_a = $1
       WHERE id = $2
       RETURNING id, restitue, restitue_le, restitue_a`,
      [restitue_a, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Original introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
