// JURIA — 28/09/2026 : `documents.confidentialite` (ENUM 'dossier'/'equipe'/
// 'interne'/'restreint', présente dans le schéma depuis le tout premier
// jour) était posée à la création d'un document et renvoyée telle quelle,
// mais n'a JAMAIS filtré quoi que ce soit — trouvé lors de l'audit
// systématique des routes GET du 28/09/2026 (suite de l'audit Cabinet du
// 27/09/2026). Câblée ici pour de vrai, sur les 4 niveaux réellement
// distincts suivants (choisis pour que chaque palier ait un effet concret,
// pas de valeur purement décorative) :
//
//   - 'dossier'  (défaut, comportement historique inchangé) : visible à
//     tout le cabinet ayant accès à la fiche du dossier, ET dans l'aperçu
//     Portail client (« Documents partagés »).
//   - 'interne'  : comme 'dossier' en interne (tout le cabinet), mais
//     JAMAIS montré dans l'aperçu Portail client — document de travail
//     jamais destiné au client.
//   - 'equipe'   : visible uniquement au responsable + intervenants de CE
//     dossier, plus la direction (associé/associé-fondateur/administrateur
//     général/administrateur IT, qui garde toujours une vue d'ensemble) —
//     masqué pour tout autre collègue non affecté au dossier. Jamais dans
//     le Portail client.
//   - 'restreint': niveau le plus élevé — visible seulement au RESPONSABLE
//     du dossier (pas les simples intervenants) + la direction. Jamais
//     dans le Portail client.
//
// Même principe de confidentialité PAR AFFECTATION (pas seulement par
// rôle) que `dossiers.montant_convenu_xof` (05/09/2026, backend/src/routes/
// dossiers.js) — réutilisé ici plutôt que réinventé.
const ROLES_DIRECTION = ["associe", "associe_fondateur", "admin_general", "admin_it"];

// `contexteDossier` : { responsableId, intervenantIds: string[] } — infos du
// dossier auquel le document appartient. `user` : req.user (sub, role).
// `vueClient` : true pour l'aperçu Portail client, false pour la fiche
// dossier interne.
function estDocumentVisible(confidentialite, contexteDossier, user, vueClient) {
  const niveau = confidentialite || "dossier";
  if (vueClient) return niveau === "dossier";
  if (niveau === "dossier" || niveau === "interne") return true;
  const estDirection = ROLES_DIRECTION.includes(user.role);
  const estResponsable = contexteDossier.responsableId === user.sub;
  if (niveau === "restreint") return estDirection || estResponsable;
  // 'equipe'
  const estIntervenant = (contexteDossier.intervenantIds || []).includes(user.sub);
  return estDirection || estResponsable || estIntervenant;
}

// Charge { responsableId, intervenantIds } pour un dossier — factorisé ici
// pour être appelé identiquement par dossiers.js (liste) et documents.js
// (téléchargement d'un document précis).
async function chargerContexteDossier(pool, dossierId) {
  const [{ rows: dossierRows }, { rows: intervRows }] = await Promise.all([
    pool.query("SELECT responsable_id FROM dossiers WHERE id = $1", [dossierId]),
    pool.query("SELECT utilisateur_id FROM dossier_intervenants WHERE dossier_id = $1", [dossierId]),
  ]);
  return {
    responsableId: dossierRows[0]?.responsable_id ?? null,
    intervenantIds: intervRows.map((r) => r.utilisateur_id),
  };
}

module.exports = { estDocumentVisible, chargerContexteDossier, ROLES_DIRECTION };
