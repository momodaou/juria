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
  if (actif !== undefined) { params.push(actif === "true"); where = `WHERE u.actif = $1`; }
  try {
    // en_ligne (13/09/2026, messagerie — statut de présence) : dernière
    // activité de moins de 45s via le ping SSE existant (voir
    // messagerie.js). Calculé à la lecture plutôt que stocké — un ping
    // manqué ne fait pas passer quelqu'un hors ligne à tort.
    const { rows } = await pool.query(
      `SELECT u.id, u.code, u.prenom, u.nom, u.email, u.role, u.pole, u.actif, u.valide_le,
              (p.derniere_activite IS NOT NULL AND p.derniere_activite > now() - interval '45 seconds') AS en_ligne
       FROM utilisateurs u
       LEFT JOIN presence_utilisateurs p ON p.utilisateur_id = u.id
       ${where} ORDER BY u.prenom, u.nom`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
