// JURIA — route Cockpit (tableau de bord)
const express = require("express");
const { pool } = require("../db");
const { estAutorise } = require("../permissions");
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
    // Impayés : donnée financière (factures), gardée par la même permission
    // que la liste des factures elle-même (factures.consulter) — cette
    // route n'avait jusqu'ici aucun contrôle de permission, contournant
    // silencieusement le verrou déjà posé le 18/08/2026 sur l'écran
    // Facturation (trouvé le 04/09/2026 en concevant une maquette de
    // Cockpit interactif). Absente (null) plutôt qu'une erreur 403 sur
    // toute la route — même principe que le menu qui disparaît en silence.
    const voitFactures = await estAutorise(req.user.role, "factures.consulter");
    const impayes = voitFactures
      ? await one(
          `SELECT COALESCE(SUM(montant_ttc),0) AS total
           FROM factures WHERE statut IN ('emise','partielle','impayee')`
        )
      : null;
    const temps = await one(
      `SELECT COALESCE(SUM(duree_minutes),0) / 60.0 AS heures
       FROM temps WHERE date_saisie >= date_trunc('month', current_date)`
    );
    const delais = await pool.query(
      `SELECT * FROM v_delais_a_venir LIMIT 8`
    );
    // Dossiers pro bono sous le seuil de frais de procédure (18/08/2026) —
    // portait à l'origine sur tous les dossiers (seuil classique inclus),
    // rescopé au pro bono uniquement le même jour (seuil classique
    // abandonné). Même calcul que routes/dossiers.js.
    const sousSeuil = await one(
      `SELECT count(*) AS n
       FROM dossiers d
       CROSS JOIN parametres_cabinet p
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(f.montant_ttc_xof), 0) AS cumul_xof
         FROM factures f WHERE f.dossier_id = d.id AND f.statut <> 'annulee'
       ) fh ON true
       WHERE d.statut IN ('ouvert','en_cours') AND d.pro_bono
         AND fh.cumul_xof < p.frais_procedure_pro_bono_min_xof`
    );

    res.json({
      dossiers_actifs: Number(dossiers.actifs),
      dossiers_urgents: Number(dossiers.urgents),
      audiences_semaine: Number(audiences.n),
      impayes_ttc: voitFactures ? Number(impayes.total) : null,
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
