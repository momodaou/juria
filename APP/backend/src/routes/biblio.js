// JURIA — Bibliothèque : jurisprudence, textes OHADA/nationaux, veille
// législative, modèles documentaires, consultations anonymisées, checklists.
const express = require("express");
const multer = require("multer");
const { pool } = require("../db");
const { saveObject, readObject } = require("../storage");
const { filtreTypeFichier } = require("../uploadFilter");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 }, fileFilter: filtreTypeFichier });
const router = express.Router();

// GET /api/biblio?type=&matiere=&q=
router.get("/", async (req, res) => {
  const { type, matiere, q } = req.query;
  const params = [];
  const clauses = [];
  if (type) { params.push(type); clauses.push(`type = $${params.length}`); }
  if (matiere) { params.push(`%${matiere}%`); clauses.push(`matiere ILIKE $${params.length}`); }
  if (q) { params.push(`%${q}%`); clauses.push(`(titre ILIKE $${params.length} OR reference ILIKE $${params.length})`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT id, type, titre, reference, source, matiere, date_publication,
              resume, (chemin_storage IS NOT NULL) AS a_fichier, cree_le
       FROM ressources_biblio ${where}
       ORDER BY cree_le DESC LIMIT 300`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/biblio/:id
router.get("/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM ressources_biblio WHERE id = $1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Ressource introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/biblio  (multipart/form-data ou JSON)
// champs : type, titre, reference?, source?, matiere?, date_publication?, resume?, fichier?
router.post("/", upload.single("fichier"), async (req, res) => {
  const b = req.body || {};
  if (!b.type || !b.titre) return res.status(400).json({ error: "type et titre requis" });
  try {
    let chemin = null, mime = null;
    if (req.file) {
      const dest = `biblio/${Date.now()}_${req.file.originalname}`.replace(/\s+/g, "_");
      chemin = await saveObject(req.file.buffer, dest, req.file.mimetype);
      mime = req.file.mimetype;
    }
    const { rows } = await pool.query(
      `INSERT INTO ressources_biblio
         (type, titre, reference, source, matiere, date_publication, resume, chemin_storage, type_mime, cree_par)
       VALUES ($1::type_ressource_biblio,$2,$3,COALESCE($4,'National'),$5,$6,$7,$8,$9,$10)
       RETURNING id, type, titre, reference, cree_le`,
      [b.type, b.titre, b.reference || null, b.source || null, b.matiere || null,
       b.date_publication || null, b.resume || null, chemin, mime, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// GET /api/biblio/:id/fichier
router.get("/:id/fichier", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT titre, type_mime, chemin_storage FROM ressources_biblio WHERE id = $1",
      [req.params.id]
    );
    if (!rows[0] || !rows[0].chemin_storage) return res.status(404).json({ error: "Aucun fichier associé" });
    const buf = await readObject(rows[0].chemin_storage);
    res.setHeader("Content-Type", rows[0].type_mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${rows[0].titre}"`);
    res.send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /api/biblio/:id
router.delete("/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM ressources_biblio WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Ressource introuvable" });
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
