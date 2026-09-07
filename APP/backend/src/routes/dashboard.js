// JURIA — route Cockpit (tableau de bord)
//
// Cockpit interactif (04/09/2026) : après une maquette cliquable (données
// fictives) pour valider le principe, câblage réel — chaque tuile devient
// cliquable côté frontend et va chercher son détail via
// GET /api/dashboard/detail/:type, avec tri en direct côté client (jeux de
// résultats plafonnés à 100-300 lignes, pas besoin d'un tri serveur).
// 3 nouvelles tuiles ajoutées par rapport à la version du 17/08/2026 :
// congés en attente, dossiers dormants, taux de réalisation — les deux
// premières comblent des gaps déjà signalés (« tâches perso »/« rentabilité »
// de la spec d'origine du Cockpit, jamais construits), la troisième est un
// vrai gap trouvé en listant les 17 modules pour cette maquette.
//
// Confidentialité (trouvé le 04/09/2026 en répondant à une question directe
// de l'utilisateur) : les tuiles financières/RH suivent EXACTEMENT les
// mêmes permissions que les écrans dont elles tirent leurs données
// (factures.consulter, cabinet.consulter) — jamais un nouveau concept de
// permission, jamais une exception pour le Cockpit.
const express = require("express");
const { pool } = require("../db");
const { estAutorise } = require("../permissions");
const router = express.Router();

const NOM_CLIENT = `COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom)`;

// Ordre d'urgence des tâches (07/09/2026, tuiles "Mes tâches"/"Tâches
// urgentes" — gap signalé par l'utilisateur : rien sur le Tableau de bord
// ne reflétait le Plan d'action, alors que la démo HTML de spécification
// d'origine avait un panneau "Mes tâches" jamais construit) : en retard
// d'abord, puis par priorité, puis par échéance la plus proche.
const ORDRE_URGENCE_TACHES = `
  (t.echeance IS NOT NULL AND t.echeance < current_date) DESC,
  CASE t.priorite WHEN 'urgente' THEN 0 WHEN 'haute' THEN 1 WHEN 'normale' THEN 2 ELSE 3 END,
  t.echeance ASC NULLS LAST
`;

// Rentabilité par dossier (07/09/2026, 2e gap trouvé le même jour dans la
// démo HTML de spécification d'origine — panneau "Rentabilité par dossier",
// jamais construit non plus). Marge = facturé HT − dépenses réellement
// décaissées − rétrocessions liées au dossier. ⚠️ Approximation assumée et
// documentée, pas un vrai coût complet : JURIA n'a pas de taux horaire de
// revient distinct du taux de facturation (temps.taux_horaire sert aux
// deux), donc le temps des collaborateurs n'est pas déduit ici — seuls les
// coûts monétaires réels déjà enregistrés (dépenses, rétrocessions) le
// sont. `statut_retro` n'a aucune valeur de refus (attente/a_decaisser/
// decaissee) : toute rétrocession créée est un engagement de coût, comptée
// sans filtre de statut ; les dépenses ne comptent qu'une fois `decaissee`
// (une dépense simplement soumise n'est pas encore un coût réel).
const COUTS_DOSSIER_CTE = `
  WITH couts AS (
    SELECT d.id AS dossier_id, d.numero, d.intitule, d.mode_honoraires::text AS mode_honoraires,
           u.prenom || ' ' || u.nom AS responsable,
           COALESCE((SELECT SUM(f.montant_ht) FROM factures f
                     WHERE f.dossier_id = d.id AND f.statut NOT IN ('brouillon','annulee')), 0) AS facture_ht,
           COALESCE((SELECT SUM(dep.montant) FROM depenses dep
                     WHERE dep.dossier_id = d.id AND dep.statut = 'decaissee'), 0) AS depenses,
           COALESCE((SELECT SUM(r.montant) FROM retrocessions r WHERE r.dossier_id = d.id), 0) AS retro
    FROM dossiers d
    JOIN utilisateurs u ON u.id = d.responsable_id
  )
`;
const MARGE_DOSSIER_SELECT = `
  dossier_id, numero, intitule, mode_honoraires, responsable, facture_ht,
  (facture_ht - depenses - retro) AS marge_ht,
  ROUND(100.0 * (facture_ht - depenses - retro) / facture_ht) AS marge_pct
`;

// GET /api/dashboard  -> indicateurs agrégés (les nombres affichés sur les tuiles)
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
    // que la liste des factures elle-même (factures.consulter) — trouvé et
    // corrigé le 04/09/2026 (contournait silencieusement le verrou posé le
    // 18/08/2026 sur l'écran Facturation). Absente (null) plutôt qu'une
    // erreur 403 sur toute la route — même principe que le menu qui
    // disparaît en silence.
    const voitFactures = await estAutorise(req.user.role, "factures.consulter");
    const voitCabinet = await estAutorise(req.user.role, "cabinet.consulter");
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
    // Congés en attente de décision — RH, même permission que la vue
    // d'équipe (cabinet.consulter, resserrée direction/finance le 29/08/2026).
    const conges = voitCabinet
      ? await one(`SELECT count(*) AS n FROM conges WHERE statut = 'demande'`)
      : null;
    // Dossiers dormants : aucun mouvement (pièce, facture, événement,
    // communication, temps) depuis 30 jours — public, aucune donnée
    // financière ni RH, juste un signal de suivi opérationnel.
    const dormants = await one(
      `SELECT count(*) AS n
       FROM dossiers d
       CROSS JOIN LATERAL (
         SELECT GREATEST(
           d.date_ouverture::timestamptz,
           COALESCE((SELECT MAX(cree_le) FROM documents WHERE dossier_id = d.id), '-infinity'),
           COALESCE((SELECT MAX(cree_le) FROM communications WHERE dossier_id = d.id), '-infinity'),
           COALESCE((SELECT MAX(cree_le) FROM evenements WHERE dossier_id = d.id), '-infinity'),
           COALESCE((SELECT MAX(cree_le) FROM factures WHERE dossier_id = d.id), '-infinity'),
           COALESCE((SELECT MAX(date_saisie)::timestamptz FROM temps WHERE dossier_id = d.id), '-infinity')
         ) AS dernier
       ) act
       WHERE d.statut IN ('ouvert','en_cours')
         AND (current_date - act.dernier::date) >= 30`
    );
    // Taux de réalisation (rentabilité) — heures facturées / heures saisies
    // ce mois, cabinet entier. Dérivé de temps.facture_id (câblé le
    // 25/08/2026) — même permission que les autres données financières.
    const realisation = voitFactures
      ? await one(
          `SELECT ROUND(100.0 * SUM(duree_minutes) FILTER (WHERE facture_id IS NOT NULL)
                  / NULLIF(SUM(duree_minutes), 0)) AS taux
           FROM temps WHERE date_saisie >= date_trunc('month', current_date)`
        )
      : null;

    // 6 indicateurs de performance ajoutés le 04/09/2026 (demande explicite
    // de l'utilisateur, suite au benchmark du 03/09/2026) — tous financiers,
    // tous gardés par factures.consulter comme le reste.
    let caMois = null, tendancePct = null, impayes60 = null, recouvrement = null;
    let poleDominantNom = null, poleDominantPct = null, concentrationPct = null, productiviteMois = null;
    if (voitFactures) {
      const ca = await one(
        `SELECT
           COALESCE(SUM(montant_ht) FILTER (
             WHERE date_emission >= date_trunc('month', current_date)
               AND date_emission < date_trunc('month', current_date) + interval '1 month'), 0) AS ce_mois,
           COALESCE(SUM(montant_ht) FILTER (
             WHERE date_emission >= date_trunc('month', current_date) - interval '1 month'
               AND date_emission < date_trunc('month', current_date)), 0) AS mois_precedent
         FROM factures WHERE statut NOT IN ('brouillon','annulee')`
      );
      caMois = Number(ca.ce_mois);
      const precedent = Number(ca.mois_precedent);
      tendancePct = precedent > 0 ? Math.round((100 * (caMois - precedent)) / precedent) : null;

      const aging = await one(
        `SELECT COALESCE(SUM(montant_ttc), 0) AS montant
         FROM factures
         WHERE statut IN ('emise','partielle','impayee')
           AND date_echeance IS NOT NULL AND (current_date - date_echeance) > 60`
      );
      impayes60 = Number(aging.montant);

      const rec = await one(
        `SELECT
           COALESCE((SELECT SUM(montant_ttc) FROM factures
             WHERE statut NOT IN ('brouillon','annulee')
               AND date_emission >= date_trunc('month', current_date)
               AND date_emission < date_trunc('month', current_date) + interval '1 month'), 0) AS facture,
           COALESCE((SELECT SUM(montant) FROM paiements
             WHERE date_paiement >= date_trunc('month', current_date)
               AND date_paiement < date_trunc('month', current_date) + interval '1 month'), 0) AS encaisse`
      );
      recouvrement = Number(rec.facture) > 0 ? Math.round((100 * Number(rec.encaisse)) / Number(rec.facture)) : null;

      const parPole = await pool.query(
        `SELECT d.pole::text AS pole, SUM(f.montant_ht) AS ca
         FROM factures f JOIN dossiers d ON d.id = f.dossier_id
         WHERE f.statut NOT IN ('brouillon','annulee')
           AND f.date_emission >= date_trunc('month', current_date)
           AND f.date_emission < date_trunc('month', current_date) + interval '1 month'
         GROUP BY d.pole`
      );
      const totalPole = parPole.rows.reduce((s, r) => s + Number(r.ca), 0);
      if (totalPole > 0) {
        const top = parPole.rows.reduce((a, b) => (Number(a.ca) > Number(b.ca) ? a : b));
        poleDominantNom = top.pole === "conseil" ? "Conseil" : "Contentieux";
        poleDominantPct = Math.round((100 * Number(top.ca)) / totalPole);
      }

      const concentration = await one(
        `WITH parclient AS (
           SELECT client_id, SUM(montant_ht) AS ca
           FROM factures
           WHERE statut NOT IN ('brouillon','annulee') AND date_emission >= current_date - interval '12 months'
           GROUP BY client_id
         )
         SELECT
           COALESCE((SELECT SUM(ca) FROM (SELECT ca FROM parclient ORDER BY ca DESC LIMIT 5) x), 0) AS top5,
           COALESCE((SELECT SUM(ca) FROM parclient), 0) AS total`
      );
      concentrationPct = Number(concentration.total) > 0
        ? Math.round((100 * Number(concentration.top5)) / Number(concentration.total))
        : null;

      const productivite = await one(
        `SELECT COALESCE(SUM(duree_minutes / 60.0 * taux_horaire) FILTER (WHERE facture_id IS NOT NULL), 0) AS valeur
         FROM temps WHERE date_saisie >= date_trunc('month', current_date)`
      );
      productiviteMois = Number(productivite.valeur);
    }

    // Aperçus & tendances (07/09/2026, suite à une maquette de comparaison
    // validée par l'utilisateur — voir HISTORY.md) : 3 tuiles listant du
    // concret actionnable (urgents/audiences/impayés) gagnent un aperçu des
    // 2 premiers éléments directement dans l'agrégat, pour éviter un aller-
    // retour réseau supplémentaire au chargement ; CA du mois gagne un
    // historique 6 mois (sparkline) ; Impayés +60 jours gagne la répartition
    // exacte du même seuil (61-90 j / +90 j — pas les tranches plus jeunes,
    // qui ne font pas partie de cet agrégat).
    const urgentsApercu = await pool.query(
      `SELECT d.id AS dossier_id, d.numero, d.intitule, ev.jours_restants
       FROM dossiers d
       LEFT JOIN LATERAL (
         SELECT (e.date_echeance::date - current_date) AS jours_restants
         FROM evenements e WHERE e.dossier_id = d.id AND e.statut = 'a_venir' AND e.date_echeance >= now()
         ORDER BY e.date_echeance LIMIT 1
       ) ev ON true
       WHERE d.urgence = 'haute' AND d.statut <> 'clos'
       ORDER BY ev.jours_restants ASC NULLS LAST LIMIT 2`
    );
    const audiencesApercu = await pool.query(
      `SELECT d.id AS dossier_id, d.numero, e.titre, e.date_echeance
       FROM evenements e JOIN dossiers d ON d.id = e.dossier_id
       WHERE e.type = 'audience' AND e.statut = 'a_venir'
         AND e.date_echeance >= now() AND e.date_echeance < now() + interval '7 days'
       ORDER BY e.date_echeance LIMIT 2`
    );
    let impayesApercu = [];
    let caHistorique = null;
    let impayesTranches = null;
    if (voitFactures) {
      const ia = await pool.query(
        `SELECT f.client_id, ${NOM_CLIENT} AS client, f.montant_ttc
         FROM factures f JOIN clients c ON c.id = f.client_id
         WHERE f.statut IN ('emise','partielle','impayee')
         ORDER BY f.montant_ttc DESC LIMIT 2`
      );
      impayesApercu = ia.rows;

      const hist = await pool.query(
        `SELECT to_char(m, 'YYYY-MM') AS mois,
                COALESCE((SELECT SUM(montant_ht) FROM factures f
                          WHERE f.statut NOT IN ('brouillon','annulee')
                            AND date_trunc('month', f.date_emission) = m), 0) AS ca
         FROM generate_series(date_trunc('month', current_date) - interval '5 months',
                               date_trunc('month', current_date), interval '1 month') AS m
         ORDER BY m`
      );
      caHistorique = hist.rows.map((r) => Number(r.ca));

      const tranches = await one(
        `SELECT
           COALESCE(SUM(montant_ttc) FILTER (
             WHERE (current_date - date_echeance) > 60 AND (current_date - date_echeance) <= 90), 0) AS t_61_90,
           COALESCE(SUM(montant_ttc) FILTER (WHERE (current_date - date_echeance) > 90), 0) AS t_plus90
         FROM factures WHERE statut IN ('emise','partielle','impayee') AND date_echeance IS NOT NULL`
      );
      impayesTranches = { j61_90: Number(tranches.t_61_90), jPlus90: Number(tranches.t_plus90) };
    }

    // "Mes tâches" (personnel, toujours visible — ce sont mes propres
    // tâches) et "Tâches urgentes" (cabinet entier, gardée par
    // cabinet.consulter comme le reste des tuiles de charge de travail).
    const mesTaches = await one(
      `SELECT count(*) AS n FROM taches t
       WHERE t.responsable_id = $1 AND t.statut NOT IN ('termine','annule')`,
      [req.user.sub]
    );
    const mesTachesApercu = await pool.query(
      `SELECT t.id, t.titre, t.dossier_id, d.numero AS dossier_numero, t.echeance, t.priorite::text AS priorite
       FROM taches t LEFT JOIN dossiers d ON d.id = t.dossier_id
       WHERE t.responsable_id = $1 AND t.statut NOT IN ('termine','annule')
       ORDER BY ${ORDRE_URGENCE_TACHES} LIMIT 2`,
      [req.user.sub]
    );
    let tachesUrgentesN = null, tachesUrgentesApercu = [];
    if (voitCabinet) {
      const tu = await one(
        `SELECT count(*) AS n FROM taches t
         WHERE t.statut NOT IN ('termine','annule')
           AND (t.priorite = 'urgente' OR (t.echeance IS NOT NULL AND t.echeance < current_date))`
      );
      tachesUrgentesN = Number(tu.n);
      const tua = await pool.query(
        `SELECT t.id, t.titre, t.dossier_id, d.numero AS dossier_numero, t.echeance, t.priorite::text AS priorite,
                u.prenom || ' ' || u.nom AS responsable
         FROM taches t
         LEFT JOIN dossiers d ON d.id = t.dossier_id
         LEFT JOIN utilisateurs u ON u.id = t.responsable_id
         WHERE t.statut NOT IN ('termine','annule')
           AND (t.priorite = 'urgente' OR (t.echeance IS NOT NULL AND t.echeance < current_date))
         ORDER BY ${ORDRE_URGENCE_TACHES} LIMIT 2`
      );
      tachesUrgentesApercu = tua.rows;
    }

    // "Dossiers non rentables" — même famille que les autres tuiles CA/
    // marge, gardée par factures.consulter. Compte + aperçu des 2 pires
    // marges (dossiers facturés à perte), pas la liste complète (voir le
    // détail au clic pour la vue d'ensemble triable, meilleure comme pire).
    let dossiersNonRentablesN = null, nonRentablesApercu = [];
    if (voitFactures) {
      const nr = await one(
        `${COUTS_DOSSIER_CTE}
         SELECT count(*) AS n FROM couts WHERE facture_ht > 0 AND (facture_ht - depenses - retro) < 0`
      );
      dossiersNonRentablesN = Number(nr.n);
      const nra = await pool.query(
        `${COUTS_DOSSIER_CTE}
         SELECT ${MARGE_DOSSIER_SELECT} FROM couts
         WHERE facture_ht > 0 AND (facture_ht - depenses - retro) < 0
         ORDER BY marge_ht ASC LIMIT 2`
      );
      nonRentablesApercu = nra.rows;
    }

    res.json({
      dossiers_actifs: Number(dossiers.actifs),
      dossiers_urgents: Number(dossiers.urgents),
      audiences_semaine: Number(audiences.n),
      impayes_ttc: voitFactures ? Number(impayes.total) : null,
      heures_mois: Number(temps.heures),
      dossiers_sous_seuil_honoraires: Number(sousSeuil.n),
      conges_attente: voitCabinet ? Number(conges.n) : null,
      dossiers_dormants: Number(dormants.n),
      taux_realisation: voitFactures && realisation.taux !== null ? Number(realisation.taux) : null,
      ca_mois: caMois,
      ca_tendance_pct: tendancePct,
      impayes_60j_plus: impayes60,
      taux_recouvrement: recouvrement,
      ca_pole_dominant_nom: poleDominantNom,
      ca_pole_dominant_pct: poleDominantPct,
      concentration_top5_pct: concentrationPct,
      productivite_mois: productiviteMois,
      delais_a_venir: delais.rows,
      urgents_apercu: urgentsApercu.rows,
      audiences_apercu: audiencesApercu.rows,
      impayes_apercu: impayesApercu,
      ca_historique: caHistorique,
      impayes_tranches: impayesTranches,
      mes_taches_n: Number(mesTaches.n),
      mes_taches_apercu: mesTachesApercu.rows,
      taches_urgentes_n: tachesUrgentesN,
      taches_urgentes_apercu: tachesUrgentesApercu,
      dossiers_non_rentables: dossiersNonRentablesN,
      non_rentables_apercu: nonRentablesApercu,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/dashboard/detail/:type -> détail d'une tuile (liste sous-jacente)
// Chaque type gère lui-même sa permission (au lieu d'un requirePermission de
// routeur, différent selon le type) et renvoie un tableau de lignes ; le tri
// et le filtre se font côté client (Angular), le volume est toujours borné.
router.get("/detail/:type", async (req, res) => {
  const { type } = req.params;
  try {
    switch (type) {
      case "actifs": {
        const { rows } = await pool.query(
          `SELECT d.id AS dossier_id, d.numero, d.intitule, ${NOM_CLIENT} AS client, d.pole::text AS pole, d.date_ouverture
           FROM dossiers d JOIN clients c ON c.id = d.client_id
           WHERE d.statut IN ('ouvert','en_cours')
           ORDER BY d.date_ouverture DESC LIMIT 200`
        );
        return res.json(rows);
      }
      case "urgents": {
        const { rows } = await pool.query(
          `SELECT d.id AS dossier_id, d.numero, d.intitule, ${NOM_CLIENT} AS client, u.prenom || ' ' || u.nom AS responsable,
                  ev.date_echeance, ev.jours_restants
           FROM dossiers d
           JOIN clients c ON c.id = d.client_id
           JOIN utilisateurs u ON u.id = d.responsable_id
           LEFT JOIN LATERAL (
             SELECT e.date_echeance, (e.date_echeance::date - current_date) AS jours_restants
             FROM evenements e WHERE e.dossier_id = d.id AND e.statut = 'a_venir' AND e.date_echeance >= now()
             ORDER BY e.date_echeance LIMIT 1
           ) ev ON true
           WHERE d.urgence = 'haute' AND d.statut <> 'clos'
           ORDER BY ev.jours_restants ASC NULLS LAST LIMIT 200`
        );
        return res.json(rows);
      }
      case "audiences": {
        const { rows } = await pool.query(
          `SELECT d.id AS dossier_id, d.numero AS dossier, e.titre, e.date_echeance
           FROM evenements e JOIN dossiers d ON d.id = e.dossier_id
           WHERE e.type = 'audience' AND e.statut = 'a_venir'
             AND e.date_echeance >= now() AND e.date_echeance < now() + interval '7 days'
           ORDER BY e.date_echeance LIMIT 200`
        );
        return res.json(rows);
      }
      case "impayes": {
        if (!(await estAutorise(req.user.role, "factures.consulter"))) {
          return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
        }
        const { rows } = await pool.query(
          `SELECT f.dossier_id, f.client_id, f.numero, ${NOM_CLIENT} AS client, f.montant_ttc, f.date_echeance,
                  CASE WHEN f.date_echeance IS NULL THEN NULL
                       ELSE GREATEST(0, current_date - f.date_echeance) END AS jours_retard
           FROM factures f JOIN clients c ON c.id = f.client_id
           WHERE f.statut IN ('emise','partielle','impayee')
           ORDER BY f.montant_ttc DESC LIMIT 200`
        );
        return res.json(rows);
      }
      case "heures": {
        if (!(await estAutorise(req.user.role, "cabinet.consulter"))) {
          return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
        }
        const { rows } = await pool.query(
          `SELECT u.prenom || ' ' || u.nom AS nom, ROUND(SUM(t.duree_minutes) / 60.0, 1) AS heures
           FROM temps t JOIN utilisateurs u ON u.id = t.utilisateur_id
           WHERE t.date_saisie >= date_trunc('month', current_date)
           GROUP BY u.id, u.prenom, u.nom
           ORDER BY heures DESC LIMIT 100`
        );
        return res.json(rows);
      }
      case "probono": {
        const { rows } = await pool.query(
          `SELECT d.id AS dossier_id, d.numero, ${NOM_CLIENT} AS client, u.prenom || ' ' || u.nom AS responsable, fh.cumul_xof AS frais
           FROM dossiers d
           JOIN clients c ON c.id = d.client_id
           JOIN utilisateurs u ON u.id = d.responsable_id
           CROSS JOIN parametres_cabinet p
           LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(f.montant_ttc_xof), 0) AS cumul_xof
             FROM factures f WHERE f.dossier_id = d.id AND f.statut <> 'annulee'
           ) fh ON true
           WHERE d.statut IN ('ouvert','en_cours') AND d.pro_bono
             AND fh.cumul_xof < p.frais_procedure_pro_bono_min_xof
           ORDER BY fh.cumul_xof ASC LIMIT 200`
        );
        return res.json(rows);
      }
      case "conges": {
        if (!(await estAutorise(req.user.role, "cabinet.consulter"))) {
          return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
        }
        const { rows } = await pool.query(
          `SELECT u.prenom || ' ' || u.nom AS demandeur, c.type::text AS type,
                  c.date_debut, c.date_fin, c.cree_le::date AS soumis
           FROM conges c JOIN utilisateurs u ON u.id = c.utilisateur_id
           WHERE c.statut = 'demande'
           ORDER BY c.date_debut ASC LIMIT 200`
        );
        return res.json(rows);
      }
      case "dormants": {
        const { rows } = await pool.query(
          `SELECT d.id AS dossier_id, d.numero, d.intitule, u.prenom || ' ' || u.nom AS responsable,
                  act.dernier::date AS dernier_mouvement,
                  (current_date - act.dernier::date) AS jours_inactivite
           FROM dossiers d
           JOIN utilisateurs u ON u.id = d.responsable_id
           CROSS JOIN LATERAL (
             SELECT GREATEST(
               d.date_ouverture::timestamptz,
               COALESCE((SELECT MAX(cree_le) FROM documents WHERE dossier_id = d.id), '-infinity'),
               COALESCE((SELECT MAX(cree_le) FROM communications WHERE dossier_id = d.id), '-infinity'),
               COALESCE((SELECT MAX(cree_le) FROM evenements WHERE dossier_id = d.id), '-infinity'),
               COALESCE((SELECT MAX(cree_le) FROM factures WHERE dossier_id = d.id), '-infinity'),
               COALESCE((SELECT MAX(date_saisie)::timestamptz FROM temps WHERE dossier_id = d.id), '-infinity')
             ) AS dernier
           ) act
           WHERE d.statut IN ('ouvert','en_cours') AND (current_date - act.dernier::date) >= 30
           ORDER BY jours_inactivite DESC LIMIT 200`
        );
        return res.json(rows);
      }
      case "realisation": {
        if (!(await estAutorise(req.user.role, "factures.consulter"))) {
          return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
        }
        const { rows } = await pool.query(
          `SELECT u.prenom || ' ' || u.nom AS nom,
                  ROUND(SUM(t.duree_minutes) / 60.0, 1) AS heures_saisies,
                  ROUND(SUM(t.duree_minutes) FILTER (WHERE t.facture_id IS NOT NULL) / 60.0, 1) AS heures_facturees,
                  ROUND(100.0 * SUM(t.duree_minutes) FILTER (WHERE t.facture_id IS NOT NULL)
                        / NULLIF(SUM(t.duree_minutes), 0)) AS taux
           FROM temps t JOIN utilisateurs u ON u.id = t.utilisateur_id
           WHERE t.date_saisie >= date_trunc('month', current_date)
           GROUP BY u.id, u.prenom, u.nom
           ORDER BY taux DESC NULLS LAST LIMIT 100`
        );
        return res.json(rows);
      }
      case "ca_mois": {
        if (!(await estAutorise(req.user.role, "factures.consulter"))) {
          return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
        }
        const { rows } = await pool.query(
          `SELECT f.dossier_id, f.client_id, f.numero, ${NOM_CLIENT} AS client, f.montant_ht, f.date_emission
           FROM factures f JOIN clients c ON c.id = f.client_id
           WHERE f.statut NOT IN ('brouillon','annulee')
             AND f.date_emission >= date_trunc('month', current_date)
             AND f.date_emission < date_trunc('month', current_date) + interval '1 month'
           ORDER BY f.montant_ht DESC LIMIT 200`
        );
        return res.json(rows);
      }
      case "impayes_aging": {
        if (!(await estAutorise(req.user.role, "factures.consulter"))) {
          return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
        }
        const { rows } = await pool.query(
          `WITH classees AS (
             SELECT
               CASE
                 WHEN date_echeance IS NULL OR current_date - date_echeance < 0 THEN 'Non échu'
                 WHEN current_date - date_echeance <= 30 THEN '0-30 jours'
                 WHEN current_date - date_echeance <= 60 THEN '31-60 jours'
                 WHEN current_date - date_echeance <= 90 THEN '61-90 jours'
                 ELSE '+90 jours'
               END AS tranche,
               CASE
                 WHEN date_echeance IS NULL OR current_date - date_echeance < 0 THEN 0
                 WHEN current_date - date_echeance <= 30 THEN 1
                 WHEN current_date - date_echeance <= 60 THEN 2
                 WHEN current_date - date_echeance <= 90 THEN 3
                 ELSE 4
               END AS rang,
               montant_ttc
             FROM factures WHERE statut IN ('emise','partielle','impayee')
           )
           SELECT tranche, count(*) AS nb_factures, COALESCE(SUM(montant_ttc), 0) AS montant
           FROM classees GROUP BY tranche, rang ORDER BY rang`
        );
        return res.json(rows);
      }
      case "recouvrement": {
        if (!(await estAutorise(req.user.role, "factures.consulter"))) {
          return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
        }
        const { rows } = await pool.query(
          `WITH fact AS (
             SELECT client_id, SUM(montant_ttc) AS facture
             FROM factures
             WHERE statut NOT IN ('brouillon','annulee')
               AND date_emission >= date_trunc('month', current_date)
               AND date_emission < date_trunc('month', current_date) + interval '1 month'
             GROUP BY client_id
           ), enc AS (
             SELECT f.client_id, SUM(p.montant) AS encaisse
             FROM paiements p JOIN factures f ON f.id = p.facture_id
             WHERE p.date_paiement >= date_trunc('month', current_date)
               AND p.date_paiement < date_trunc('month', current_date) + interval '1 month'
             GROUP BY f.client_id
           )
           SELECT c.id AS client_id, ${NOM_CLIENT} AS client, COALESCE(fact.facture, 0) AS facture, COALESCE(enc.encaisse, 0) AS encaisse,
                  COALESCE(fact.facture, 0) - COALESCE(enc.encaisse, 0) AS ecart
           FROM clients c
           LEFT JOIN fact ON fact.client_id = c.id
           LEFT JOIN enc ON enc.client_id = c.id
           WHERE fact.client_id IS NOT NULL OR enc.client_id IS NOT NULL
           ORDER BY facture DESC LIMIT 200`
        );
        return res.json(rows);
      }
      case "ca_pole": {
        if (!(await estAutorise(req.user.role, "factures.consulter"))) {
          return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
        }
        const { rows } = await pool.query(
          `SELECT (CASE d.pole WHEN 'conseil' THEN 'Conseil' ELSE 'Contentieux' END) AS pole,
                  SUM(f.montant_ht) AS ca,
                  ROUND(100.0 * SUM(f.montant_ht) / SUM(SUM(f.montant_ht)) OVER())::int AS pct
           FROM factures f JOIN dossiers d ON d.id = f.dossier_id
           WHERE f.statut NOT IN ('brouillon','annulee')
             AND f.date_emission >= date_trunc('month', current_date)
             AND f.date_emission < date_trunc('month', current_date) + interval '1 month'
           GROUP BY d.pole ORDER BY ca DESC`
        );
        return res.json(rows);
      }
      case "top_clients": {
        if (!(await estAutorise(req.user.role, "factures.consulter"))) {
          return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
        }
        const { rows } = await pool.query(
          `SELECT c.id AS client_id, ${NOM_CLIENT} AS client, SUM(f.montant_ht) AS ca
           FROM factures f JOIN clients c ON c.id = f.client_id
           WHERE f.statut NOT IN ('brouillon','annulee') AND f.date_emission >= current_date - interval '12 months'
           GROUP BY c.id ORDER BY ca DESC LIMIT 20`
        );
        return res.json(rows);
      }
      case "productivite": {
        if (!(await estAutorise(req.user.role, "factures.consulter"))) {
          return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
        }
        const { rows } = await pool.query(
          `SELECT u.prenom || ' ' || u.nom AS nom,
                  ROUND(SUM(t.duree_minutes) FILTER (WHERE t.facture_id IS NOT NULL) / 60.0, 1) AS heures_facturees,
                  COALESCE(SUM(t.duree_minutes / 60.0 * t.taux_horaire) FILTER (WHERE t.facture_id IS NOT NULL), 0) AS valeur
           FROM temps t JOIN utilisateurs u ON u.id = t.utilisateur_id
           WHERE t.date_saisie >= date_trunc('month', current_date)
           GROUP BY u.id, u.prenom, u.nom
           HAVING SUM(t.duree_minutes) FILTER (WHERE t.facture_id IS NOT NULL) > 0
           ORDER BY valeur DESC LIMIT 100`
        );
        return res.json(rows);
      }
      case "mes_taches": {
        const { rows } = await pool.query(
          `SELECT t.id, t.titre, t.dossier_id, d.numero AS dossier_numero, t.echeance, t.priorite::text AS priorite, t.statut::text AS statut
           FROM taches t LEFT JOIN dossiers d ON d.id = t.dossier_id
           WHERE t.responsable_id = $1 AND t.statut NOT IN ('termine','annule')
           ORDER BY ${ORDRE_URGENCE_TACHES} LIMIT 200`,
          [req.user.sub]
        );
        return res.json(rows);
      }
      case "taches_urgentes": {
        if (!(await estAutorise(req.user.role, "cabinet.consulter"))) {
          return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
        }
        const { rows } = await pool.query(
          `SELECT t.id, t.titre, t.dossier_id, d.numero AS dossier_numero, t.echeance, t.priorite::text AS priorite,
                  u.prenom || ' ' || u.nom AS responsable
           FROM taches t
           LEFT JOIN dossiers d ON d.id = t.dossier_id
           LEFT JOIN utilisateurs u ON u.id = t.responsable_id
           WHERE t.statut NOT IN ('termine','annule')
             AND (t.priorite = 'urgente' OR (t.echeance IS NOT NULL AND t.echeance < current_date))
           ORDER BY ${ORDRE_URGENCE_TACHES} LIMIT 200`
        );
        return res.json(rows);
      }
      case "non_rentables": {
        if (!(await estAutorise(req.user.role, "factures.consulter"))) {
          return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
        }
        // Vue complète des dossiers facturés (meilleure comme pire marge),
        // pas seulement les non rentables — l'aperçu de la tuile se limite
        // aux pires, mais "voir le détail" doit permettre le classement
        // inverse (`Marge (décroissante)`) sans changer de tuile.
        const { rows } = await pool.query(
          `${COUTS_DOSSIER_CTE}
           SELECT ${MARGE_DOSSIER_SELECT} FROM couts WHERE facture_ht > 0
           ORDER BY marge_ht ASC LIMIT 200`
        );
        return res.json(rows);
      }
      default:
        return res.status(400).json({ error: "Type de détail inconnu" });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
