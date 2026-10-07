// JURIA — Clients contractuels (abonnement), escalade par courriel
// (05/10/2026, voir CLAUDE.md/HISTORY.md). Même patron idempotent que
// jobs/alertesFacturationDiscipline.js, mais l'idempotence ne peut pas
// reposer sur un simple booléen par palier fixe (60j/90j) : la prochaine
// échéance d'un abonnement est une date MOBILE, recalculée à chaque fois
// qu'une nouvelle facture arrive. L'idempotence porte donc ici sur "pour
// QUELLE échéance a-t-on déjà alerté" (dossiers.abonnement_alerte_envoyee_pour,
// une date) plutôt que sur un booléen — dès qu'une facture fait avancer la
// prochaine échéance calculée, l'alerte redevient éligible pour la
// nouvelle période si elle aussi finit par être dépassée.
//
// Destinataires : mêmes rôles que Discipline de facturation Bloc C
// (18/09/2026) — dupliqué plutôt que partagé (ROLES_DESTINATAIRES n'est pas
// exporté par alertesFacturationDiscipline.js), cohérent avec le reste du
// code qui ne partage que la logique correctness-critique (voir
// periodicite.js/abonnements.js), pas les petites listes de configuration.
const { envoyerEmail } = require("../mailer");
const { calculerStatutAbonnement } = require("../abonnements");

const ROLES_DESTINATAIRES = ["associe", "avocat_stagiaire", "collaborateur", "admin_general", "comptable"];

async function destinataires(pool) {
  const { rows } = await pool.query(
    "SELECT id, email, prenom FROM utilisateurs WHERE actif AND role = ANY($1::role_utilisateur[])",
    [ROLES_DESTINATAIRES]
  );
  return rows;
}

function lienDossier(dossierId) {
  const base = process.env.FRONTEND_URL || "https://juria-web-552099340909.europe-west1.run.app";
  return `${base}/dossiers/${dossierId}`;
}

async function executerJobAlertesAbonnements(pool) {
  const dests = await destinataires(pool);
  const aujourdHui = new Date().toISOString().slice(0, 10);
  const { rows: dossiers } = await pool.query(`
    SELECT d.id, d.numero, d.intitule, d.abonnement_periodicite, d.abonnement_jour_facturation,
           d.abonnement_mois_facturation, d.abonnement_alerte_envoyee_pour,
           MAX(f.date_emission) AS abonnement_derniere_facture_le,
           COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client
    FROM dossiers d
    JOIN clients c ON c.id = d.client_id
    LEFT JOIN factures f ON f.dossier_id = d.id AND f.statut <> 'annulee'
    WHERE d.mode_honoraires = 'abonnement' AND d.abonnement_periodicite IS NOT NULL
      AND d.statut NOT IN ('archive')
    GROUP BY d.id, c.denomination, c.prenom, c.nom
  `);

  let notifies = 0, dossiersAlertes = 0;
  for (const d of dossiers) {
    const { abonnement_prochaine_echeance, abonnement_statut } = calculerStatutAbonnement(d, aujourdHui);
    if (abonnement_statut !== "en_retard") continue;
    const dejaAlertePour = d.abonnement_alerte_envoyee_pour
      ? new Date(d.abonnement_alerte_envoyee_pour).toISOString().slice(0, 10)
      : null;
    if (dejaAlertePour === abonnement_prochaine_echeance) continue; // déjà notifié pour cette échéance précise

    await pool.query("UPDATE dossiers SET abonnement_alerte_envoyee_pour = $1 WHERE id = $2", [abonnement_prochaine_echeance, d.id]);
    dossiersAlertes++;
    for (const dest of dests) {
      const resultat = await envoyerEmail({
        to: dest.email,
        subject: `Facturation d'abonnement en retard — ${d.client}`,
        html: `<p>Bonjour ${dest.prenom},</p>
               <p>Le client <strong>${d.client}</strong> (dossier <strong>${d.numero} — ${d.intitule}</strong>, abonnement ${d.abonnement_periodicite})
               n'a pas été facturé depuis l'échéance du <strong>${abonnement_prochaine_echeance}</strong>.</p>
               <p><a href="${lienDossier(d.id)}">Voir le dossier sur JURIA</a></p>`,
      });
      if (resultat.envoye) notifies++;
    }
  }
  return { dossiers_examines: dossiers.length, dossiers_alertes: dossiersAlertes, mails_envoyes: notifies };
}

module.exports = { executerJobAlertesAbonnements };
