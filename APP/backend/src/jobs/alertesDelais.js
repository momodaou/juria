// JURIA — job d'alertes de délais (J-30/J-15/J-7/J-1/J0).
// Extrait de routes/evenements.js le 18/08/2026 pour être appelable à la
// fois par la route existante (déclenchement manuel, authentifié) et par
// le nouveau point d'entrée planifié (routes/internal-jobs.js, appelé par
// Cloud Scheduler) — même logique, deux façons de la déclencher.
const notif = require("../notifications");
const mailer = require("../mailer");

async function executerJobAlertesDelais(pool) {
  // Centre de notifications (07/11/2026) : une notification n'est plus « à traiter » quand le délai n'est plus à venir.
  await pool.query(
    `UPDATE notifications n SET traitee_le = now() FROM evenements e
     WHERE n.type = 'delai_procedure' AND n.a_traiter AND n.traitee_le IS NULL AND n.charge->>'ref' = e.id::text AND e.statut <> 'a_venir'`);
  const emailsActifs = await notif.emailsActifs(pool);
  const associes = await pool.query("SELECT id FROM utilisateurs WHERE actif AND role IN ('associe','associe_fondateur')").then((r) => r.rows.map((x) => x.id));
  const { rows } = await pool.query(
    `SELECT e.id, e.titre, e.date_echeance, e.dossier_id, d.numero AS dossier_numero, d.responsable_id AS dossier_responsable_id,
            e.responsable_id, (e.date_echeance::date - current_date) AS jours_restants,
            e.alerte_j30, e.alerte_j15, e.alerte_j7, e.alerte_j1, e.alerte_j0
     FROM evenements e JOIN dossiers d ON d.id = e.dossier_id
     WHERE e.statut = 'a_venir' AND e.date_echeance::date >= current_date`
  );
  const aNotifier = [];
  for (const e of rows) {
    const j = Number(e.jours_restants);
    let col = null;
    if (j === 0 && !e.alerte_j0) col = "alerte_j0";
    else if (j <= 1 && !e.alerte_j1) col = "alerte_j1";
    else if (j <= 7 && !e.alerte_j7) col = "alerte_j7";
    else if (j <= 15 && !e.alerte_j15) col = "alerte_j15";
    else if (j <= 30 && !e.alerte_j30) col = "alerte_j30";
    if (col) {
      await pool.query(`UPDATE evenements SET ${col} = true WHERE id = $1`, [e.id]);
      aNotifier.push({ id: e.id, dossier: e.dossier_numero, titre: e.titre, jours: j, seuil: col });
      // Responsable du délai et du dossier ; à partir de J-7, escalade aux associés (le plus proche = le plus critique).
      const destinataires = [e.responsable_id, e.dossier_responsable_id, ...(j <= 7 ? associes : [])];
      await notif.notifier({
        type: "delai_procedure", destinataires, ref: e.id, aTraiter: true, niveau: j <= 1 ? "critique" : "action",
        charge: { jours: j, dossier: e.dossier_numero, dossier_id: e.dossier_id, seuil: col },
      });
      // E-mail « tout de suite » seulement aux jalons J-15, J-7, J-1 et le jour même, et seulement si l'interrupteur
      // général des e-mails de notification est activé (désactivé par défaut). Texte minimal : référence du dossier seule.
      if (emailsActifs && ["alerte_j15", "alerte_j7", "alerte_j1", "alerte_j0"].includes(col)) {
        const { rows: dest } = await pool.query(
          "SELECT email, prenom FROM utilisateurs WHERE actif AND id = ANY($1::uuid[]) AND email IS NOT NULL AND email <> ''",
          [[...new Set([e.responsable_id, e.dossier_responsable_id].filter(Boolean))]]);
        const base = process.env.FRONTEND_URL || "https://juria-web-552099340909.europe-west1.run.app";
        for (const u of dest) {
          await mailer.envoyerEmail({
            to: u.email, subject: j === 0 ? "Délai de procédure : échéance aujourd'hui" : `Délai de procédure : échéance dans ${j} jour${j > 1 ? "s" : ""}`,
            html: `<p>Bonjour ${u.prenom},</p><p>Un délai de procédure arrive à échéance (${j === 0 ? "aujourd'hui" : "dans " + j + " jour" + (j > 1 ? "s" : "")}) — dossier ${e.dossier_numero}.</p><p><a href="${base}/dossiers/${e.dossier_id}">Ouvrir le dossier dans JURIA</a></p>`,
          });
        }
      }
    }
  }
  return { traites: rows.length, notifies: aNotifier.length, details: aNotifier };
}

module.exports = { executerJobAlertesDelais };
