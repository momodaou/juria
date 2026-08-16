// JURIA — Assistant IA juridique : résumé de pièce, chronologie.
// Toujours renvoyer a_valider = true : validation obligatoire par l'avocat.
const express = require("express");
const { pool } = require("../db");
const { generer } = require("../ia");
const router = express.Router();

// POST /api/ia/resume  { texte? , document_id? }
router.post("/resume", async (req, res) => {
  const b = req.body || {};
  try {
    let texte = b.texte || "";
    if (!texte && b.document_id) {
      const d = await pool.query("SELECT ocr_texte FROM documents WHERE id = $1", [b.document_id]);
      texte = (d.rows[0] && d.rows[0].ocr_texte) || "";
    }
    if (!texte) return res.status(400).json({ error: "Aucun texte à résumer (fournir « texte » ou un document avec OCR)." });

    const instruction =
      "Tu es un assistant juridique pour un cabinet d'avocats au Mali (droit national et OHADA). " +
      "Résume le texte suivant en français, de manière factuelle et fidèle, sans rien inventer ni interpréter au-delà du texte. " +
      "Sois concis et structuré. Termine impérativement par la mention : « Projet à valider par l'avocat. »";
    const resume = await generer(instruction, texte);
    res.json({ resume, a_valider: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur du service IA" });
  }
});

// POST /api/ia/chronologie  { texte? , dossier_id? }
router.post("/chronologie", async (req, res) => {
  const b = req.body || {};
  try {
    let texte = b.texte || "";
    if (!texte && b.dossier_id) {
      const d = await pool.query(
        "SELECT string_agg(COALESCE(ocr_texte, ''), E'\\n') AS t FROM documents WHERE dossier_id = $1",
        [b.dossier_id]
      );
      texte = (d.rows[0] && d.rows[0].t) || "";
    }
    if (!texte) return res.status(400).json({ error: "Aucun texte disponible pour la chronologie." });

    const instruction =
      "Tu es un assistant juridique. À partir du texte, dresse une chronologie des faits datés, " +
      "au format « JJ/MM/AAAA — événement », une ligne par fait, dans l'ordre chronologique, sans rien inventer. " +
      "Termine impérativement par la mention : « Projet à valider par l'avocat. »";
    const chronologie = await generer(instruction, texte);
    res.json({ chronologie, a_valider: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur du service IA" });
  }
});

module.exports = router;
