// JURIA — Annuaire interne (liste des membres du cabinet), pour les
// sélecteurs de responsable/affectation dans les autres modules.
const express = require("express");
const { pool } = require("../db");
const router = express.Router();

// GET /api/utilisateurs?actif=true
router.get("/", async (req, res) => {
  const { actif } = req.query;
  const params = [];
  let where = "";
  if (actif !== undefined) { params.push(actif === "true"); where = `WHERE actif = $1`; }
  try {
    const { rows } = await pool.query(
      `SELECT id, code, prenom, nom, role, pole, actif
       FROM utilisateurs ${where} ORDER BY prenom, nom`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
