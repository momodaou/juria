// JURIA — instance la plus récente d'un dossier (19/09/2026)
// Réutilisé par dossiers.js (liste) et audiences.js (Rôle d'audience) pour
// afficher le statut de la partie (demandeur/défendeur/appelant/...) sans
// dupliquer la logique de sélection — toujours "la plus récente par
// date_debut", même tri que celui déjà utilisé pour l'historique complet
// des instances sur la fiche dossier (dossiers.js, GET /:id).
// Suppose un alias `d` sur la table `dossiers` dans la requête hôte.
const JOIN_INSTANCE_ACTUELLE = `LEFT JOIN LATERAL (
  SELECT degre, statut_partie, statut_partie_precision
  FROM instances
  WHERE instances.dossier_id = d.id
  ORDER BY date_debut DESC NULLS LAST, cree_le DESC
  LIMIT 1
) ia ON true`;

const SELECT_INSTANCE_ACTUELLE = `ia.degre AS instance_degre, ia.statut_partie AS instance_statut_partie, ia.statut_partie_precision AS instance_statut_partie_precision`;

module.exports = { JOIN_INSTANCE_ACTUELLE, SELECT_INSTANCE_ACTUELLE };
