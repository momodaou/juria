// JURIA — tâches en retard (Plan d'action), 10/10/2026, Bloc B du
// diagnostic "instruction avocat -> collaborateur" (voir CLAUDE.md pour la
// synthèse complète). Constat de l'audit : aucun job planifié ne couvrait
// les tâches en retard, contrairement aux audiences/diligences
// (alertesRetoursManquants.js), factures, honoraires et abonnements —
// une tâche urgente pouvait dormir indéfiniment sans que personne ne soit
// relancé activement, visible seulement via consultation manuelle de la
// tuile Tableau de bord.
//
// Différence délibérée avec alertesRetoursManquants.js : pas de "fenêtre
// glissante" de 7 jours (une tâche en retard n'a pas d'équivalent "ça a
// sans doute été géré ailleurs depuis" — elle peut légitimement rester en
// retard en attendant une information externe), et surtout PAS de liste
// large diffusée à un même groupe de rôles fixe : chaque destinataire ne
// reçoit QUE ce qui le concerne personnellement — ses propres tâches en
// retard (responsable_id) ET/OU celles qu'il a confiées à quelqu'un
// d'autre (cree_par), un seul e-mail récapitulatif par jour couvrant les
// deux cas s'ils se présentent. Répond directement au Bloc B du
// diagnostic : visibilité du DONNEUR d'instruction, pas seulement de
// l'exécutant.
const { envoyerEmail } = require("../mailer");

function lienDossier(dossierId) {
  const base = process.env.FRONTEND_URL || "https://juria-web-552099340909.europe-west1.run.app";
  return dossierId ? `${base}/dossiers/${dossierId}` : base;
}

async function tachesEnRetard(pool) {
  const { rows } = await pool.query(`
    SELECT t.id, t.titre, t.dossier_id, d.numero AS dossier_numero, d.intitule AS dossier_intitule,
           t.echeance,
           t.responsable_id, ur.email AS responsable_email, ur.prenom AS responsable_prenom,
           t.cree_par, uc.email AS createur_email, uc.prenom AS createur_prenom,
           ur.prenom || ' ' || ur.nom AS responsable_nom
    FROM taches t
    LEFT JOIN dossiers d ON d.id = t.dossier_id
    LEFT JOIN utilisateurs ur ON ur.id = t.responsable_id
    LEFT JOIN utilisateurs uc ON uc.id = t.cree_par
    WHERE t.statut NOT IN ('termine','annule')
      AND t.echeance IS NOT NULL AND t.echeance < current_date
    ORDER BY t.echeance ASC
  `);
  return rows;
}

// Un destinataire par id utilisateur, avec ses 2 listes ("assignees" = mes
// propres tâches en retard, "confiees" = celles que j'ai confiées à
// quelqu'un d'autre et qui sont en retard) — une tâche auto-assignée
// (cree_par = responsable_id) n'apparaît que dans "assignees", jamais
// dupliquée dans "confiees".
function construireDestinataires(taches) {
  const map = new Map();
  const assurer = (id, email, prenom) => {
    if (!map.has(id)) map.set(id, { email, prenom, assignees: [], confiees: [] });
    return map.get(id);
  };
  for (const t of taches) {
    if (t.responsable_id && t.responsable_email) {
      assurer(t.responsable_id, t.responsable_email, t.responsable_prenom).assignees.push(t);
    }
    if (t.cree_par && t.createur_email && t.cree_par !== t.responsable_id) {
      assurer(t.cree_par, t.createur_email, t.createur_prenom).confiees.push(t);
    }
  }
  return map;
}

function ligneHtml(t, { avecResponsable } = {}) {
  const joursRetard = Math.round((Date.now() - new Date(t.echeance).getTime()) / 86400000);
  const resp = avecResponsable && t.responsable_nom
    ? ` <span style="font-style:italic;font-size:0.85em;color:#666">(${t.responsable_nom})</span>` : "";
  return `<li><strong>${t.titre}</strong> — échéance du ${new Date(t.echeance).toLocaleDateString("fr-FR")}
          (${joursRetard} jour${joursRetard > 1 ? "s" : ""} de retard) —
          <a href="${lienDossier(t.dossier_id)}">${t.dossier_numero ? t.dossier_numero + " — " : ""}${t.dossier_intitule || "(sans dossier)"}</a>${resp}</li>`;
}

async function executerJobAlertesTachesRetard(pool) {
  const taches = await tachesEnRetard(pool);
  if (!taches.length) return { taches_en_retard: 0, destinataires: 0, mails_envoyes: 0 };

  const dests = construireDestinataires(taches);
  let notifies = 0;
  for (const [, d] of dests) {
    let html = `<p>Bonjour ${d.prenom},</p>`;
    if (d.assignees.length) {
      html += `<p>Les tâches suivantes qui vous sont assignées ont dépassé leur échéance :</p>
                <ul>${d.assignees.map((t) => ligneHtml(t)).join("")}</ul>`;
    }
    if (d.confiees.length) {
      html += `<p>Les tâches suivantes, que vous avez confiées, ont dépassé leur échéance :</p>
                <ul>${d.confiees.map((t) => ligneHtml(t, { avecResponsable: true })).join("")}</ul>`;
    }
    html += `<p>Merci de mettre à jour leur statut sur JURIA (Plan d'action) dès que possible.</p>`;
    const resultat = await envoyerEmail({
      to: d.email,
      subject: `${d.assignees.length + d.confiees.length} tâche(s) en retard`,
      html,
    });
    if (resultat.envoye) notifies++;
  }
  return { taches_en_retard: taches.length, destinataires: dests.size, mails_envoyes: notifies };
}

module.exports = { executerJobAlertesTachesRetard };
