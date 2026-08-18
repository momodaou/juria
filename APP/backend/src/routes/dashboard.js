// JURIA — route Cockpit (tableau de bord)
const express = require("express");
const { pool } = require("../db");
const router = express.Router();

// GET /api/dashboard  -> indicateurs agrégés
router.get("/", async (req, res) => {
  try {
    const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0];

    const dossiers = await one(
      `SELECT
         count(*) FILTER (WHERE statut IN ('ouvert','en_cours')) AS actifs,
         count(*) FILTER (WHERE urgence = 'haute' AND statut <> 'clos') AS urgents
       FROM dossiers`
    );
    const audiences = await one(
      `SELECT count(*) AS n FROM evenements
       WHERE type IN ('audience') AND statut = 'a_venir'
         AND date_echeance >= now() AND date_echeance < now() + interval '7 days'`
    );
    const impayes = await one(
      `SELECT COALESCE(SUM(montant_ttc),0) AS total
       FROM factures WHERE statut IN ('emise','partielle','impayee')`
    );
    const temps = await one(
      `SELECT COALESCE(SUM(duree_minutes),0) / 60.0 AS heures
       FROM temps WHERE date_saisie >= date_trunc('month', current_date)`
    );
    const delais = await pool.query(
      `SELECT * FROM v_delais_a_venir LIMIT 8`
    );
    // Dossiers sous le seuil d'honoraires (anti-dissimulation, 18/08/2026) :
    // même calcul que routes/dossiers.js (cumul factures vs seuil applicable
    // pro bono/classique), abonnement exempté.
    const sousSeuil = await one(
      `SELECT count(*) AS n
       FROM dossiers d
       CROSS JOIN parametres_cabinet p
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(f.montant_ttc_xof), 0) AS cumul_xof
         FROM factures f WHERE f.dossier_id = d.id AND f.statut <> 'annulee'
       ) fh ON true
       WHERE d.statut IN ('ouvert','en_cours')
         AND d.mode_honoraires IS DISTINCT FROM 'abonnement'
         AND fh.cumul_xof < (CASE WHEN d.pro_bono THEN p.frais_procedure_pro_bono_min_xof ELSE p.honoraires_min_xof END)`
    );

    res.json({
      dossiers_actifs: Number(dossiers.actifs),
      dossiers_urgents: Number(dossiers.urgents),
      audiences_semaine: Number(audiences.n),
      impayes_ttc: Number(impayes.total),
      heures_mois: Number(temps.heures),
      dossiers_sous_seuil_honoraires: Number(sousSeuil.n),
      delais_a_venir: delais.rows,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
