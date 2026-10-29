// JURIA — e-mails des demandes de congé (29/10/2026).
//
// Quatre cas :
//  - nouvelle demande → les personnes ayant la permission « cabinet.conge.notifier » (par défaut : associés et
//    administration générale, réglable dans la Matrice), jamais le demandeur ni l'auteur de la saisie ;
//  - décision (approuvé / refusé) → le demandeur ;
//  - annulation d'un congé déjà approuvé → le demandeur et les mêmes destinataires que pour une demande.
// Les envois sont « au mieux » : un échec n'empêche jamais l'action métier, il est seulement tracé au journal d'audit.
// Confidentialité : pour un congé maladie, le motif n'est jamais repris dans l'e-mail.
const { pool } = require("./db");
const mailer = require("./mailer");
const { logAudit } = require("./audit");

const TYPES = {
  annuel: "congé annuel", maladie: "congé maladie", maternite: "congé de maternité",
  paternite: "congé de paternité", sans_solde: "congé sans solde", autre: "congé",
};
const CODE_NOTIFICATION = "cabinet.conge.notifier";

const echapper = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iso = (d) => String(d instanceof Date ? d.toISOString() : d).slice(0, 10);
const jour = (d) => iso(d).split("-").reverse().join("/");
const nbJours = (debut, fin) => Math.round((Date.parse(iso(fin)) - Date.parse(iso(debut))) / 86400000) + 1;
const base = () => process.env.FRONTEND_URL || "https://juria-web-552099340909.europe-west1.run.app";

async function charger(congeId) {
  const { rows: [c] } = await pool.query(
    `SELECT c.id, c.type, c.date_debut, c.date_fin, c.statut, c.motif, c.utilisateur_id,
            u.prenom, u.nom, u.email,
            a.prenom || ' ' || a.nom AS decideur
     FROM conges c JOIN utilisateurs u ON u.id = c.utilisateur_id
     LEFT JOIN utilisateurs a ON a.id = c.approuve_par
     WHERE c.id = $1::uuid`, [congeId]);
  return c || null;
}

// Personnes autorisées à recevoir l'e-mail (permission de la Matrice), hors exclus.
async function destinataires(exclureIds = []) {
  const { rows } = await pool.query(
    `SELECT u.id, u.prenom, u.email FROM utilisateurs u
     JOIN permissions_role pr ON pr.role = u.role AND pr.action_code = $1 AND pr.autorise = TRUE
     WHERE u.actif AND u.email IS NOT NULL AND u.email <> '' AND NOT (u.id = ANY($2::uuid[]))
     ORDER BY u.nom, u.prenom`, [CODE_NOTIFICATION, exclureIds.filter(Boolean)]);
  return rows;
}

// Autres membres déjà en congé (ou demande en cours) sur tout ou partie de la période.
async function chevauchements(c) {
  const { rows } = await pool.query(
    `SELECT u.prenom || ' ' || u.nom AS membre, x.date_debut, x.date_fin, x.statut
     FROM conges x JOIN utilisateurs u ON u.id = x.utilisateur_id
     WHERE x.id <> $1::uuid AND x.utilisateur_id <> $2::uuid AND x.statut IN ('demande','approuve')
       AND x.date_debut <= $4::date AND x.date_fin >= $3::date
     ORDER BY x.date_debut LIMIT 6`, [c.id, c.utilisateur_id, iso(c.date_debut), iso(c.date_fin)]);
  return rows;
}

function cadre(titre, corpsHtml, lien) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a2b4a;max-width:560px">
    <h2 style="color:#1a2b4a;margin:0 0 12px">${echapper(titre)}</h2>
    ${corpsHtml}
    <p style="margin:18px 0 0"><a href="${echapper(lien)}" style="background:#1a2b4a;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none">Ouvrir Administratif &amp; RH</a></p>
    <p style="color:#888;font-size:12px;margin-top:22px">Message automatique de JURIA — ne pas répondre.</p></div>`;
}

async function envoyer(destinataire, sujet, html, texte) {
  const r = await mailer.envoyerEmail({ to: destinataire.email, subject: sujet, html, text: texte });
  return !!(r && r.envoye !== false);
}

async function tracer(type, congeId, acteurId, total, echecs) {
  await logAudit({ utilisateurId: acteurId || null, action: "email_conge", entite: "conges", entiteId: congeId, details: { type, destinataires: total, echecs } });
}

// Envoie à une liste ; ne lève jamais.
async function diffuser(liste, construire, type, congeId, acteurId) {
  let echecs = 0;
  for (const d of liste) {
    try {
      const { sujet, html, texte } = construire(d);
      if (!(await envoyer(d, sujet, html, texte))) echecs += 1;
    } catch (e) { echecs += 1; console.error("E-mail congé non envoyé :", e.message); }
  }
  try { await tracer(type, congeId, acteurId, liste.length, echecs); } catch (e) { /* trace facultative */ }
}

function detailsPeriode(c) {
  const n = nbJours(c.date_debut, c.date_fin);
  return `${jour(c.date_debut)} au ${jour(c.date_fin)} (${n} jour${n > 1 ? "s" : ""})`;
}
function motifVisible(c) {
  return c.type !== "maladie" && c.motif ? String(c.motif).split(" — ")[0] : "";
}

async function notifierDemande(congeId, acteurId) {
  try {
    const c = await charger(congeId);
    if (!c) return;
    const liste = await destinataires([c.utilisateur_id, acteurId]);
    if (!liste.length) return;
    const chev = await chevauchements(c);
    const nom = `${c.prenom} ${c.nom}`;
    const periode = detailsPeriode(c);
    const motif = motifVisible(c);
    const lignesChev = chev.map((x) => `${echapper(x.membre)} — ${jour(x.date_debut)} au ${jour(x.date_fin)} (${x.statut === "approuve" ? "approuvé" : "en attente"})`);
    await diffuser(liste, () => ({
      sujet: `Demande de ${TYPES[c.type] || "congé"} — ${nom}`,
      html: cadre(`Demande de ${TYPES[c.type] || "congé"}`,
        `<p><b>${echapper(nom)}</b> demande un ${echapper(TYPES[c.type] || "congé")} du <b>${echapper(periode)}</b>.</p>`
        + (motif ? `<p>Motif : ${echapper(motif)}</p>` : "")
        + (lignesChev.length ? `<p style="color:#b45309"><b>À noter :</b> ${lignesChev.length} autre(s) membre(s) déjà absent(s) sur tout ou partie de ces dates :</p><ul>${lignesChev.map((l) => `<li>${l}</li>`).join("")}</ul>` : "<p>Aucun autre membre n'est absent sur ces dates.</p>")
        + `<p>La décision se prend dans JURIA (menu Administratif &amp; RH, section Congés), par une personne habilitée.</p>`, `${base()}/cabinet`),
      texte: `${nom} demande un ${TYPES[c.type] || "congé"} du ${periode}.${motif ? ` Motif : ${motif}.` : ""}${chev.length ? ` Autres absences sur ces dates : ${chev.map((x) => x.membre).join(", ")}.` : ""} Décision dans JURIA (Administratif & RH › Congés).`,
    }), "demande", congeId, acteurId);
  } catch (e) { console.error("notifierDemande :", e.message); }
}

async function notifierDecision(congeId, acteurId, motifRefus) {
  try {
    const c = await charger(congeId);
    if (!c || !c.email || !["approuve", "refuse"].includes(c.statut)) return;
    const accord = c.statut === "approuve";
    const periode = detailsPeriode(c);
    await diffuser([{ email: c.email }], () => ({
      sujet: `Votre demande de ${TYPES[c.type] || "congé"} est ${accord ? "approuvée" : "refusée"}`,
      html: cadre(`Demande ${accord ? "approuvée" : "refusée"}`,
        `<p>Bonjour ${echapper(c.prenom)},</p><p>Votre demande de ${echapper(TYPES[c.type] || "congé")} du <b>${echapper(periode)}</b> a été <b>${accord ? "approuvée" : "refusée"}</b>${c.decideur ? ` par ${echapper(c.decideur)}` : ""}.</p>`
        + (!accord && motifRefus ? `<p>Motif : ${echapper(motifRefus)}</p>` : "")
        + (!accord ? "<p>Rapprochez-vous d'un associé pour en discuter ou déposer une nouvelle demande.</p>" : ""), `${base()}/cabinet`),
      texte: `Votre demande de ${TYPES[c.type] || "congé"} du ${periode} a été ${accord ? "approuvée" : "refusée"}${motifRefus && !accord ? ` (motif : ${motifRefus})` : ""}.`,
    }), accord ? "decision_approuve" : "decision_refuse", congeId, acteurId);
  } catch (e) { console.error("notifierDecision :", e.message); }
}

async function notifierAnnulation(congeId, acteurId, motif) {
  try {
    const c = await charger(congeId);
    if (!c || c.statut !== "annule") return;
    const liste = [];
    if (c.email && c.utilisateur_id !== acteurId) liste.push({ email: c.email, prenom: c.prenom, demandeur: true });
    for (const d of await destinataires([c.utilisateur_id, acteurId])) liste.push({ ...d, demandeur: false });
    if (!liste.length) return;
    const nom = `${c.prenom} ${c.nom}`;
    const periode = detailsPeriode(c);
    await diffuser(liste, (d) => ({
      sujet: `Congé annulé — ${nom}`,
      html: cadre("Congé annulé",
        `<p>${d.demandeur ? "Votre" : `Le`} ${echapper(TYPES[c.type] || "congé")}${d.demandeur ? "" : ` de <b>${echapper(nom)}</b>`} du <b>${echapper(periode)}</b> a été <b>annulé</b>${c.decideur ? ` par ${echapper(c.decideur)}` : ""}.</p>`
        + (motif ? `<p>Motif : ${echapper(motif)}</p>` : ""), `${base()}/cabinet`),
      texte: `${d.demandeur ? "Votre" : "Le"} ${TYPES[c.type] || "congé"}${d.demandeur ? "" : ` de ${nom}`} du ${periode} a été annulé.${motif ? ` Motif : ${motif}.` : ""}`,
    }), "annulation", congeId, acteurId);
  } catch (e) { console.error("notifierAnnulation :", e.message); }
}

module.exports = { notifierDemande, notifierDecision, notifierAnnulation, CODE_NOTIFICATION, destinataires };
