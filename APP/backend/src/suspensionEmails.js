// JURIA — suspension temporaire des e-mails de conflit et de création de
// dossier (21/10/2026). Utile pendant une intégration de dossiers « en
// rafale » : chaque création enverrait un e-mail aux associés, chaque contrôle
// de conflit un autre aux décideurs. La suspension porte une DATE DE FIN : elle
// s'éteint toute seule, sans qu'on ait à y penser. Ne concerne que ces deux
// familles d'e-mails (jamais la réinitialisation de mot de passe, la
// messagerie, les factures…). Les envois ignorés sont tracés dans le journal
// d'audit pour qu'on sache ce qui n'est pas parti.
const { pool } = require("./db");
const { logAudit } = require("./audit");

async function etatSuspension(db = pool) {
  const { rows: [r] } = await db.query(
    "SELECT emails_dossiers_suspendus_jusqu_a AS jusqu_a, (emails_dossiers_suspendus_jusqu_a > now()) AS suspendu FROM parametres_cabinet WHERE id = 1");
  return { suspendu: !!(r && r.suspendu), jusqu_a: r && r.suspendu ? r.jusqu_a : null };
}

// À appeler en tête d'un envoi : renvoie true (et trace l'envoi ignoré) si la suspension est active.
async function envoiSuspendu(type, details = {}) {
  try {
    const { suspendu } = await etatSuspension();
    if (!suspendu) return false;
    console.log(`[mailer] e-mail « ${type} » non envoyé : suspension temporaire active`);
    await logAudit({ action: "email_suspendu", entite: "parametres", details: { type, ...details } });
    return true;
  } catch (e) {
    console.error("Lecture de la suspension des e-mails impossible (envoi maintenu) :", e.message);
    return false;
  }
}

module.exports = { etatSuspension, envoiSuspendu };
