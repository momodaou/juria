// JURIA — Clients contractuels (abonnement), escalade par courriel
// (05/10/2026, ancrage revu par CLIENT le 09/10/2026 — voir
// CLAUDE.md/HISTORY.md, exemples réels BDM/Orabank : une facture
// périodique unique rémunère TOUS les dossiers du client, l'ancienne
// version par dossier manquait ce cas précisément). Même patron
// idempotent que jobs/alertesFacturationDiscipline.js, mais l'idempotence
// ne peut pas reposer sur un simple booléen par palier fixe (60j/90j) : la
// prochaine échéance d'un abonnement est une date MOBILE, recalculée à
// chaque fois qu'une nouvelle facture arrive. L'idempotence porte donc ici
// sur "pour QUELLE échéance a-t-on déjà alerté"
// (clients.abonnement_alerte_envoyee_pour, une date) plutôt que sur un
// booléen — dès qu'une facture fait avancer la prochaine échéance
// calculée, l'alerte redevient éligible pour la nouvelle période si elle
// aussi finit par être dépassée.
//
// Destinataires : mêmes rôles que Discipline de facturation Bloc C
// (18/09/2026, révisés le 12/10/2026 — registre des notifications,
// colonne Observations : associés uniquement, fondateur inclus, admin
// général + comptable) — dupliqué plutôt que partagé (ROLES_DESTINATAIRES
// n'est pas exporté par alertesFacturationDiscipline.js), cohérent avec le
// reste du code qui ne partage que la logique correctness-critique (voir
// periodicite.js/abonnements.js), pas les petites listes de configuration.
const { envoyerEmail } = require("../mailer");
const { calculerStatutAbonnement } = require("../abonnements");

const ROLES_DESTINATAIRES = ["associe", "associe_fondateur", "admin_general", "comptable"];

async function destinataires(pool) {
  const { rows } = await pool.query(
    "SELECT id, email, prenom FROM utilisateurs WHERE actif AND role = ANY($1::role_utilisateur[])",
    [ROLES_DESTINATAIRES]
  );
  return rows;
}

function lienClient(clientId) {
  const base = process.env.FRONTEND_URL || "https://juria-web-552099340909.europe-west1.run.app";
  return `${base}/clients/${clientId}`;
}

async function executerJobAlertesAbonnements(pool) {
  const dests = await destinataires(pool);
  const aujourdHui = new Date().toISOString().slice(0, 10);
  // factures.client_id est TOUJOURS renseigné (même pour une facture liée
  // à un dossier précis — voir factures.js) : cette jointure capture donc
  // toute facture du client, qu'elle soit rattachée ou non à l'un de ses
  // dossiers.
  const { rows: clients } = await pool.query(`
    SELECT c.id, COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client,
           c.abonnement_periodicite, c.abonnement_jour_facturation,
           c.abonnement_mois_facturation, c.abonnement_alerte_envoyee_pour,
           MAX(f.date_emission) AS abonnement_derniere_facture_le
    FROM clients c
    LEFT JOIN factures f ON f.client_id = c.id AND f.statut <> 'annulee'
    WHERE c.abonnement_periodicite IS NOT NULL
    GROUP BY c.id
  `);

  let notifies = 0, clientsAlertes = 0;
  for (const c of clients) {
    const { abonnement_prochaine_echeance, abonnement_statut } = calculerStatutAbonnement(c, aujourdHui);
    if (abonnement_statut !== "en_retard") continue;
    const dejaAlertePour = c.abonnement_alerte_envoyee_pour
      ? new Date(c.abonnement_alerte_envoyee_pour).toISOString().slice(0, 10)
      : null;
    if (dejaAlertePour === abonnement_prochaine_echeance) continue; // déjà notifié pour cette échéance précise

    await pool.query("UPDATE clients SET abonnement_alerte_envoyee_pour = $1 WHERE id = $2", [abonnement_prochaine_echeance, c.id]);
    clientsAlertes++;
    for (const dest of dests) {
      const resultat = await envoyerEmail({
        to: dest.email,
        subject: `Facturation d'abonnement en retard — ${c.client}`,
        html: `<p>Bonjour ${dest.prenom},</p>
               <p>Le client <strong>${c.client}</strong> (convention-cadre ${c.abonnement_periodicite})
               n'a pas été facturé depuis l'échéance du <strong>${abonnement_prochaine_echeance}</strong>.</p>
               <p><a href="${lienClient(c.id)}">Voir le client sur JURIA</a></p>`,
      });
      if (resultat.envoye) notifies++;
    }
  }
  return { clients_examines: clients.length, clients_alertes: clientsAlertes, mails_envoyes: notifies };
}
module.exports = { executerJobAlertesAbonnements };
