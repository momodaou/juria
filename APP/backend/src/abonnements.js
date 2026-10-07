// JURIA — clients sous convention-cadre ("abonnement"), 05/10/2026.
//
// Contexte complet (voir CLAUDE.md/HISTORY.md) : jusqu'ici, `abonnement`
// n'était qu'une valeur parmi 5 de `dossiers.mode_honoraires`, sans
// périodicité ni suivi d'aucune sorte — exclu des alertes "jamais facturé"
// du Bloc C (Discipline de facturation) précisément parce qu'un abonnement
// ne suit pas le même rythme qu'un dossier classique, mais sans rien pour
// le remplacer. Conception actée avec l'utilisateur (05/10/2026) : une
// seule convention-cadre active par client pour l'instant — le dossier
// "abonnement" existant sert d'ombrelle, pas de nouvelle table.
//
// Choix central : le statut "à jour / en retard" n'est JAMAIS un indicateur
// qu'on coche à la main (source de dérive, cf. l'ancien `dernier_traite_le`
// avancé manuellement sur echeances_administratives avant le 11/09/2026) —
// il est entièrement DÉRIVÉ de la dernière facture réellement émise et liée
// à CE dossier (factures.dossier_id), comparée à la formule de périodicité
// via le même moteur que les échéances administratives du cabinet
// (calculerProchaineEcheance, voir periodicite.js). Zéro nouvelle colonne
// d'état à maintenir à la main.
"use strict";
const { calculerProchaineEcheance, versDateISO } = require("./periodicite");

// Périodicités valables pour une facturation récurrente (contrairement à
// echeances_administratives, "ponctuelle" n'a pas de sens ici — un
// abonnement est par définition périodique).
const PERIODICITES_ABONNEMENT = ["mensuelle", "trimestrielle", "semestrielle", "annuelle"];

// À inclure dans tout SELECT portant un alias `d` sur `dossiers` qui a
// besoin du statut d'abonnement (liste meta/abonnements, fiche dossier,
// Tableau de bord) — une seule jointure, jamais dupliquée en sous-requête
// scalaire à chaque usage.
const JOIN_ABONNEMENT_FACTURE = `
  LEFT JOIN LATERAL (
    SELECT MAX(date_emission) AS derniere_facture_le
    FROM factures WHERE factures.dossier_id = d.id AND factures.statut <> 'annulee'
  ) abf ON true
`;

const SELECT_ABONNEMENT_BRUT = `
  d.abonnement_periodicite, d.abonnement_jour_facturation, d.abonnement_mois_facturation,
  abf.derniere_facture_le AS abonnement_derniere_facture_le
`;

// Calcule, pour une ligne déjà porteuse de SELECT_ABONNEMENT_BRUT, la
// prochaine échéance de facturation et le statut dérivé — `null` si le
// dossier n'a pas de formule de périodicité renseignée (mode_honoraires
// différent de 'abonnement', ou abonnement sans périodicité encore
// configurée). Statut : 'a_jour' (échéance future ou aujourd'hui) /
// 'en_retard' (échéance déjà dépassée sans facture depuis).
function calculerStatutAbonnement(row, aujourdHui) {
  if (!row.abonnement_periodicite) {
    return { abonnement_prochaine_echeance: null, abonnement_statut: null };
  }
  const prochaine = calculerProchaineEcheance(
    {
      periodicite: row.abonnement_periodicite,
      jour_echeance: row.abonnement_jour_facturation,
      mois_echeance: row.abonnement_mois_facturation,
      dernier_traite_le: row.abonnement_derniere_facture_le,
    },
    aujourdHui
  );
  if (!prochaine) return { abonnement_prochaine_echeance: null, abonnement_statut: null };
  const statut = prochaine < versDateISO(aujourdHui) ? "en_retard" : "a_jour";
  return { abonnement_prochaine_echeance: prochaine, abonnement_statut: statut };
}

module.exports = {
  PERIODICITES_ABONNEMENT,
  JOIN_ABONNEMENT_FACTURE,
  SELECT_ABONNEMENT_BRUT,
  calculerStatutAbonnement,
};
