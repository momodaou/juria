// JURIA — GED : téléversement et téléchargement des pièces
const express = require("express");
const multer = require("multer");
const { pool } = require("../db");
const { saveObject, readObject, deleteObject, FichierIntrouvableError } = require("../storage");
const { filtreTypeFichier } = require("../uploadFilter");
const { requirePermission } = require("../permissions");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 Mo
  fileFilter: filtreTypeFichier,
});
const router = express.Router();

// POST /api/documents  (multipart/form-data)
// champs : fichier (binaire), dossier_id, categorie?, confidentialite?, nom?
router.post("/", requirePermission("documents.creer"), upload.single("fichier"), async (req, res) => {
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
    if (e instanceof FichierIntrouvableError) {
      // Cas réel rencontré (28/08/2026) : documents déposés avant le
      // correctif GED du 21/08/2026 (GED_BUCKET absent), écrits sur le
      // disque éphémère du conteneur puis perdus au(x) redéploiement(s)
      // suivant(s) — fichier définitivement introuvable, pas une panne.
      return res.status(404).json({ error: "Fichier introuvable dans le stockage — probablement déposé avant le 21/08/2026 (perdu lors d'un redéploiement, cf. HISTORY.md) ; à retéléverser." });
    }
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /api/documents/:id
// Constat utilisateur (28/08/2026) : « on ne peut pas supprimer de
// documents du GED » — confirmé, il n'existait tout simplement aucune
// route de suppression (ni permission dédiée, ni bouton côté écran), pas
// un souci de matrice de permissions comme suspecté. Ajouté ici, même
// patron que clients.js (kyc-pieces) et biblio.js — ouvert à tous les
// rôles par défaut (voir schema.sql), pas restreint à la direction.
// Supprime aussi l'objet physique (deleteObject, tolérant à un objet déjà
// absent) : les suppressions KYC/bibliothèque existantes ne le faisaient
// pas (gap déjà documenté le 21/08/2026, cf. HISTORY.md) — corrigé ici dès
// la création de cette route plutôt que reproduit.
router.delete("/:id", requirePermission("documents.supprimer"), async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT chemin_storage FROM documents WHERE id = $1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Document introuvable" });
    await pool.query("DELETE FROM documents WHERE id = $1", [req.params.id]);
    await deleteObject(rows[0].chemin_storage);
    res.status(204).end();
  } catch (e) {
    // Contrainte de clé étrangère (ex. bulletin de paie archivant ce
    // document) : refus explicite plutôt qu'un 500 brut. Cas non atteint
    // en pratique aujourd'hui (cabinet.js n'écrit jamais bulletins_paie.
    // document_id), gardé par précaution.
    if (e.code === "23503") {
      return res.status(409).json({ error: "Ce document est référencé ailleurs (ex. un bulletin de paie archivé) et ne peut pas être supprimé." });
    }
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
