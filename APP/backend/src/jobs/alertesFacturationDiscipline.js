// JURIA — Discipline de facturation, Bloc C : escalade par courriel
// (18/09/2026, voir CLAUDE.md/HISTORY.md pour la synthèse de conception
// complète). Deux alertes indépendantes, même patron idempotent que
// jobs/alertesHonoraires.js (18/08/2026) — colonnes booléennes par
// palier, jamais redéclenchées une fois marquées :
//
//  - Impayé : facture émise, non soldée, au-delà de 60 puis 90 jours
//    après son échéance — mêmes bornes déjà utilisées par la tuile
//    "Ancienneté des impayés" du Tableau de bord (dashboard.js).
//  - Jamais facturé ("en attente de facturation") : dossier non pro bono
//    sans aucune facture au-delà de 30 puis 60 jours — réutilise
//    STATUT_FACTURATION_EXPR de facturationDiscipline.js, la même donnée
//    qui pilote le marquage visuel du Bloc B (Rôle d'audience, liste,
//    Tableau de bord) : un seul calcul, jamais deux définitions qui
//    pourraient diverger.
//
// Destinataires — IDENTIQUES pour les deux alertes, confirmés par
// l'utilisateur le 18/09/2026 : tout avocat à l'exclusion de l'associé-
// fondateur et de l'Of Counsel (associé, avocat stagiaire, collaborateur),
// plus Administrateur général et Comptable. Diffusion large délibérée —
// l'objectif explicite est la visibilité collective, pas seulement
// prévenir le responsable du dossier en privé.
//
// Non fait ici, volontairement (déjà signalé comme angle mort dans la
// note de conception, pas encore tranché) : un e-mail récapitulatif
// groupé par destinataire plutôt qu'un e-mail par dossier/facture — cette
// version envoie un e-mail par événement, comme alertesHonoraires.js.
const { envoyerEmail } = require("../mailer");
const { STATUT_FACTURATION_EXPR, JOIN_STATUT_FACTURATION } = require("../facturationDiscipline");

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

// ---------------------------------------------------------------------
// Impayé — facture émise non soldée au-delà de 60 puis 90 jours après
// son échéance (bornes identiques à la tuile "Ancienneté des impayés").
// ---------------------------------------------------------------------
async function executerAlerteImpaye(pool, dests) {
  const { rows: factures } = await pool.query(`
    SELECT f.id, f.numero, f.dossier_id, f.montant_ttc, f.date_echeance,
           (current_date - f.date_echeance) AS jours_retard,
           f.alerte_impaye_j60, f.alerte_impaye_j90,
           COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client
    FROM factures f JOIN clients c ON c.id = f.client_id
    WHERE f.statut IN ('emise','partielle','impayee') AND f.date_echeance IS NOT NULL
      AND (current_date - f.date_echeance) > 60
  `);

  let notifies = 0;
  for (const f of factures) {
    const jours = Number(f.jours_retard);
    let palier = null;
    if (jours > 90 && !f.alerte_impaye_j90) palier = "j90";
    else if (jours > 60 && !f.alerte_impaye_j60) palier = "j60";
    if (!palier) continue;

    const colonnes = palier === "j90" ? ["alerte_impaye_j60", "alerte_impaye_j90"] : ["alerte_impaye_j60"];
    await pool.query(`UPDATE factures SET ${colonnes.map((c) => `${c} = TRUE`).join(", ")} WHERE id = $1`, [f.id]);

    const seuil = palier === "j90" ? "90 jours" : "60 jours";
    for (const d of dests) {
      const resultat = await envoyerEmail({
        to: d.email,
        subject: `Facture impayée depuis plus de ${seuil} — ${f.numero}`,
        html: `<p>Bonjour ${d.prenom},</p>
               <p>La facture <strong>${f.numero}</strong> (${f.client}, ${Number(f.montant_ttc).toLocaleString("fr-FR")} FCFA)
               n'est toujours pas réglée, plus de <strong>${seuil}</strong> après son échéance.</p>
               <p><a href="${lienDossier(f.dossier_id)}">Voir le dossier sur JURIA</a></p>`,
      });
      if (resultat.envoye) notifies++;
    }
  }
  return { factures_concernees: factures.length, mails_envoyes: notifies };
}

// ---------------------------------------------------------------------
// Jamais facturé ("en attente de facturation") — dossier non pro bono
// sans aucune facture au-delà de 30 puis 60 jours.
// ---------------------------------------------------------------------
async function executerAlerteEnAttenteFacturation(pool, dests) {
  const { rows: dossiers } = await pool.query(`
    SELECT d.id, d.numero, d.intitule, d.alerte_facturation_j30, d.alerte_facturation_j60,
           (${STATUT_FACTURATION_EXPR}) AS statut_facturation
    FROM dossiers d
    ${JOIN_STATUT_FACTURATION}
    WHERE (${STATUT_FACTURATION_EXPR}) IS NOT NULL
  `);

  let notifies = 0;
  for (const d of dossiers) {
    let palier = null;
    if (d.statut_facturation === "toujours_pas" && !d.alerte_facturation_j60) palier = "j60";
    else if (d.statut_facturation === "en_attente" && !d.alerte_facturation_j30) palier = "j30";
    if (!palier) continue;

    const colonnes = palier === "j60" ? ["alerte_facturation_j30", "alerte_facturation_j60"] : ["alerte_facturation_j30"];
    await pool.query(`UPDATE dossiers SET ${colonnes.map((c) => `${c} = TRUE`).join(", ")} WHERE id = $1`, [d.id]);

    const libelle = palier === "j60" ? "Toujours pas facturé" : "En attente de facturation";
    for (const dest of dests) {
      const resultat = await envoyerEmail({
        to: dest.email,
        subject: `${libelle} — ${d.numero}`,
        html: `<p>Bonjour ${dest.prenom},</p>
               <p>Le dossier <strong>${d.numero} — ${d.intitule}</strong> n'a toujours aucune facture émise
               (statut : <strong>${libelle.toLowerCase()}</strong>).</p>
               <p><a href="${lienDossier(d.id)}">Voir le dossier sur JURIA</a></p>`,
      });
      if (resultat.envoye) notifies++;
    }
  }
  return { dossiers_concernes: dossiers.length, mails_envoyes: notifies };
}

async function executerJobAlertesFacturationDiscipline(pool) {
  const dests = await destinataires(pool);
  const impaye = await executerAlerteImpaye(pool, dests);
  const enAttenteFacturation = await executerAlerteEnAttenteFacturation(pool, dests);
  return { destinataires: dests.length, impaye, en_attente_facturation: enAttenteFacturation };
}

module.exports = { executerJobAlertesFacturationDiscipline };
