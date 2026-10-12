// JURIA — alerte doublons potentiels (12/10/2026), suite de l'audit du
// 26/09/2026. La tuile Tableau de bord "Doublons potentiels" (voir
// ../doublons.js) est calculée en direct mais purement passive — elle ne
// signale rien tant que personne ne va la consulter. Ce job complète le
// filet de sécurité par un rappel actif, même principe que les autres
// jobs d'escalade e-mail du cabinet (alertesFacturationDiscipline.js,
// alertesRetoursManquants.js…).
//
// Cadence volontairement HEBDOMADAIRE, pas quotidienne : un doublon
// détecté ici n'est pas un événement ponctuel qui se referme tout seul
// (contrairement à une audience sans retour) — il persiste jusqu'à ce
// qu'un humain le corrige manuellement (fusion/suppression/correction).
// Une cadence quotidienne produirait le même rappel, jour après jour,
// pour un doublon déjà identifié la semaine précédente — fatigue d'alerte
// sans valeur ajoutée. Pas de colonne de suivi/flag "déjà signalé" non
// plus : la cadence elle-même (1x/semaine) sert de limite, cohérent avec
// la philosophie "signale, ne bloque jamais" du reste de ce chantier.
//
// Destinataires : calculés à partir de la MÊME permission que celle qui
// gère la tuile (parametres.cabinet.modifier) — pas une liste de rôles
// recopiée à la main, qui a plusieurs fois dérivé de la réalité de la
// matrice sur ce projet (cf. CLAUDE.md, audit du 25/09/2026). Quiconque
// peut voir/agir sur la tuile reçoit le rappel, et seulement ceux-là.
const { envoyerEmail } = require("../mailer");
const { DOUBLONS_CTE } = require("../doublons");

const ACTION_CODE = "parametres.cabinet.modifier";

async function destinataires(pool) {
  const { rows } = await pool.query(
    `SELECT DISTINCT u.email, u.prenom
     FROM utilisateurs u
     JOIN permissions_role pr ON pr.role = u.role AND pr.action_code = $1 AND pr.autorise = TRUE
     WHERE u.actif = TRUE`,
    [ACTION_CODE]
  );
  return rows;
}

function lienTableauDeBord() {
  const base = process.env.FRONTEND_URL || "https://juria-web-552099340909.europe-west1.run.app";
  return `${base}/cockpit`;
}

function ligneHtml(d) {
  return `<li><strong>${d.categorie}</strong>${d.dossier_numero ? ` (${d.dossier_numero})` : ""} — ${d.description} (${d.nb} occurrences)</li>`;
}

async function executerJobAlertesDoublons(pool) {
  const { rows: doublons } = await pool.query(`${DOUBLONS_CTE} SELECT * FROM doublons ORDER BY categorie`);
  const dests = await destinataires(pool);
  if (!doublons.length) return { doublons: 0, destinataires: dests.length, mails_envoyes: 0 };

  const liste = doublons.map(ligneHtml).join("");
  let notifies = 0;
  for (const d of dests) {
    const resultat = await envoyerEmail({
      to: d.email,
      subject: `${doublons.length} doublon(s) potentiel(s) à vérifier dans JURIA`,
      html: `<p>Bonjour ${d.prenom},</p>
             <p>Le filet de sécurité "Doublons potentiels" du Tableau de bord signale les
             groupes suivants, probablement saisis deux fois :</p>
             <ul>${liste}</ul>
             <p>Rappel hebdomadaire — un doublon reste signalé jusqu'à correction manuelle
             (fusion, suppression ou correction de la fiche concernée).
             Voir <a href="${lienTableauDeBord()}">le Tableau de bord</a> pour le détail et les liens directs.</p>`,
    });
    if (resultat.envoye) notifies++;
  }
  return { doublons: doublons.length, destinataires: dests.length, mails_envoyes: notifies };
}

module.exports = { executerJobAlertesDoublons };
