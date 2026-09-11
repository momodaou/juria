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

// `pg` renvoie une colonne DATE comme un objet Date JS (minuit UTC), pas
// une chaîne — normalise en 'YYYY-MM-DD' partout où ce module manipule des
// dates en provenance de la base, pour ne jamais comparer/concaténer une
// Date et une chaîne par erreur (silencieux : NaN dans une comparaison,
// pas une exception).
function versDateISO(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// Calcule la prochaine occurrence d'une échéance récurrente à partir de sa
// formule (périodicité + jour du mois + mois d'ancrage pour l'annuelle) et
// de la dernière période effectivement traitée — plutôt que de faire
// confiance à une date stockée qu'il faudrait avancer manuellement à
// chaque clic (l'ancien comportement, sujet à dérive si personne ne
// clique pendant plusieurs mois : la date restait figée dans le passé).
// Retourne null pour une échéance ponctuelle (pas de formule, la date
// saisie à la création fait foi telle quelle) ou des données insuffisantes.
// `aujourdHui`/`dernierTraiteLe` : chaînes 'YYYY-MM-DD' (ou null).
function calculerProchaineEcheance({ periodicite, jour_echeance, mois_echeance, dernier_traite_le }, aujourdHui) {
  const pasMois = { mensuelle: 1, trimestrielle: 3, semestrielle: 6, annuelle: 12 }[periodicite];
  if (!pasMois || !jour_echeance) return null;
  const today = new Date(versDateISO(aujourdHui) + "T00:00:00Z");
  const dernierTraiteIso = versDateISO(dernier_traite_le);
  const dernierTraite = dernierTraiteIso ? new Date(dernierTraiteIso + "T00:00:00Z") : null;

  let annee = today.getUTCFullYear();
  // Mois de départ : pour l'annuelle, le mois d'ancrage fixé une fois pour
  // toutes ; sinon (mensuelle/trimestrielle/semestrielle), le mois courant
  // — peu importe lequel, le pas suivant balaie de toute façon tous les
  // mois au fil des itérations ci-dessous.
  let moisIndex = (mois_echeance ?? today.getUTCMonth() + 1) - 1; // 0-indexé

  function occurrence(a, mIdx) {
    // Clampe au dernier jour du mois si jour_echeance le dépasse (ex. 31
    // un mois de 30 jours) — évite un débordement silencieux sur le mois
    // suivant que donnerait Date.UTC(a, mIdx, 31) pour avril.
    const dernierJourDuMois = new Date(Date.UTC(a, mIdx + 1, 0)).getUTCDate();
    return new Date(Date.UTC(a, mIdx, Math.min(jour_echeance, dernierJourDuMois)));
  }

  let candidate = occurrence(annee, moisIndex);
  // Avance tant que la période candidate a déjà été traitée — capture
  // aussi bien "jamais traitée, on prend la période courante" (boucle ne
  // s'exécute pas) que "plusieurs périodes ratées d'affilée" (boucle
  // avance jusqu'à la première période encore ouverte).
  while (dernierTraite && candidate <= dernierTraite) {
    moisIndex += pasMois;
    annee += Math.floor(moisIndex / 12);
    moisIndex = ((moisIndex % 12) + 12) % 12;
    candidate = occurrence(annee, moisIndex);
  }
  return candidate.toISOString().slice(0, 10);
}

// GET /api/echeances-administratives — actives, triées par échéance
// effective (calculée pour les récurrentes, stockée pour les ponctuelles).
router.get("/", requirePermission("echeancier.consulter"), async (req, res) => {
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
router.post("/", requirePermission("echeances_admin.gerer"), async (req, res) => {
  const b = req.body || {};
  if (!b.libelle || !b.prochaine_date) {
    return res.status(400).json({ error: "libelle et prochaine_date requis" });
  }
  const d = new Date(b.prochaine_date + "T00:00:00Z");
  const jourEcheance = d.getUTCDate();
  // Le mois d'ancrage n'a de sens que pour une périodicité >= annuelle
  // (semestrielle/trimestrielle/annuelle) : « le 30 avril » ou « tous les
  // 3 mois à partir de mars » sont des formules réelles. Une périodicité
  // MENSUELLE ne doit jamais être ancrée à son mois de création — sinon
  // calculerProchaineEcheance() la fait redémarrer chaque année sur CE
  // mois-là au lieu de flotter sur le mois courant (bug trouvé en testant :
  // une échéance mensuelle créée en janvier restait bloquée en janvier).
  const moisEcheance = b.periodicite === "mensuelle" ? null : d.getUTCMonth() + 1;
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
