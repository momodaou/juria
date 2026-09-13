// JURIA — notification e-mail pour message instantané non lu (13/09/2026,
// demande différée le 11/09/2026, reprise après l'audit de la messagerie ;
// formule à 2 critères ajoutée le 13/09/2026 après échange avec
// l'utilisateur — un simple message isolé (« Bonjour ») ne doit pas
// déclencher d'e-mail, mais un message UNIQUE réellement important non
// plus ne doit pas être ignoré).
//
// Déclenché périodiquement (Cloud Scheduler, ~toutes les 5 min, même
// patron que alertesDelais.js/alertesHonoraires.js). Un e-mail par
// PARTICIPANT et par CONVERSATION (pas un par message, pour ne pas
// spammer si plusieurs messages arrivent d'affilée) — envoyé seulement si
// le destinataire est hors ligne (aucune ligne presence_utilisateurs
// fraîche, voir messagerie.js) ET depuis ≥10 minutes ET
// (AU MOINS 2 messages non lus [relance sans réponse] OU au moins un
// message marqué IMPORTANT par son auteur [messages.important — pas de
// détection automatique de contenu, volontairement : seul l'auteur sait
// si son message est important, même logique que le drapeau « urgence »
// déjà posé à la main sur un dossier]) ET n'a pas déjà été notifié pour
// ce même lot de non-lus (conversation_participants.dernier_email_notifie_le,
// remis à zéro implicitement dès qu'il lit réellement — voir la condition
// sur dernier_lu_le ci-dessous).
const SEUIL_MESSAGES_NON_LUS = 2;
const { envoyerEmail } = require("../mailer");

async function executerJobMessagerieNotifications(pool) {
  const { rows: candidats } = await pool.query(`
    WITH lots_non_lus AS (
      SELECT cp.conversation_id, cp.utilisateur_id, cp.dernier_lu_le, cp.dernier_email_notifie_le,
             c.titre,
             COUNT(m.id) AS non_lus,
             bool_or(m.important) AS a_important,
             MIN(m.cree_le) AS premier_non_lu_le,
             array_agg(DISTINCT (au.prenom || ' ' || au.nom)) AS expediteurs
      FROM conversation_participants cp
      JOIN conversations c ON c.id = cp.conversation_id
      JOIN messages m ON m.conversation_id = cp.conversation_id
                       AND m.auteur_id <> cp.utilisateur_id
                       AND m.cree_le > COALESCE(cp.dernier_lu_le, 'epoch'::timestamptz)
      JOIN utilisateurs au ON au.id = m.auteur_id
      WHERE NOT EXISTS (
        SELECT 1 FROM presence_utilisateurs p
        WHERE p.utilisateur_id = cp.utilisateur_id AND p.derniere_activite > now() - interval '45 seconds'
      )
      AND (cp.dernier_email_notifie_le IS NULL OR cp.dernier_email_notifie_le <= COALESCE(cp.dernier_lu_le, 'epoch'::timestamptz))
      GROUP BY cp.conversation_id, cp.utilisateur_id, cp.dernier_lu_le, cp.dernier_email_notifie_le, c.titre
    )
    SELECT l.*, u.email, u.prenom, u.nom
    FROM lots_non_lus l
    JOIN utilisateurs u ON u.id = l.utilisateur_id
    WHERE l.premier_non_lu_le <= now() - interval '10 minutes'
      AND (l.non_lus >= $1 OR l.a_important)
      AND u.actif
  `, [SEUIL_MESSAGES_NON_LUS]);

  const lienBase = process.env.FRONTEND_URL || "https://juria-web-552099340909.europe-west1.run.app";
  let notifies = 0;
  for (const c of candidats) {
    const titre = c.titre || c.expediteurs.join(", ");
    const pluriel = Number(c.non_lus) > 1;
    const prefixeSujet = c.a_important ? "Message important" : pluriel ? "Nouveaux messages" : "Nouveau message";
    const resultat = await envoyerEmail({
      to: c.email,
      subject: `${prefixeSujet} sur JURIA — ${titre}`,
      html: `<p>Bonjour ${c.prenom},</p>
             <p>${c.a_important ? "Un message marqué <strong>important</strong> reste" : pluriel ? `Vous avez ${c.non_lus} nouveaux messages non lus` : "Vous avez un nouveau message non lu"}
                ${c.a_important ? "non lu" : ""} de ${c.expediteurs.join(", ")} dans la conversation « ${titre} », depuis plus de 10 minutes.</p>
             <p><a href="${lienBase}/messagerie">Ouvrir la messagerie JURIA</a></p>`,
    });
    if (resultat.envoye) {
      await pool.query(
        "UPDATE conversation_participants SET dernier_email_notifie_le = now() WHERE conversation_id = $1 AND utilisateur_id = $2",
        [c.conversation_id, c.utilisateur_id]
      );
      notifies++;
    }
  }
  return { candidats: candidats.length, notifies };
}

module.exports = { executerJobMessagerieNotifications };
