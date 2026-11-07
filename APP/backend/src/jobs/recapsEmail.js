// JURIA — e-mails récapitulatifs du centre de notifications (lot 3, 07/11/2026).
// TOUS gardés par l'interrupteur général parametres_cabinet.notifications_email_actif (FALSE par défaut : aucun e-mail ne part
// tant que l'utilisateur n'a pas donné son feu vert) et jamais le week-end. Texte minimal : des NOMBRES et des liens, jamais de
// montant, de nom de client ni de contenu libre.
//  - recap-matin    : chaque matin ouvré, aux décideurs, les dépenses qui attendent (remplace l'e-mail de repli individuel) ;
//  - recap-lundi    : le lundi matin, UN e-mail par personne : ses diligences et tâches en cours ; pour les associés, les retards du
//                     cabinet ; pour la direction et la comptabilité, la facturation à suivre (impayés, jamais facturé) ;
//  - recap-creations: chaque soir ouvré (17 h 30), aux associés et à l'administration générale, les dossiers créés dans la journée
//                     par d'autres qu'eux (remplace l'e-mail envoyé à chaque création quand l'interrupteur est allumé).
const mailer = require("../mailer");
const { envoiSuspendu } = require("../suspensionEmails");
const notif = require("../notifications");
const { STATUT_FACTURATION_EXPR, JOIN_STATUT_FACTURATION } = require("../facturationDiscipline");

const base = () => process.env.FRONTEND_URL || "https://juria-web-552099340909.europe-west1.run.app";
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
const habillage = (prenom, corps, lienLibelle, lien) =>
  `<p>Bonjour ${prenom},</p>${corps}<p><a href="${lien}">${lienLibelle}</a></p><p style="color:#888;font-size:12px">Message automatique de JURIA — ne pas répondre.</p>`;

async function envoyer(u, sujet, corps, lienLibelle, lien) {
  if (!u.email) return false;
  const r = await mailer.envoyerEmail({ to: u.email, subject: sujet, html: habillage(u.prenom, corps, lienLibelle, lien) });
  return !!(r && r.envoye !== false);
}

const ouvre = (maintenant) => ![0, 6].includes(maintenant.getUTCDay());

async function personnes(pool, ids) {
  if (!ids.length) return [];
  const { rows } = await pool.query("SELECT id, prenom, email, role FROM utilisateurs WHERE actif AND id = ANY($1::uuid[])", [ids]);
  return rows;
}

// --- Matin : dépenses en attente ---------------------------------------------------------------
async function executerRecapMatin(pool, maintenant = new Date()) {
  if (!(await notif.emailsActifs(pool))) return { actif: false, envoyes: 0 };
  if (!ouvre(maintenant)) return { actif: true, week_end: true, envoyes: 0 };
  const decideurs = await personnes(pool, await notif.titulairesPermission("depenses.decision", pool));
  const { rows: [s] } = await pool.query("SELECT count(*)::int AS n FROM depenses WHERE statut = 'soumise'");
  const { rows: engagees } = await pool.query("SELECT engagee_par FROM depenses WHERE apres_coup_statut = 'a_valider' AND annulee_le IS NULL");
  let envoyes = 0;
  for (const u of decideurs) {
    const nCoup = engagees.filter((e) => e.engagee_par !== u.id).length;
    if (!s.n && !nCoup) continue;
    const lignes = [];
    if (s.n) lignes.push(`<li>${pluriel(s.n, "dépense soumise attend", "dépenses soumises attendent")} votre décision</li>`);
    if (nCoup) lignes.push(`<li>${pluriel(nCoup, "dépense engagée sur la petite caisse attend", "dépenses engagées sur la petite caisse attendent")} votre validation après coup</li>`);
    if (await envoyer(u, "JURIA : des dépenses attendent votre décision", `<ul>${lignes.join("")}</ul>`, "Ouvrir Dépenses & caisse", `${base()}/depenses`)) envoyes++;
  }
  return { actif: true, envoyes };
}

// --- Lundi : un seul e-mail par personne ------------------------------------------------------
async function executerRecapLundi(pool, maintenant = new Date()) {
  if (!(await notif.emailsActifs(pool))) return { actif: false, envoyes: 0 };
  if (maintenant.getUTCDay() !== 1) return { actif: true, pas_lundi: true, envoyes: 0 };
  const { rows: dil } = await pool.query(
    "SELECT membre_id AS id, count(*)::int AS n FROM diligences WHERE statut = 'a_faire' AND membre_id IS NOT NULL GROUP BY membre_id");
  const { rows: tac } = await pool.query(
    `SELECT responsable_id AS id, count(*)::int AS n, count(*) FILTER (WHERE echeance < current_date)::int AS retard
     FROM taches WHERE statut NOT IN ('termine','annule') AND responsable_id IS NOT NULL GROUP BY responsable_id`);
  const { rows: [cab] } = await pool.query("SELECT count(*)::int AS n FROM taches WHERE statut NOT IN ('termine','annule') AND echeance < current_date");
  const { rows: [imp] } = await pool.query(
    `SELECT count(*) FILTER (WHERE (current_date - date_echeance) > 90)::int AS j90,
            count(*) FILTER (WHERE (current_date - date_echeance) > 60 AND (current_date - date_echeance) <= 90)::int AS j60
     FROM factures WHERE statut IN ('emise','partielle','impayee') AND date_echeance IS NOT NULL`);
  const { rows: [dos] } = await pool.query(
    `SELECT count(*) FILTER (WHERE s = 'en_attente')::int AS en_attente, count(*) FILTER (WHERE s = 'toujours_pas')::int AS toujours_pas
     FROM (SELECT (${STATUT_FACTURATION_EXPR}) AS s FROM dossiers d ${JOIN_STATUT_FACTURATION}) x WHERE s IS NOT NULL`);
  const facturationRoles = ["associe", "associe_fondateur", "admin_general", "comptable"];
  const associes = ["associe", "associe_fondateur"];
  const ids = new Set([...dil.map((r) => r.id), ...tac.map((r) => r.id)]);
  const { rows: direction } = await pool.query("SELECT id FROM utilisateurs WHERE actif AND role = ANY($1::role_utilisateur[])", [facturationRoles]);
  direction.forEach((r) => ids.add(r.id));
  let envoyes = 0;
  for (const u of await personnes(pool, [...ids])) {
    const sections = [];
    const d = dil.find((r) => r.id === u.id), t = tac.find((r) => r.id === u.id);
    if (d) sections.push(`<li>${pluriel(d.n, "diligence à faire", "diligences à faire")}</li>`);
    if (t) sections.push(`<li>${pluriel(t.n, "tâche en cours", "tâches en cours")}${t.retard ? ` dont ${t.retard} en retard` : ""}</li>`);
    if (associes.includes(u.role) && cab.n) sections.push(`<li>${pluriel(cab.n, "tâche est en retard", "tâches sont en retard")} dans le cabinet</li>`);
    if (facturationRoles.includes(u.role)) {
      if (imp.j60 + imp.j90) sections.push(`<li>${pluriel(imp.j60 + imp.j90, "facture impayée", "factures impayées")} depuis plus de 60 jours${imp.j90 ? ` (dont ${imp.j90} depuis plus de 90 jours)` : ""}</li>`);
      if (dos.en_attente + dos.toujours_pas) sections.push(`<li>${pluriel(dos.en_attente + dos.toujours_pas, "dossier jamais facturé", "dossiers jamais facturés")}${dos.toujours_pas ? ` (dont ${dos.toujours_pas} depuis plus de 60 jours)` : ""}</li>`);
    }
    if (!sections.length) continue;
    if (await envoyer(u, "JURIA : votre point de la semaine", `<p>Voici votre point du lundi :</p><ul>${sections.join("")}</ul>`, "Ouvrir JURIA", base())) envoyes++;
  }
  return { actif: true, envoyes };
}

// --- Soir : dossiers créés dans la journée ---------------------------------------------------
async function executerRecapCreations(pool, maintenant = new Date()) {
  if (!(await notif.emailsActifs(pool))) return { actif: false, envoyes: 0 };
  if (!ouvre(maintenant)) return { actif: true, week_end: true, envoyes: 0 };
  if (await envoiSuspendu("recap_creations", {})) return { actif: true, suspendu: true, envoyes: 0 };
  const { rows: dossiers } = await pool.query(
    `SELECT d.numero, d.cree_par, u.role AS createur_role FROM dossiers d LEFT JOIN utilisateurs u ON u.id = d.cree_par
     WHERE d.cree_le >= date_trunc('day', now()) ORDER BY d.cree_le`);
  if (!dossiers.length) return { actif: true, envoyes: 0 };
  const { rows: dests } = await pool.query("SELECT id, prenom, email, role FROM utilisateurs WHERE actif AND role IN ('associe','admin_general')");
  let envoyes = 0;
  for (const u of dests) {
    // Mêmes règles que l'e-mail par création : un associé n'est pas prévenu des dossiers créés par un associé ; jamais ses propres créations.
    const liste = dossiers.filter((d) => d.cree_par !== u.id && (u.role !== "associe" || !["associe", "associe_fondateur"].includes(d.createur_role)));
    if (!liste.length) continue;
    const corps = `<p>${pluriel(liste.length, "nouveau dossier a été créé", "nouveaux dossiers ont été créés")} aujourd'hui :</p><ul>${liste.map((d) => `<li>${d.numero}</li>`).join("")}</ul>`;
    if (await envoyer(u, `JURIA : ${pluriel(liste.length, "nouveau dossier", "nouveaux dossiers")} aujourd'hui`, corps, "Ouvrir les dossiers", `${base()}/dossiers`)) envoyes++;
  }
  return { actif: true, envoyes };
}

module.exports = { executerRecapMatin, executerRecapLundi, executerRecapCreations };
