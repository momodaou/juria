// JURIA — tâches en retard (Plan d'action), 10-11/10/2026, suite du Bloc B
// du diagnostic "instruction avocat -> collaborateur" (voir CLAUDE.md pour
// la synthèse complète). Première version individualisée (un e-mail par
// destinataire, limité à ses propres tâches) revue le lendemain à la
// demande explicite de l'utilisateur : l'objectif réel est l'assiduité de
// l'exécutant via une VISIBILITÉ COLLECTIVE, pas un rappel privé — même
// principe que alertesRetoursManquants.js (24/09/2026), appliqué ici avec
// un découpage par nature de tâche plutôt qu'un groupe unique.
//
// Deux volets, cloisonnés par `taches.type` (même découpage que
// verifierDelegationTache() dans ../routes/taches.js, Bloc D du même
// diagnostic) :
// - Technique (recherche, rédaction, revue, appel client, dépôt) — travail
//   juridique de fond et actes de procédure -> tout le personnel qui
//   produit du travail juridique (avocats + juristes).
// - Administratif/gestion (facturation, relance, collecte de pièces,
//   autre) -> groupe restreint : avocats ASSOCIÉS seuls (pas Of Counsel/
//   avocat stagiaire/collaborateur) + administrateur général + assistante.
//
// Un même destinataire ne reçoit jamais deux e-mails le même jour : s'il
// est concerné par les deux volets (cas d'un associé), un seul message
// avec les deux sections. Pas de fenêtre glissante (contrairement aux
// audiences/diligences) : une tâche en retard n'a pas d'équivalent "sans
// doute géré ailleurs depuis", elle reste signalée tant qu'elle n'est pas
// clôturée ou que son échéance n'est pas repoussée.
const { envoyerEmail } = require("../mailer");

const TYPES_TECHNIQUE = ["recherche", "redaction", "revue", "appel_client", "depot"];
const TYPES_ADMINISTRATIF = ["facturation", "relance", "collecte_pieces", "autre"];
const ROLES_TECHNIQUE = ["associe", "associe_fondateur", "of_counsel", "avocat_stagiaire", "collaborateur", "juriste"];
const ROLES_ADMINISTRATIF = ["associe", "associe_fondateur", "admin_general", "assistante"];

function lienDossier(dossierId) {
  const base = process.env.FRONTEND_URL || "https://juria-web-552099340909.europe-west1.run.app";
  return dossierId ? `${base}/dossiers/${dossierId}` : base;
}

async function tachesEnRetard(pool) {
  const { rows } = await pool.query(
    `SELECT t.id, t.titre, t.type, t.dossier_id, d.numero AS dossier_numero, d.intitule AS dossier_intitule,
            t.echeance, u.prenom || ' ' || u.nom AS responsable_nom
     FROM taches t
     LEFT JOIN dossiers d ON d.id = t.dossier_id
     LEFT JOIN utilisateurs u ON u.id = t.responsable_id
     WHERE t.statut NOT IN ('termine','annule')
       AND t.echeance IS NOT NULL AND t.echeance < current_date
     ORDER BY t.echeance ASC`
  );
  return rows;
}

async function destinataires(pool, roles) {
  const { rows } = await pool.query(
    "SELECT id, email, prenom, role FROM utilisateurs WHERE actif AND role = ANY($1::role_utilisateur[])",
    [roles]
  );
  return rows;
}

function ligneHtml(t) {
  const joursRetard = Math.round((Date.now() - new Date(t.echeance).getTime()) / 86400000);
  return `<li><strong>${t.titre}</strong> — échéance du ${new Date(t.echeance).toLocaleDateString("fr-FR")}
          (${joursRetard} jour${joursRetard > 1 ? "s" : ""} de retard) — responsable : ${t.responsable_nom || "non assigné"} —
          <a href="${lienDossier(t.dossier_id)}">${t.dossier_numero ? t.dossier_numero + " — " : ""}${t.dossier_intitule || "(sans dossier)"}</a></li>`;
}

async function executerJobAlertesTachesRetard(pool) {
  const taches = await tachesEnRetard(pool);
  const techniques = taches.filter((t) => TYPES_TECHNIQUE.includes(t.type));
  const administratives = taches.filter((t) => TYPES_ADMINISTRATIF.includes(t.type));

  // "destinataires" toujours calculés (même sans occurrence) — cohérent
  // avec les autres jobs d'alerte, utile pour vérifier la composition des
  // 2 groupes indépendamment du volume de tâches en retard du jour.
  const destTechnique = await destinataires(pool, ROLES_TECHNIQUE);
  const destAdministratif = await destinataires(pool, ROLES_ADMINISTRATIF);
  if (!techniques.length && !administratives.length) {
    return { techniques: 0, administratives: 0, destinataires: new Set([...destTechnique, ...destAdministratif].map((d) => d.id)).size, mails_envoyes: 0 };
  }

  // Fusionne les 2 groupes par destinataire (un associé est dans les deux) —
  // un seul e-mail par personne, avec les sections qui la concernent.
  const parDestinataire = new Map();
  for (const d of destTechnique) parDestinataire.set(d.id, { ...d, technique: true, administratif: false });
  for (const d of destAdministratif) {
    const existant = parDestinataire.get(d.id);
    if (existant) existant.administratif = true;
    else parDestinataire.set(d.id, { ...d, technique: false, administratif: true });
  }

  const listeTechnique = techniques.length ? `<ul>${techniques.map(ligneHtml).join("")}</ul>` : "";
  const listeAdministratif = administratives.length ? `<ul>${administratives.map(ligneHtml).join("")}</ul>` : "";

  let notifies = 0;
  for (const [, d] of parDestinataire) {
    const sections = [];
    let nb = 0;
    if (d.technique && techniques.length) {
      sections.push(`<p>Tâches techniques (travail juridique) en retard :</p>${listeTechnique}`);
      nb += techniques.length;
    }
    if (d.administratif && administratives.length) {
      sections.push(`<p>Tâches administratives/gestion en retard :</p>${listeAdministratif}`);
      nb += administratives.length;
    }
    if (!sections.length) continue;
    const resultat = await envoyerEmail({
      to: d.email,
      subject: `${nb} tâche(s) en retard — Plan d'action`,
      html: `<p>Bonjour ${d.prenom},</p>${sections.join("")}
             <p>Merci de mettre à jour leur statut sur JURIA (Plan d'action) dès que possible.</p>`,
    });
    if (resultat.envoye) notifies++;
  }

  return {
    techniques: techniques.length,
    administratives: administratives.length,
    destinataires: parDestinataire.size,
    mails_envoyes: notifies,
  };
}

module.exports = { executerJobAlertesTachesRetard };
