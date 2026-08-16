// JURIA — Listes de valeurs paramétrables (nomenclatures : type_original, motifs, etc.)
const express = require("express");
const { pool } = require("../db");
const router = express.Router();

// GET /api/listes-valeurs?domaine=type_original
router.get("/", async (req, res) => {
  const { domaine } = req.query;
  if (!domaine) return res.status(400).json({ error: "Paramètre domaine requis" });
  try {
    const { rows } = await pool.query(
      `SELECT code, libelle FROM listes_valeurs
       WHERE domaine = $1 AND actif = TRUE ORDER BY ordre ASC`,
      [domaine]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
