// JURIA — instance la plus récente d'un dossier (19/09/2026)
// Réutilisé par dossiers.js (liste) et audiences.js (Rôle d'audience) pour
// afficher le statut de la partie (demandeur/défendeur/appelant/...) sans
// dupliquer la logique de sélection — toujours "la plus récente par
// date_debut", même tri que celui déjà utilisé pour l'historique complet
// des instances sur la fiche dossier (dossiers.js, GET /:id).
// Depuis le 13/11/2026 : une procédure INCIDENTE (défense à exécution…) ne remplace jamais la procédure principale.
// Suppose un alias `d` sur la table `dossiers` dans la requête hôte.
const JOIN_INSTANCE_ACTUELLE = `LEFT JOIN LATERAL (
  SELECT degre, statut_partie, statut_partie_precision
  FROM instances
  WHERE instances.dossier_id = d.id
  ORDER BY (instances.nature = 'principale') DESC, date_debut DESC NULLS LAST, cree_le DESC
  LIMIT 1
) ia ON true`;

const SELECT_INSTANCE_ACTUELLE = `ia.degre AS instance_degre, ia.statut_partie AS instance_statut_partie, ia.statut_partie_precision AS instance_statut_partie_precision`;

// Procédure (instance) à laquelle une audience est rattachée (lot 2, 13/11/2026) : n° d'ordre dans le dossier, nature, type.
// Suppose un alias `a` sur la table `audiences`.
const JOIN_PROCEDURE_AUDIENCE = `LEFT JOIN LATERAL (
  SELECT r.rang, r.nature, r.type_procedure, r.degre FROM (
    SELECT id, nature, type_procedure, degre, ROW_NUMBER() OVER (ORDER BY date_debut NULLS LAST, cree_le) AS rang
    FROM instances WHERE dossier_id = a.dossier_id
  ) r WHERE r.id = a.instance_id
) pa ON true`;
const SELECT_PROCEDURE_AUDIENCE = `a.instance_id, pa.rang AS procedure_rang, pa.nature AS procedure_nature, pa.type_procedure AS procedure_type, pa.degre AS procedure_degre`;

// Même chose pour une table portant dossier_id et instance_id (factures, temps) : alias de la table en paramètre.
function procedureDe(alias) {
  const p = "p" + alias;
  return {
    select: alias + ".instance_id, " + p + ".rang AS procedure_rang, " + p + ".nature AS procedure_nature, " + p + ".type_procedure AS procedure_type",
    join: "LEFT JOIN LATERAL (SELECT r.rang, r.nature, r.type_procedure FROM (SELECT id, nature, type_procedure, "
      + "ROW_NUMBER() OVER (ORDER BY date_debut NULLS LAST, cree_le) AS rang FROM instances WHERE dossier_id = " + alias + ".dossier_id) r "
      + "WHERE r.id = " + alias + ".instance_id) " + p + " ON true",
  };
}

module.exports = { JOIN_INSTANCE_ACTUELLE, SELECT_INSTANCE_ACTUELLE, JOIN_PROCEDURE_AUDIENCE, SELECT_PROCEDURE_AUDIENCE, procedureDe };
