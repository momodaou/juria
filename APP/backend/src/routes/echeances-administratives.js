// JURIA — Échéances administratives du cabinet (fiscal/social/ordinal,
// assurance…), volontairement SANS dossier — gap comblé le 11/09/2026.
//
// La table echeances_administratives (et les catalogues listes_valeurs
// 'categorie_echeance'/'periodicite') existaient depuis le tout premier
// schéma, pré-remplis avec les vraies échéances maliennes (TVA, INPS, ITS,
// IS, patente, Ordre des avocats, assurance RC pro) — mais aucune route ni
// écran ne les avait jamais exposés. Trouvé en répondant à une question de
// l'utilisateur sur les délais non rattachés à un dossier.
//
// Complément du 11/09/2026 (même jour, suite de la conversation) :
// - Formule auto-calculée plutôt qu'une date qu'il fallait avancer à la
//   main à chaque « Marquer traité » (voir calculerProchaineEcheance
//   ci-dessous) — corrige une vraie dérive : si personne ne cliquait, la
//   date restait figée dans le passé au lieu de suivre le calendrier.
// - Lien avec Dépenses & caisse : « Marquer traité » peut désormais créer
//   la dépense réellement décaissée (montant réel, catégorie dédiée
//   charges_fiscales_sociales), au lieu de deux mondes disjoints.
//
// Déplacé le 12/09/2026 : l'écran vit désormais dans Cabinet, plus dans
// Échéances (module `backend/src/routes/dossiers.js`+`evenements.js`) —
// demande explicite de l'utilisateur sur la confidentialité : Échéances
// était ouvert à quasiment tout le cabinet, ces obligations relèvent de
// la direction/comptabilité comme le reste de Cabinet. Ce fichier reste
// distinct (route /api/echeances-administratives séparée) — seule sa
// place dans le menu/l'écran change, pas son organisation en base.
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const { versDateISO, calculerProchaineEcheance, deriverFormule } = require("../periodicite");
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

// calculerProchaineEcheance/versDateISO : extraits le 05/10/2026 dans
// ../periodicite (partagé avec abonnements.js, facturation périodique des
// clients sous convention-cadre) — voir ce module pour le détail, la
// logique elle-même est inchangée.

// GET /api/echeances-administratives — actives, triées par échéance
// effective (calculée pour les récurrentes, stockée pour les ponctuelles).
// Gardée par echeances_admin.consulter (12/09/2026, déplacée d'Échéances
// vers Cabinet) — dédiée plutôt que cabinet.consulter, qui exclut
// l'associé-fondateur pour un motif sans rapport (taux horaires) — voir
// permissions.js.
router.get("/", requirePermission("echeances_admin.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.categorie, e.libelle, e.periodicite, e.jour_echeance, e.mois_echeance,
              e.dernier_traite_le, e.prochaine_date, e.montant_estime, e.statut,
              e.reference_ext, e.observations, e.responsable_id, e.depense_id,
              u.prenom || ' ' || u.nom AS responsable,
              dep.montant AS depense_montant, dep.date_depense AS depense_date
       FROM echeances_administratives e
       LEFT JOIN utilisateurs u ON u.id = e.responsable_id
       LEFT JOIN depenses dep ON dep.id = e.depense_id
       WHERE e.actif = TRUE`
    );
    const aujourdHui = new Date().toISOString().slice(0, 10);
    const enrichies = rows.map((r) => {
      const calculee = calculerProchaineEcheance(r, aujourdHui);
      const prochaine = calculee || versDateISO(r.prochaine_date);
      const jours = Math.round((new Date(prochaine + "T00:00:00Z") - new Date(aujourdHui + "T00:00:00Z")) / 86400000);
      // jours_restants : même convention que evenements.js, réutilisée
      // telle quelle par echeancier.component.ts (badge()/classes .haute
      // et .moy) pour les deux tableaux de la même page.
      return { ...r, prochaine_date: prochaine, jours_restants: jours, alerte: niveauAlerte(jours) };
    });
    enrichies.sort((a, b) => (a.prochaine_date < b.prochaine_date ? -1 : a.prochaine_date > b.prochaine_date ? 1 : 0));
    res.json(enrichies);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/echeances-administratives — ajouter une échéance cabinet
// { categorie?, libelle, periodicite?, prochaine_date, responsable_id?,
//   montant_estime?, reference_ext?, observations? }
// jour_echeance/mois_echeance ne sont PAS des champs de saisie séparés :
// ils sont déduits automatiquement de `prochaine_date` (le jour/mois du
// premier rendez-vous DEVIENT la formule récurrente) — plus simple pour
// l'utilisateur, qui continue de ne choisir qu'une seule date comme avant.
// Réservé (echeances_admin.gerer) : contrairement à un délai de dossier
// (ouvert à la plupart des rôles via evenements.creer), une obligation du
// cabinet relève de la direction/comptabilité.
// deriverFormule (jour_echeance/mois_echeance depuis une date + une
// périodicité) : également extrait dans ../periodicite le 05/10/2026.
// GET /api/echeances-administratives/verifier-doublon?libelle=&categorie=
// (26/09/2026, audit doublons) — signale, sans jamais bloquer, une
// échéance active déjà enregistrée avec le même libellé/catégorie.
router.get("/verifier-doublon", requirePermission("echeances_admin.gerer"), async (req, res) => {
  const { libelle, categorie } = req.query;
  if (!libelle) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT id, libelle, categorie, prochaine_date FROM echeances_administratives
       WHERE actif = TRUE AND libelle ILIKE $1 AND ($2::varchar IS NULL OR categorie = $2::varchar)`,
      [libelle, categorie || null]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/", requirePermission("echeances_admin.gerer"), async (req, res) => {
  const b = req.body || {};
  if (!b.libelle || !b.prochaine_date) {
    return res.status(400).json({ error: "libelle et prochaine_date requis" });
  }
  const { jourEcheance, moisEcheance } = deriverFormule(b.prochaine_date, b.periodicite);
  try {
    const { rows } = await pool.query(
      `INSERT INTO echeances_administratives
         (categorie, libelle, periodicite, jour_echeance, mois_echeance, prochaine_date,
          responsable_id, montant_estime, reference_ext, observations, cree_par)
       VALUES (COALESCE($1,'fiscale'),$2,COALESCE($3,'ponctuelle'),$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, libelle, categorie, periodicite, prochaine_date, statut`,
      [b.categorie || null, b.libelle, b.periodicite || null, jourEcheance, moisEcheance,
       b.prochaine_date, b.responsable_id || null, b.montant_estime || null,
       b.reference_ext || null, b.observations || null, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/echeances-administratives/:id — correction manuelle (gap
// signalé par l'utilisateur, 11/09/2026 : la donnée d'origine seedée pour
// l'INPS précise elle-même « mensuelle... à ajuster selon l'effectif » —
// aucune route ne permettait de faire cet ajustement, ni de corriger quoi
// que ce soit d'autre (libellé, montant, responsable…) une fois créée.
// { categorie?, libelle?, periodicite?, prochaine_date?, montant_estime?,
//   responsable_id?, reference_ext?, observations? }
// periodicite et prochaine_date doivent être fournis ENSEMBLE (ou aucun
// des deux) : la formule (jour/mois d'ancrage) est toujours recalculée à
// partir des deux à la fois, jamais de l'un sans l'autre — évite un état
// incohérent (ex. passer en trimestrielle sans redire quel mois sert de
// point de départ, laissant un ancien ancrage mensuel="pas d'ancrage").
router.put("/:id", requirePermission("echeances_admin.gerer"), async (req, res) => {
  const b = req.body || {};
  const formuleFournie = b.periodicite != null || b.prochaine_date != null;
  if (formuleFournie && (b.periodicite == null || b.prochaine_date == null)) {
    return res.status(400).json({ error: "periodicite et prochaine_date doivent être fournis ensemble (la formule se recalcule à partir des deux)" });
  }
  const { jourEcheance, moisEcheance } = formuleFournie
    ? deriverFormule(b.prochaine_date, b.periodicite)
    : { jourEcheance: null, moisEcheance: null };
  try {
    const { rows } = await pool.query(
      `UPDATE echeances_administratives SET
         categorie = COALESCE($1, categorie),
         libelle = COALESCE($2, libelle),
         periodicite = COALESCE($3, periodicite),
         jour_echeance = CASE WHEN $4 THEN $5 ELSE jour_echeance END,
         mois_echeance = CASE WHEN $4 THEN $6 ELSE mois_echeance END,
         prochaine_date = COALESCE($7, prochaine_date),
         montant_estime = COALESCE($8, montant_estime),
         responsable_id = COALESCE($9, responsable_id),
         reference_ext = COALESCE($10, reference_ext),
         observations = COALESCE($11, observations)
       WHERE id = $12 AND actif = TRUE
       RETURNING id, libelle, categorie, periodicite, jour_echeance, mois_echeance, prochaine_date, montant_estime`,
      [b.categorie || null, b.libelle || null, b.periodicite || null, formuleFournie, jourEcheance, moisEcheance,
       b.prochaine_date || null, b.montant_estime ?? null, b.responsable_id || null,
       b.reference_ext || null, b.observations || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Échéance introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/echeances-administratives/:id — désactive (actif=FALSE)
// plutôt qu'une suppression définitive : préserve l'historique si
// l'échéance a déjà été traitée ou liée à une dépense, réutilise la
// colonne `actif` déjà prévue au schéma (déjà utilisée comme filtre par
// GET / mais jamais mise à jour par aucune route jusqu'ici).
router.delete("/:id", requirePermission("echeances_admin.gerer"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE echeances_administratives SET actif = FALSE WHERE id = $1 AND actif = TRUE RETURNING id",
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Échéance introuvable ou déjà supprimée" });
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/echeances-administratives/:id/traiter  { montant_decaisse?, mode_paiement?, compte_id? }
// Marque l'occurrence courante traitée. Si périodique, n'avance plus une
// date en l'incrémentant à l'aveugle (ancien comportement, source de
// dérive) : enregistre juste `dernier_traite_le` = l'échéance qui vient
// d'être close, et le calcul dynamique (voir plus haut) fait apparaître la
// période suivante tout seul au prochain affichage. Une échéance
// ponctuelle passe directement à 'paye', comportement inchangé.
// `montant_decaisse` (optionnel) : si fourni, crée la dépense réellement
// payée dans Dépenses & caisse et la lie à cette échéance (montant réel,
// pas l'estimation) — gap comblé le 11/09/2026, les deux étaient jusque-là
// des mondes disjoints. Créée directement au statut 'decaissee' (pas de
// circuit soumise->validée->décaissée) : cette action est déjà réservée à
// la direction/comptabilité (echeances_admin.gerer) et enregistre un
// paiement déjà effectué, pas une demande à instruire.
router.post("/:id/traiter", requirePermission("echeances_admin.gerer"), async (req, res) => {
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: current } = await client.query(
      "SELECT periodicite, jour_echeance, mois_echeance, dernier_traite_le, prochaine_date, categorie, libelle FROM echeances_administratives WHERE id = $1 AND actif = TRUE FOR UPDATE",
      [req.params.id]
    );
    if (!current[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Échéance introuvable" }); }
    const e = current[0];
    const aujourdHui = new Date().toISOString().slice(0, 10);
    const echeanceCloturee = calculerProchaineEcheance(e, aujourdHui) || versDateISO(e.prochaine_date);
    const estRecurrente = calculerProchaineEcheance(e, aujourdHui) !== null;

    let depenseId = null;
    if (b.montant_decaisse) {
      const dep = await client.query(
        `INSERT INTO depenses
           (type, categorie, libelle, montant, date_depense, mode_paiement, compte_id,
            statut, soumis_par, valide_par, valide_le, decaisse_par, decaisse_le, cree_par)
         VALUES ('ponctuelle','charges_fiscales_sociales',$1,$2,current_date,$3,$4,
                 'decaissee',$5,$5,now(),$5,now(),$5)
         RETURNING id`,
        [e.libelle, b.montant_decaisse, b.mode_paiement || null, b.compte_id || null, req.user.sub]
      );
      depenseId = dep.rows[0].id;
    }

    const { rows } = await client.query(
      `UPDATE echeances_administratives
         SET dernier_traite_le = $2,
             statut = CASE WHEN $3 THEN 'a_faire' ELSE 'paye' END,
             depense_id = COALESCE($4, depense_id)
       WHERE id = $1 RETURNING id, statut, dernier_traite_le`,
      [req.params.id, echeanceCloturee, estRecurrente, depenseId]
    );
    await client.query("COMMIT");
    // Prochaine occurrence APRÈS clôture de celle-ci (dernier_traite_le
    // vient de changer) — pas la même valeur que echeanceCloturee.
    const prochaine = estRecurrente
      ? calculerProchaineEcheance({ ...e, dernier_traite_le: echeanceCloturee }, aujourdHui)
      : null;
    res.json({ ...rows[0], depense_id: depenseId, prochaine_date: prochaine });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  } finally {
    client.release();
  }
});

module.exports = router;
// Exposée pour un test unitaire déterministe (dates figées, indépendant du
// jour d'exécution réel des tests) — voir tests/echeancesAdministratives.test.js.
module.exports.calculerProchaineEcheance = calculerProchaineEcheance;
