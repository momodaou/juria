// JURIA — envoi d'e-mails sortants (31/08/2026)
//
// Module générique, réutilisable pour tous les usages d'e-mail de l'appli
// (réinitialisation de mot de passe, envoi de facture/document, lettre de
// compte rendu, alerte de messagerie non lue…) — un seul point de
// configuration SMTP, pas un module par fonctionnalité.
//
// Fournisseur : SMTP du cabinet chez Infomaniak (déjà payé, pas de service
// tiers introduit — voir CLAUDE.md/HISTORY.md, 31/08/2026). Configuré via
// variables d'environnement (Secret Manager en production, voir
// .env.example) — jamais de valeur en dur ici.
//
// Sans configuration SMTP (SMTP_HOST absent, ex. développement local sans
// secret disponible) : repli explicite qui journalise l'e-mail au lieu de
// l'envoyer, plutôt qu'une erreur qui bloquerait tout le flux applicatif
// (même esprit que le repli hors-ligne de l'Assistant IA sans IA_API_KEY).
const nodemailer = require("nodemailer");

let transporteur = null;
function obtenirTransporteur() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporteur) {
    transporteur = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
  }
  return transporteur;
}

// envoyerEmail({ to, subject, html, text?, attachments? }) — attachments au
// format nodemailer standard ([{ filename, content }]), utilisé pour joindre
// un PDF déjà généré en mémoire (facture, lettre) sans passer par un fichier
// temporaire sur disque.
async function envoyerEmail({ to, subject, html, text, attachments }) {
  const t = obtenirTransporteur();
  if (!t) {
    console.warn(`[mailer] SMTP non configuré — e-mail non envoyé (destinataire : ${to}, objet : ${subject})`);
    return { envoye: false, motif: "smtp_non_configure" };
  }
  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
    text: text || undefined,
    attachments,
  });
  return { envoye: true };
}

module.exports = { envoyerEmail };
