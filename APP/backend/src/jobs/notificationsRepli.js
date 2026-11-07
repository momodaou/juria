// JURIA — e-mail de repli du centre de notifications (lot 1, 07/11/2026).
// Une notification non lue au bout du délai propre à son type (CATALOGUE[type].repliHeures, en heures ouvrées : samedi et
// dimanche ne comptent pas) produit UN SEUL e-mail par personne et par passage, qui liste ce qui attend. Une notification
// lue ne produit jamais d'e-mail. Aucun e-mail le week-end.
// Garde-fous : (1) interrupteur général parametres_cabinet.notifications_email_actif (FALSE par défaut) ; (2) la suspension
// temporaire des e-mails de conflit / création de dossier s'applique aussi ici ; (3) job planifié créé EN PAUSE.
const mailer = require("../mailer");
const { envoiSuspendu } = require("../suspensionEmails");
const notif = require("../notifications");

const TYPES_SUSPENDABLES = ["conflit_a_decider", "conflit_tranche", "dossier_cree"];

function texteSur(n) {
  // Pas de contenu libre dans un e-mail : une relance est annoncée sans son mot.
  if (n.type === "relance_action") return "Vous avez été relancé(e) sur une action.";
  return notif.composerTexte(n);
}

async function executerJobNotificationsRepli(pool, maintenant = new Date()) {
  if (!(await notif.emailsActifs(pool))) return { actif: false, envoyes: 0, notifications: 0 };
  const jour = maintenant.getUTCDay();
  if (jour === 0 || jour === 6) return { actif: true, week_end: true, envoyes: 0, notifications: 0 };

  const { rows } = await pool.query(
    `SELECT n.*, u.email, u.prenom FROM notifications n JOIN utilisateurs u ON u.id = n.destinataire_id
     WHERE n.lue_le IS NULL AND n.repli_envoye_le IS NULL AND (NOT n.a_traiter OR n.traitee_le IS NULL) AND u.actif
       AND n.cree_le > now() - interval '14 days'
     ORDER BY n.destinataire_id, n.cree_le`);
  const echus = rows.filter((n) => {
    const def = notif.CATALOGUE[n.type];
    return def && def.repliHeures != null && notif.heuresOuvrees(n.cree_le, maintenant) >= def.repliHeures;
  });
  const parPersonne = new Map();
  for (const n of echus) {
    if (!parPersonne.has(n.destinataire_id)) parPersonne.set(n.destinataire_id, []);
    parPersonne.get(n.destinataire_id).push(n);
  }
  const base = process.env.FRONTEND_URL || "https://juria-web-552099340909.europe-west1.run.app";
  let envoyes = 0, traitees = 0;
  for (const [, liste] of parPersonne) {
    const suspendues = liste.filter((n) => TYPES_SUSPENDABLES.includes(n.type));
    let aEnvoyer = liste.filter((n) => !TYPES_SUSPENDABLES.includes(n.type));
    if (suspendues.length) {
      if (await envoiSuspendu("notification_repli", { nombre: suspendues.length })) {
        // Suspension active : ces e-mails ne partiront pas (comme les e-mails directs de conflit/création).
        await pool.query("UPDATE notifications SET repli_envoye_le = now() WHERE id = ANY($1::uuid[])", [suspendues.map((n) => n.id)]);
        traitees += suspendues.length;
      } else {
        aEnvoyer = liste;
      }
    }
    if (!aEnvoyer.length || !liste[0].email) continue;
    const u = liste[0];
    const lignes = aEnvoyer.map((n) => `<li>${texteSur(n).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</li>`).join("");
    const sujet = aEnvoyer.length === 1 ? "JURIA : une notification attend votre attention" : `JURIA : ${aEnvoyer.length} notifications attendent votre attention`;
    const r = await mailer.envoyerEmail({
      to: u.email, subject: sujet,
      html: `<p>Bonjour ${u.prenom},</p><p>Vous n'avez pas encore consulté ${aEnvoyer.length === 1 ? "cette notification" : "ces notifications"} :</p><ul>${lignes}</ul>` +
            `<p><a href="${base}">Ouvrir JURIA</a></p><p style="color:#888;font-size:12px">Message automatique — ne pas répondre.</p>`,
    });
    if (r && r.envoye !== false) {
      await pool.query("UPDATE notifications SET repli_envoye_le = now() WHERE id = ANY($1::uuid[])", [aEnvoyer.map((n) => n.id)]);
      envoyes++; traitees += aEnvoyer.length;
    }
  }
  return { actif: true, envoyes, notifications: traitees };
}

module.exports = { executerJobNotificationsRepli };
