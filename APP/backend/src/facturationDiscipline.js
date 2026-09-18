// JURIA — Discipline de facturation, Bloc B : visibilité continue
// (18/09/2026). Statut de facturation calculé pour les dossiers NON pro
// bono — le pro bono a son propre mécanisme distinct et plus ancien
// (`statut_honoraires`/`SELECT_HONORAIRES` dans dossiers.js, comparé au
// seuil de frais de procédure pro bono, pas au même sujet).
//
// Exempté (statut_facturation renvoie NULL) :
//  - un dossier pro bono (couvert par l'autre mécanisme) ;
//  - un dossier clos/archivé/suspendu (statut <> ouvert/en_cours) ;
//  - les modes 'success_fee' et 'abonnement' — un success fee n'a
//    structurellement rien à facturer avant l'issue du dossier (parfois
//    des années), un abonnement peut être facturé au niveau du CLIENT
//    plutôt que du dossier ; les signaler ici produirait un faux positif
//    systématique. Voir CLAUDE.md/HISTORY.md (18/09/2026) pour la
//    discussion complète — NE PAS confondre avec l'exemption de lettre de
//    mission du Bloc A (dossiers.js), qui ne porte QUE sur l'abonnement
//    (et le success fee seulement s'il est rattaché à un client déjà sous
//    abonnement) : deux exemptions distinctes, deux raisons distinctes.
//  - un dossier déjà facturé au moins une fois (cumul_xof > 0).
//
// Seuils (confirmés par l'utilisateur le 18/09/2026) : 30 jours sans
// aucune facture -> 'en_attente' (« En attente de facturation »), 60
// jours -> 'toujours_pas' (« Toujours pas facturé »). Réutilisé tel quel
// par dossiers.js (liste/fiche), audiences.js (Rôle d'audience) et
// dashboard.js (tuile Tableau de bord) — un seul calcul, jamais dupliqué
// avec un risque de définitions divergentes.
// Expression nue (sans alias), pour réutilisation aussi bien dans un
// WHERE (ex. compter les dossiers concernés) que dans un SELECT.
const STATUT_FACTURATION_EXPR = `
  CASE
    WHEN d.pro_bono THEN NULL
    WHEN d.mode_honoraires IN ('success_fee','abonnement') THEN NULL
    WHEN d.statut NOT IN ('ouvert','en_cours') THEN NULL
    WHEN COALESCE(fdf.cumul_xof, 0) > 0 THEN NULL
    WHEN (current_date - d.date_ouverture) >= 60 THEN 'toujours_pas'
    WHEN (current_date - d.date_ouverture) >= 30 THEN 'en_attente'
    ELSE NULL
  END
`;
const SELECT_STATUT_FACTURATION = `${STATUT_FACTURATION_EXPR} AS statut_facturation`;
const JOIN_STATUT_FACTURATION = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(f.montant_ttc_xof), 0) AS cumul_xof
    FROM factures f WHERE f.dossier_id = d.id AND f.statut <> 'annulee'
  ) fdf ON true
`;

module.exports = { STATUT_FACTURATION_EXPR, SELECT_STATUT_FACTURATION, JOIN_STATUT_FACTURATION };
