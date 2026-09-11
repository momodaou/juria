// JURIA — Échéances administratives du cabinet (fiscal/social/ordinal,
// assurance…), volontairement SANS dossier — gap comblé le 11/09/2026.
//
// La table echeances_administratives (et les catalogues listes_valeurs
// 'categorie_echeance'/'periodicite') existaient depuis le tout premier
// schéma, pré-remplis avec les vraies échéances maliennes (TVA, INPS, ITS,
// IS, patente, Ordre des avocats, assurance RC pro) — mais aucune route ni
// écran ne les avait jamais exposés. Trouvé en répondant à une question de
// l'utilisateur sur les délais non rattachés à un dossier.
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const router = express.Router();

// Même échelle d'alerte que evenements.js (J-30/J-15/J-7/J-1/J0/dépassé) —
// dupliquée plutôt que partagée, cohérent avec le reste du code (chaque
// route de ce projet reste autonome, pas de module utilitaire commun).
function niveauAlerte(jours) {
  if (jours < 0) return "depasse";
  if (jours === 0) return "J0";
  if (jours <= 1) return "J-1";
  if (jours <= 7) return "J-7";
  if (jours <= 15) return "J-15";
  if (jours <= 30) return "J-30";
  return "—";
}

// GET /api/echeances-administratives — actives, triées par échéance. Même
// permission que le reste de l'onglet Échéancier (pas de fragmentation).
router.get("/", requirePermission("echeancier.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.categorie, e.libelle, e.periodicite, e.prochaine_date,
              e.montant_estime, e.statut, e.reference_ext, e.observations,
              e.responsable_id, u.prenom || ' ' || u.nom AS responsable,
              (e.prochaine_date - current_date) AS jours_restants
       FROM echeances_administratives e
       LEFT JOIN utilisateurs u ON u.id = e.responsable_id
       WHERE e.actif = TRUE
       ORDER BY e.prochaine_date`
    );
    res.json(rows.map((r) => ({ ...r, alerte: niveauAlerte(Number(r.jours_restants)) })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/echeances-administratives — ajouter une échéance cabinet
// { categorie?, libelle, periodicite?, jour_echeance?, prochaine_date,
//   responsable_id?, montant_estime?, reference_ext?, observations? }
// Réservé (echeances_admin.gerer) : contrairement à un délai de dossier
// (ouvert à la plupart des rôles via evenements.creer), une obligation du
// cabinet relève de la direction/comptabilité.
router.post("/", requirePermission("echeances_admin.gerer"), async (req, res) => {
  const b = req.body || {};
  if (!b.libelle || !b.prochaine_date) {
    return res.status(400).json({ error: "libelle et prochaine_date requis" });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO echeances_administratives
         (categorie, libelle, periodicite, jour_echeance, prochaine_date,
          responsable_id, montant_estime, reference_ext, observations, cree_par)
       VALUES (COALESCE($1,'fiscale'),$2,COALESCE($3,'ponctuelle'),$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, libelle, categorie, periodicite, prochaine_date, statut`,
      [b.categorie || null, b.libelle, b.periodicite || null, b.jour_echeance || null,
       b.prochaine_date, b.responsable_id || null, b.montant_estime || null,
       b.reference_ext || null, b.observations || null, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/echeances-administratives/:id/traiter — marque l'occurrence
// courante traitée. Si l'échéance est périodique (mensuelle/trimestrielle/
// semestrielle/annuelle), avance à la prochaine échéance plutôt que de la
// faire disparaître : le but est un rappel permanent (TVA du mois
// prochain, cotisation de l'an prochain…), pas une tâche cochée une fois
// pour toutes. Une échéance ponctuelle passe simplement à 'paye'.
router.post("/:id/traiter", requirePermission("echeances_admin.gerer"), async (req, res) => {
  try {
    const { rows: current } = await pool.query(
      "SELECT periodicite FROM echeances_administratives WHERE id = $1 AND actif = TRUE",
      [req.params.id]
    );
    if (!current[0]) return res.status(404).json({ error: "Échéance introuvable" });
    const intervalle = {
      mensuelle: "1 month", trimestrielle: "3 months",
      semestrielle: "6 months", annuelle: "1 year",
    }[current[0].periodicite];
    const { rows } = await pool.query(
      intervalle
        ? `UPDATE echeances_administratives
             SET prochaine_date = prochaine_date + $2::interval, statut = 'a_faire'
           WHERE id = $1 RETURNING id, prochaine_date, statut`
        : `UPDATE echeances_administratives SET statut = 'paye' WHERE id = $1 RETURNING id, prochaine_date, statut`,
      intervalle ? [req.params.id, intervalle] : [req.params.id]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
