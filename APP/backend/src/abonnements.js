// JURIA — clients sous convention-cadre ("abonnement"), 05/10/2026,
// ancrage revu au niveau CLIENT le 09/10/2026.
//
// Contexte complet (voir CLAUDE.md/HISTORY.md) : jusqu'ici, `abonnement`
// n'était qu'une valeur parmi 5 de `dossiers.mode_honoraires`, sans
// périodicité ni suivi d'aucune sorte — exclu des alertes "jamais facturé"
// du Bloc C (Discipline de facturation) précisément parce qu'un abonnement
// ne suit pas le même rythme qu'un dossier classique, mais sans rien pour
// le remplacer.
//
// Revu le 09/10/2026 (analyse approfondie demandée par l'utilisateur,
// exemples réels BDM/Orabank) : la 1re version (05/10/2026) ancrait
// périodicité et statut sur LE DOSSIER — mais la réalité métier est au
// niveau du CLIENT (une seule facture périodique rémunère TOUS les
// dossiers du client, contentieux et conseil confondus). Périodicité,
// ancrage et montant convenu vivent désormais sur `clients`, jamais sur
// `dossiers` — un dossier `mode_honoraires='abonnement'` n'est plus qu'un
// indicateur dérivé de l'état de SON client (voir dossiers.js,
// resoudreModeHonorairesEffectif), jamais configuré individuellement.
//
// Choix central (inchangé) : le statut "à jour / en retard" n'est JAMAIS un
// indicateur qu'on coche à la main (source de dérive, cf. l'ancien
// `dernier_traite_le` avancé manuellement sur echeances_administratives
// avant le 11/09/2026) — il est entièrement DÉRIVÉ de la dernière facture
// réellement émise pour CE CLIENT (factures.client_id — toujours renseigné,
// qu'une facture soit liée ou non à un dossier précis, voir factures.js),
// comparée à la formule de périodicité via le même moteur que les
// échéances administratives du cabinet (calculerProchaineEcheance, voir
// periodicite.js). Zéro nouvelle colonne d'état à maintenir à la main.
"use strict";
const { calculerProchaineEcheance, versDateISO } = require("./periodicite");

// Périodicités valables pour une facturation récurrente (contrairement à
// echeances_administratives, "ponctuelle" n'a pas de sens ici — un
// abonnement est par définition périodique).
const PERIODICITES_ABONNEMENT = ["mensuelle", "trimestrielle", "semestrielle", "annuelle"];

// À inclure dans tout SELECT portant un alias `c` sur `clients` qui a
// besoin du statut d'abonnement (registre clients.js, Tableau de bord,
// job d'alerte) — une seule jointure, jamais dupliquée en sous-requête
// scalaire à chaque usage. `factures.client_id` est TOUJOURS renseigné
// (même pour une facture liée à un dossier précis — voir factures.js),
// donc cette jointure capture bien TOUTE facture du client, qu'elle soit
// rattachée ou non à l'un de ses dossiers.
const JOIN_ABONNEMENT_FACTURE = `
  LEFT JOIN LATERAL (
    SELECT MAX(date_emission) AS derniere_facture_le
    FROM factures WHERE factures.client_id = c.id AND factures.statut <> 'annulee'
  ) abf ON true
`;

const SELECT_ABONNEMENT_BRUT = `
  c.abonnement_periodicite, c.abonnement_jour_facturation, c.abonnement_mois_facturation,
  abf.derniere_facture_le AS abonnement_derniere_facture_le
`;

// Calcule, pour une ligne déjà porteuse de SELECT_ABONNEMENT_BRUT, la
// prochaine échéance de facturation et le statut dérivé — `null` si le
// client n'a pas de formule de périodicité renseignée (pas de convention
// active, ou convention sans périodicité encore configurée). Statut :
// 'a_jour' (échéance future ou aujourd'hui) / 'en_retard' (échéance déjà
// dépassée sans facture depuis).
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
