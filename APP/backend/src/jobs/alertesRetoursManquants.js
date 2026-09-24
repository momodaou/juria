// JURIA — retours manquants (audiences + diligences), 24/09/2026 (voir
// CLAUDE.md/HISTORY.md pour la synthèse de conception complète). Gap
// signalé par l'utilisateur : rien ne repérait une audience ou une
// diligence dont la date est déjà passée sans qu'un résultat/statut
// définitif ait été saisi (omission).
//
// Contrairement à jobs/alertesFacturationDiscipline.js (colonnes
// booléennes par palier fixe, jamais redéclenché), la fenêtre "24h après
// l'audience, pendant une semaine" est une fenêtre GLISSANTE recalculée à
// chaque exécution — aucune colonne de suivi nécessaire : la condition
// "date entre aujourd'hui-7 et aujourd'hui-1, ET aucun résultat" suffit,
// le job tournant une fois par jour reproduit naturellement "toutes les
// 24h pendant une semaine" (7 exécutions successives max par occurrence,
// avant qu'elle ne sorte de la fenêtre).
//
// Format retenu (demande explicite de l'utilisateur, après discussion) :
// UN SEUL e-mail récapitulatif par destinataire et par jour, listant
// toutes les audiences/diligences encore en attente — pas un e-mail par
// occurrence comme alertesFacturationDiscipline.js. Motif : la relance se
// répète quotidiennement sur une fenêtre de 7 jours et peut concerner
// plusieurs occurrences à la fois ; un e-mail par occurrence produirait
// potentiellement plusieurs mails/jour à la même personne — risque de
// fatigue d'alerte plus élevé qu'avec l'alerte facturation (seuils fixes,
// ponctuels).
//
// Destinataires — confirmés par l'utilisateur le 24/09/2026, puis complétés
// le même jour (« j'ai oublié : ajouter l'assistante juridique... et
// l'admin général, l'admin IT ») : tout avocat à l'exclusion de l'associé-
// fondateur et de l'Of Counsel (associé, avocat stagiaire, collaborateur),
// les juristes collaborateurs (rôle "juriste"), l'Assistante juridique et
// administrative (rôle "assistante" — suit le rôle d'audience/agenda au
// quotidien), l'Administrateur général et l'Administrateur IT (mêmes
// droits de supervision transverse que sur les autres jobs d'alerte du
// cabinet). Diffusion large délibérée, même principe que
// alertesFacturationDiscipline.js — visibilité collective plutôt que
// prévenir uniquement l'audiencier/le membre assigné.
const { envoyerEmail } = require("../mailer");

const ROLES_DESTINATAIRES = [
  "associe", "avocat_stagiaire", "collaborateur", "juriste",
  "assistante", "admin_general", "admin_it",
];
const FENETRE_JOURS = 7; // "pendant une semaine"

function lienDossier(dossierId) {
  const base = process.env.FRONTEND_URL || "https://juria-web-552099340909.europe-west1.run.app";
  return dossierId ? `${base}/dossiers/${dossierId}` : base;
}

async function destinataires(pool) {
  const { rows } = await pool.query(
    "SELECT id, email, prenom FROM utilisateurs WHERE actif AND role = ANY($1::role_utilisateur[])",
    [ROLES_DESTINATAIRES]
  );
  return rows;
}

async function occurrencesEnAttente(pool) {
  const { rows } = await pool.query(`
    SELECT 'audience' AS type, a.id, a.dossier_id, d.numero AS dossier_numero, d.intitule AS dossier_intitule,
           a.date_audience AS date, a.juridiction AS detail,
           ua.prenom || ' ' || ua.nom AS audiencier
    FROM audiences a JOIN dossiers d ON d.id = a.dossier_id
    LEFT JOIN utilisateurs ua ON ua.id = a.avocat_id
    WHERE a.resultat IS NULL
      AND a.date_audience < current_date
      AND a.date_audience >= current_date - $1::int
    UNION ALL
    SELECT 'diligence' AS type, dl.id, dl.dossier_id, d.numero AS dossier_numero, d.intitule AS dossier_intitule,
           dl.date_diligence AS date, COALESCE(dl.lieu, dl.type_diligence) AS detail,
           NULL AS audiencier
    FROM diligences dl LEFT JOIN dossiers d ON d.id = dl.dossier_id
    WHERE dl.statut = 'a_faire'
      AND dl.date_diligence < current_date
      AND dl.date_diligence >= current_date - $1::int
    ORDER BY date ASC
  `, [FENETRE_JOURS]);
  return rows;
}

// 24/09/2026 (complément, même jour) — demande explicite de l'utilisateur :
// mentionner l'audiencier affecté à l'audience (peut différer du
// responsable permanent du dossier, dispatching hebdomadaire — voir
// CLAUDE.md/audiences.js). Style discret (italique, petite taille) plutôt
// qu'une colonne à part : c'est une précision, pas l'information
// principale de la ligne. Uniquement pour les audiences (`o.audiencier`
// reste NULL pour une diligence — l'utilisateur n'a demandé cette mention
// que « pour l'audience »).
function ligneHtml(o) {
  const type = o.type === "audience" ? "Audience" : "Diligence";
  const detail = o.detail ? ` — ${o.detail}` : "";
  const audiencier = o.audiencier
    ? ` <span style="font-style:italic;font-size:0.85em;color:#666">(audiencier : ${o.audiencier})</span>`
    : "";
  return `<li><strong>${type}</strong> du ${new Date(o.date).toLocaleDateString("fr-FR")} —
          <a href="${lienDossier(o.dossier_id)}">${o.dossier_numero ? o.dossier_numero + " — " : ""}${o.dossier_intitule || "(sans dossier)"}</a>${detail}${audiencier}</li>`;
}

async function executerJobAlertesRetoursManquants(pool) {
  const occurrences = await occurrencesEnAttente(pool);
  // "destinataires" toujours calculé (même sans occurrence) — cohérent
  // avec jobs/alertesFacturationDiscipline.js, utile pour vérifier la
  // composition de la liste indépendamment du volume d'occurrences du jour.
  const dests = await destinataires(pool);
  if (!occurrences.length) return { occurrences: 0, destinataires: dests.length, mails_envoyes: 0 };

  const liste = occurrences.map(ligneHtml).join("");
  let notifies = 0;
  for (const d of dests) {
    const resultat = await envoyerEmail({
      to: d.email,
      subject: `${occurrences.length} audience(s)/diligence(s) sans retour saisi`,
      html: `<p>Bonjour ${d.prenom},</p>
             <p>Les audiences/diligences suivantes sont passées sans qu'un résultat ait été saisi
             (rappel envoyé pendant les ${FENETRE_JOURS} jours suivant leur date) :</p>
             <ul>${liste}</ul>
             <p>Merci de saisir le retour dès que possible sur JURIA (Rôle d'audience).</p>`,
    });
    if (resultat.envoye) notifies++;
  }
  return { occurrences: occurrences.length, destinataires: dests.length, mails_envoyes: notifies };
}

module.exports = { executerJobAlertesRetoursManquants };
