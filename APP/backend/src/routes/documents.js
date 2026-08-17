// JURIA — GED : téléversement et téléchargement des pièces
const express = require("express");
const multer = require("multer");
const { pool } = require("../db");
const { saveObject, readObject } = require("../storage");
const { filtreTypeFichier } = require("../uploadFilter");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 Mo
  fileFilter: filtreTypeFichier,
});
const router = express.Router();

// POST /api/documents  (multipart/form-data)
// champs : fichier (binaire), dossier_id, categorie?, confidentialite?, nom?
router.post("/", upload.single("fichier"), async (req, res) => {
  const b = req.body || {};
  if (!req.file) return res.status(400).json({ error: "Fichier manquant" });
  if (!b.dossier_id) return res.status(400).json({ error: "dossier_id requis" });
  try {
    const nom = b.nom || req.file.originalname;
    // Versioning : version = max(version) + 1 pour le même dossier + nom
    const v = await pool.query(
      "SELECT COALESCE(MAX(version), 0) + 1 AS v FROM documents WHERE dossier_id = $1 AND nom = $2",
      [b.dossier_id, nom]
    );
    const version = v.rows[0].v;
    const dest = `${b.dossier_id}/${Date.now()}_${nom}`.replace(/\s+/g, "_");
    const chemin = await saveObject(req.file.buffer, dest, req.file.mimetype);

    const ins = await pool.query(
      `INSERT INTO documents
         (dossier_id, nom, categorie, version, statut, confidentialite,
          chemin_storage, type_mime, taille_octets, auteur_id)
       VALUES ($1,$2,COALESCE($3::categorie_document,'autre'),$4,'brouillon',COALESCE($5::confidentialite,'dossier'),$6,$7,$8,$9)
       RETURNING id, nom, categorie, version, statut, confidentialite, cree_le`,
      [b.dossier_id, nom, b.categorie, version, b.confidentialite,
       chemin, req.file.mimetype, req.file.size, req.user.sub]
    );
    res.status(201).json(ins.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// GET /api/documents/:id/download  -> renvoie le fichier
router.get("/:id/download", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT nom, type_mime, chemin_storage FROM documents WHERE id = $1",
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Document introuvable" });
    const buf = await readObject(rows[0].chemin_storage);
    res.setHeader("Content-Type", rows[0].type_mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${rows[0].nom}"`);
    res.send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
