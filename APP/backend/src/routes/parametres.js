// JURIA — Paramètres du cabinet : seuil de frais pro bono + quota mensuel.
// Table mono-ligne (parametres_cabinet, CHECK id=1) déjà utilisée pour
// l'en-tête cabinet (actes.js) ; cette route n'expose QUE ces 2 colonnes,
// pas l'identité du cabinet (hors périmètre).
//
// Historique (18/08/2026) : cette route couvrait aussi un seuil d'honoraires
// minimum pour les dossiers classiques (honoraires_min_xof, 150 000 FCFA) —
// abandonné explicitement par l'utilisateur le même jour (colonne
// supprimée en base). Le volet pro bono, distinct, est conservé.
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const router = express.Router();

// GET /api/parametres/honoraires — lecture ouverte à tout utilisateur
// authentifié : les seuils sont de toute façon visibles indirectement via
// le badge honoraires sur les dossiers pro bono.
router.get("/honoraires", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT frais_procedure_pro_bono_min_xof, quota_pro_bono_mensuel
       FROM parametres_cabinet WHERE id = 1`
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /api/parametres/honoraires  { frais_procedure_pro_bono_min_xof?, quota_pro_bono_mensuel? }
// Réservé par la matrice de permissions (parametres.honoraires.modifier),
// pas un requireRole en dur : contrairement à la matrice elle-même, il n'y
// a pas de risque d'auto-verrouillage à faire dépendre ce réglage de la
// matrice qu'il ne contrôle pas.
router.put("/honoraires", requirePermission("parametres.honoraires.modifier"), async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE parametres_cabinet SET
         frais_procedure_pro_bono_min_xof = COALESCE($1, frais_procedure_pro_bono_min_xof),
         quota_pro_bono_mensuel = COALESCE($2, quota_pro_bono_mensuel)
       WHERE id = 1
       RETURNING frais_procedure_pro_bono_min_xof, quota_pro_bono_mensuel`,
      [b.frais_procedure_pro_bono_min_xof ?? null, b.quota_pro_bono_mensuel ?? null]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
