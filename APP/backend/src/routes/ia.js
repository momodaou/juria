// JURIA — Assistant IA juridique : résumé, chronologie, extraction de faits,
// analyse contractuelle, traduction, comparaison de documents.
// Toujours renvoyer a_valider = true : validation obligatoire par l'avocat,
// aucune décision automatique (garde-fou déjà appliqué dans src/ia.js).
const express = require("express");
const { pool } = require("../db");
const { generer } = require("../ia");
const { requirePermission } = require("../permissions");
const router = express.Router();

// Résout le texte source à partir du corps de la requête : texte fourni
// directement, ou récupéré depuis un document (OCR) / tous les documents d'un dossier.
async function texteSource(b) {
  if (b.texte) return b.texte;
  if (b.document_id) {
    const d = await pool.query("SELECT ocr_texte FROM documents WHERE id = $1", [b.document_id]);
    return (d.rows[0] && d.rows[0].ocr_texte) || "";
  }
  if (b.dossier_id) {
    const d = await pool.query(
      "SELECT string_agg(COALESCE(ocr_texte, ''), E'\\n') AS t FROM documents WHERE dossier_id = $1",
      [b.dossier_id]
    );
    return (d.rows[0] && d.rows[0].t) || "";
  }
  return "";
}

const GARDE_FOU = "Termine impérativement par la mention : « Projet à valider par l'avocat. »";

// POST /api/ia/resume  { texte? , document_id? }
router.post("/resume", requirePermission("ia.resume"), async (req, res) => {
  try {
    const texte = await texteSource(req.body || {});
    if (!texte) return res.status(400).json({ error: "Aucun texte à résumer (fournir « texte », un document ou un dossier avec OCR)." });
    const instruction =
      "Tu es un assistant juridique pour un cabinet d'avocats au Mali (droit national et OHADA). " +
      "Résume le texte suivant en français, de manière factuelle et fidèle, sans rien inventer ni interpréter au-delà du texte. " +
      "Sois concis et structuré. " + GARDE_FOU;
    res.json({ resume: await generer(instruction, texte), a_valider: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur du service IA" });
  }
});

// POST /api/ia/chronologie  { texte? , dossier_id? }
router.post("/chronologie", requirePermission("ia.chronologie"), async (req, res) => {
  try {
    const texte = await texteSource(req.body || {});
    if (!texte) return res.status(400).json({ error: "Aucun texte disponible pour la chronologie." });
    const instruction =
      "Tu es un assistant juridique. À partir du texte, dresse une chronologie des faits datés, " +
      "au format « JJ/MM/AAAA — événement », une ligne par fait, dans l'ordre chronologique, sans rien inventer. " + GARDE_FOU;
    res.json({ chronologie: await generer(instruction, texte), a_valider: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur du service IA" });
  }
});

// POST /api/ia/extraction-faits  { texte?, document_id?, dossier_id? }
router.post("/extraction-faits", requirePermission("ia.extraction_faits"), async (req, res) => {
  try {
    const texte = await texteSource(req.body || {});
    if (!texte) return res.status(400).json({ error: "Aucun texte disponible pour l'extraction." });
    const instruction =
      "Tu es un assistant juridique. Extrais du texte les faits juridiquement pertinents " +
      "(parties, montants, dates, engagements, obligations) sous forme de liste à puces claire et factuelle, " +
      "sans rien inventer ni interpréter au-delà du texte. " + GARDE_FOU;
    res.json({ faits: await generer(instruction, texte), a_valider: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur du service IA" });
  }
});

// POST /api/ia/analyse-contrat  { texte?, document_id? }
router.post("/analyse-contrat", requirePermission("ia.analyse_contrat"), async (req, res) => {
  try {
    const texte = await texteSource(req.body || {});
    if (!texte) return res.status(400).json({ error: "Aucun texte de contrat fourni." });
    const instruction =
      "Tu es un assistant juridique spécialisé en droit des contrats (OHADA/national, Mali). " +
      "Analyse le contrat fourni : identifie les clauses principales (objet, durée, prix, résiliation, " +
      "responsabilité, droit applicable), et signale les points de vigilance ou clauses inhabituelles/déséquilibrées, " +
      "sans donner d'avis juridique définitif ni inventer de clauses absentes du texte. " + GARDE_FOU;
    res.json({ analyse: await generer(instruction, texte), a_valider: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur du service IA" });
  }
});

// POST /api/ia/traduction  { texte?, document_id?, langue_cible }
router.post("/traduction", requirePermission("ia.traduction"), async (req, res) => {
  const b = req.body || {};
  const langue = b.langue_cible || "anglais";
  try {
    const texte = await texteSource(b);
    if (!texte) return res.status(400).json({ error: "Aucun texte à traduire." });
    const instruction =
      `Tu es un assistant juridique. Traduis fidèlement le texte suivant en ${langue}, ` +
      "en conservant la terminologie juridique appropriée, sans en modifier le sens. " + GARDE_FOU;
    res.json({ traduction: await generer(instruction, texte), langue_cible: langue, a_valider: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur du service IA" });
  }
});

// POST /api/ia/comparaison  { texte_a, texte_b }  (ou document_id_a/document_id_b)
router.post("/comparaison", requirePermission("ia.comparaison"), async (req, res) => {
  const b = req.body || {};
  try {
    const texteA = await texteSource({ texte: b.texte_a, document_id: b.document_id_a });
    const texteB = await texteSource({ texte: b.texte_b, document_id: b.document_id_b });
    if (!texteA || !texteB) return res.status(400).json({ error: "Les deux textes à comparer sont requis." });
    const instruction =
      "Tu es un assistant juridique. Compare les deux versions de texte fournies (ex. deux versions d'un même acte) " +
      "et liste les différences substantielles (ajouts, suppressions, modifications de clauses ou de montants), " +
      "sans rien inventer. " + GARDE_FOU;
    const contexte = `VERSION A :\n${texteA}\n\nVERSION B :\n${texteB}`;
    res.json({ comparaison: await generer(instruction, contexte), a_valider: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur du service IA" });
  }
});

module.exports = router;
