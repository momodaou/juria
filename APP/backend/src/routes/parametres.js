// JURIA — Paramètres du cabinet : seuils d'honoraires minimum (anti-
// dissimulation, ajout 18/08/2026) + quota pro bono. Table mono-ligne
// (parametres_cabinet, CHECK id=1) déjà utilisée pour l'en-tête cabinet
// (actes.js) ; cette route n'expose QUE les 3 colonnes honoraires, pas
// l'identité du cabinet (hors périmètre de cette fonctionnalité).
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const router = express.Router();

// GET /api/parametres/honoraires — lecture ouverte à tout utilisateur
// authentifié : les seuils sont de toute façon visibles indirectement via
// les badges honoraires sur les dossiers.
router.get("/honoraires", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT honoraires_min_xof, frais_procedure_pro_bono_min_xof, quota_pro_bono_mensuel
       FROM parametres_cabinet WHERE id = 1`
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /api/parametres/honoraires  { honoraires_min_xof?, frais_procedure_pro_bono_min_xof?, quota_pro_bono_mensuel? }
// Réservé par la matrice de permissions (parametres.honoraires.modifier),
// pas un requireRole en dur : contrairement à la matrice elle-même, il n'y
// a pas de risque d'auto-verrouillage à faire dépendre ce réglage de la
// matrice qu'il ne contrôle pas.
router.put("/honoraires", requirePermission("parametres.honoraires.modifier"), async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE parametres_cabinet SET
         honoraires_min_xof = COALESCE($1, honoraires_min_xof),
         frais_procedure_pro_bono_min_xof = COALESCE($2, frais_procedure_pro_bono_min_xof),
         quota_pro_bono_mensuel = COALESCE($3, quota_pro_bono_mensuel)
       WHERE id = 1
       RETURNING honoraires_min_xof, frais_procedure_pro_bono_min_xof, quota_pro_bono_mensuel`,
      [b.honoraires_min_xof ?? null, b.frais_procedure_pro_bono_min_xof ?? null, b.quota_pro_bono_mensuel ?? null]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
