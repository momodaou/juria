// JURIA — centre de notifications dans l'application (lot 1, 07/11/2026).
//
// notifier() crée une ligne par destinataire, la pousse en direct (même flux SSE que la messagerie) et ne lève
// JAMAIS d'erreur : une notification est un confort, elle ne doit jamais faire échouer l'action métier.
// Le texte est composé à l'affichage (composerTexte) : la base ne garde que (type, charge, nombre), sans montant ni
// nom de client (règle commune du Fichier des notifications).
const { pool } = require("./db");
const bus = require("./messagerie-bus");

// Catalogue : niveau par défaut, délai du repli par e-mail (en jours ouvrés × 24 h : voir heuresOuvrees), texte et lien.
// repliHeures = null : jamais d'e-mail de repli pour ce type.
// Nom de la deuxième caisse (lot D) : un seul endroit à changer.
const NOM_CAISSE_PROCEDURE = "la caisse frais de justice & débours";
const laCaisse = (c) => (c && c.caisse === "procedure" ? NOM_CAISSE_PROCEDURE : "la petite caisse");

const CATALOGUE = {
  diligence_assignee: { niveau: "action", repliHeures: 4, texte: (c) => `Une diligence vous est confiée${c.date ? " (le " + jourFr(c.date) + ")" : ""}${c.dossier ? " — dossier " + c.dossier : ""}.`, lien: (c) => (c.ref ? `/role-audience?diligence=${c.ref}` : "/role-audience") },
  diligence_modifiee: { niveau: "information", repliHeures: null, texte: (c) => `Une diligence qui vous est confiée est ${c.statut === "annule" ? "annulée" : "reportée"}${c.dossier ? " — dossier " + c.dossier : ""}.`, lien: (c) => (c.ref ? `/role-audience?diligence=${c.ref}` : "/role-audience") },
  tache_assignee: { niveau: "action", repliHeures: 4, texte: (c) => `Une tâche vous est confiée${c.dossier ? " — dossier " + c.dossier : ""}.`, lien: (c) => (c.ref ? `/plan-action?tache=${c.ref}` : "/plan-action") },
  tache_retard: { niveau: "action", repliHeures: 24, texte: (c) => `Une tâche est en retard${c.dossier ? " — dossier " + c.dossier : ""}.`, lien: (c) => (c.ref ? `/plan-action?tache=${c.ref}` : "/plan-action") },
  relance_action: { niveau: "action", repliHeures: 4, texte: (c) => `${c.par || "Quelqu'un"} vous relance sur ${c.cible === "diligence" ? "une diligence" : "une tâche"}${c.dossier ? " — dossier " + c.dossier : ""}${c.mot ? " : « " + c.mot + " »" : "."}`, lien: (c) => (c.cible === "diligence" ? (c.ref ? `/role-audience?diligence=${c.ref}` : "/role-audience") : (c.ref ? `/plan-action?tache=${c.ref}` : "/plan-action")) },
  delai_procedure: { niveau: "action", repliHeures: null, texte: (c) => (c.jours === 0 ? "Un délai de procédure expire aujourd'hui" : `Un délai de procédure expire dans ${c.jours} jour${c.jours > 1 ? "s" : ""}`) + (c.dossier ? ` — dossier ${c.dossier}.` : "."), lien: (c) => (c.dossier_id ? `/dossiers/${c.dossier_id}${c.ref ? "?evenement=" + c.ref : ""}` : "/echeancier") },
  conflit_a_decider: { niveau: "critique", repliHeures: 2, texte: () => "Un contrôle de conflit d'intérêts attend votre décision.", lien: (c) => (c.ref ? `/conflits?id=${c.ref}` : "/conflits") },
  conflit_tranche: { niveau: "information", repliHeures: null, texte: (c) => `Votre contrôle de conflit est tranché : ${c.decision === "accepte" ? "accepté" : c.decision === "refuse" ? "refusé" : "orienté"}.`, lien: () => "/ouverture" },
  dossier_cree: { niveau: "information", repliHeures: null, texte: (c, n) => (n > 1 ? `${n} nouveaux dossiers ont été créés aujourd'hui.` : `Un nouveau dossier a été créé${c.dossier ? " : " + c.dossier : ""}.`), lien: (c, n) => (n <= 1 && c.dossier_id ? `/dossiers/${c.dossier_id}` : "/dossiers") },
  // --- Lot 2 (07/11/2026) : dépenses, petite caisse, états de charges, retards, stock ---
  depense_soumise: { niveau: "action", repliHeures: null, texte: () => "Une dépense attend votre décision.", lien: (c) => (c.ref ? `/depenses?depense=${c.ref}` : "/depenses") },
  depense_decidee: { niveau: "information", repliHeures: 24, texte: (c) => `Votre dépense a été ${c.decision === "validee" ? "validée" : "rejetée"}${c.motif ? " : « " + c.motif + " »." : "."}`, lien: (c) => (c.ref ? `/depenses?depense=${c.ref}` : "/depenses") },
  depense_a_decaisser: { niveau: "action", repliHeures: 24, texte: () => "Une dépense validée est à décaisser.", lien: (c) => (c.ref ? `/depenses?depense=${c.ref}` : "/depenses") },
  depenses_a_decaisser: { niveau: "action", repliHeures: 24, texte: (c, n) => (n > 1 ? `${n} dépenses validées sont à décaisser.` : "Une dépense validée est à décaisser."), lien: () => "/depenses?statut=validee" },
  depense_decaissee: { niveau: "information", repliHeures: null, texte: () => "Votre dépense a été décaissée.", lien: (c) => (c.ref ? `/depenses?depense=${c.ref}` : "/depenses") },
  depense_blocage: { niveau: "action", repliHeures: null, texte: (c) => `Le décaissement d'une dépense est bloqué${c.motif ? " : « " + c.motif + " »." : "."} Un nouvel ordre de paiement est attendu.`, lien: (c) => (c.ref ? `/depenses?depense=${c.ref}` : "/depenses") },
  caisse_fractionnement: { niveau: "action", repliHeures: null, texte: (c, n) => (n > 1 ? `${n} dépenses rapprochées sur ${laCaisse(c)} font craindre un fractionnement.` : `Des dépenses rapprochées sur ${laCaisse(c)} font craindre un fractionnement.`), lien: (c) => (c.ref ? `/depenses?depense=${c.ref}` : "/depenses") },
  vignette_a_affecter: { niveau: "action", repliHeures: null, texte: (c) => `Une procédure attend sa vignette de plaidoirie${c.dossier ? " — dossier " + c.dossier : ""}.`, lien: (c) => (c.dossier_id ? `/dossiers/${c.dossier_id}` : "/depenses?onglet=cabinet") },
  vignette_rappel: { niveau: "action", repliHeures: null, texte: (c) => `La vignette de plaidoirie d'une procédure n'est toujours pas affectée depuis plus de 3 jours${c.dossier ? " — dossier " + c.dossier : ""}.`, lien: (c) => (c.dossier_id ? `/dossiers/${c.dossier_id}` : "/depenses?onglet=cabinet") },
  vignette_stock_bas: { niveau: "information", repliHeures: null, texte: () => "Le stock de vignettes de plaidoirie est bas : pensez à vous réapprovisionner.", lien: () => "/depenses?onglet=cabinet" },
  depense_annulee: { niveau: "information", repliHeures: null, texte: (c) => `Une dépense a été annulée${c.motif ? " : « " + c.motif + " »." : "."}`, lien: (c) => (c.ref ? `/depenses?depense=${c.ref}` : "/depenses") },
  depense_apres_coup: { niveau: "action", repliHeures: null, texte: (c) => `Une dépense engagée sur ${laCaisse(c)} attend votre validation après coup.`, lien: (c) => (c.ref ? `/depenses?depense=${c.ref}` : "/depenses") },
  depense_apres_coup_traitee: { niveau: "information", repliHeures: 24, texte: (c) => (c.decision === "contestee" ? `Votre dépense engagée est contestée${c.motif ? " : « " + c.motif + " »." : "."}` : "Votre dépense engagée a été validée."), lien: (c) => (c.ref ? `/depenses?depense=${c.ref}` : "/depenses") },
  depense_contestee: { niveau: "information", repliHeures: null, texte: (c) => `Une dépense engagée sur ${laCaisse(c)} a été contestée.`, lien: (c) => (c.ref ? `/depenses?depense=${c.ref}` : "/depenses") },
  caisse_alerte: { niveau: "action", repliHeures: 24, texte: (c) => (c.sujet === "solde_bas" ? `Le solde de ${laCaisse(c)} est bas.` : c.sujet === "non_dotee" ? "La petite caisse n'est pas dotée pour ce mois." : `Un écart a été constaté au rapprochement de ${laCaisse(c)}.`), lien: () => "/depenses" },
  etat_a_soumettre: { niveau: "action", repliHeures: 24, texte: (c) => `L'état de charges de ${moisFr(c.mois)} est à soumettre aux associés.`, lien: (c) => (c.mois ? `/depenses/etat-charges?mois=${String(c.mois).slice(0, 7)}` : "/depenses/etat-charges") },
  etat_soumis: { niveau: "action", repliHeures: null, texte: (c) => `L'état de charges de ${moisFr(c.mois)} est soumis : des lignes attendent votre décision.`, lien: (c) => (c.ref ? `/depenses/etat-charges?etat=${c.ref}` : "/depenses/etat-charges") },
  etat_lignes_decidees: { niveau: "information", repliHeures: null, texte: (c, n) => (n > 1 ? `${n} lignes de l'état de charges de ${moisFr(c.mois)} ont été décidées.` : `Une ligne de l'état de charges de ${moisFr(c.mois)} a été décidée.`), lien: (c) => (c.ref ? `/depenses/etat-charges?etat=${c.ref}` : "/depenses/etat-charges") },
  etat_clos: { niveau: "information", repliHeures: null, texte: (c) => `L'état de charges de ${moisFr(c.mois)} est clos.`, lien: (c) => (c.ref ? `/depenses/etat-charges?etat=${c.ref}` : "/depenses/etat-charges") },
  etat_rouvert: { niveau: "information", repliHeures: null, texte: (c) => `L'état de charges de ${moisFr(c.mois)} a été rouvert par son préparateur.`, lien: (c) => (c.ref ? `/depenses/etat-charges?etat=${c.ref}` : "/depenses/etat-charges") },
  depenses_en_attente: { niveau: "critique", repliHeures: null, texte: (c) => `${c.n > 1 ? c.n + " dépenses attendent" : "Une dépense attend"} votre décision depuis plus de 48 heures.`, lien: () => "/depenses?statut=soumise" },
  apres_coup_en_attente: { niveau: "action", repliHeures: null, texte: (c) => `${c.n > 1 ? c.n + " dépenses engagées attendent" : "Une dépense engagée attend"} votre validation après coup depuis plus de 48 heures.`, lien: () => "/depenses" },
  etat_en_attente: { niveau: "critique", repliHeures: null, texte: (c) => `L'état de charges de ${moisFr(c.mois)} attend vos décisions depuis plus de 48 heures.`, lien: (c) => (c.ref ? `/depenses/etat-charges?etat=${c.ref}` : "/depenses/etat-charges") },
  tache_retard_escalade: { niveau: "critique", repliHeures: null, texte: (c) => `Une tâche que vous avez confiée est en retard depuis plus de 48 heures${c.dossier ? " — dossier " + c.dossier : ""}.`, lien: (c) => (c.ref ? `/plan-action?tache=${c.ref}` : "/plan-action") },
  facturation_a_suivre: { niveau: "action", repliHeures: null, texte: (c, n) => (n > 1 ? `${n} éléments de facturation sont à suivre (factures impayées, dossiers jamais facturés).` : "Un élément de facturation est à suivre (facture impayée ou dossier jamais facturé)."), lien: () => "/facturation" },
  stock_bas: { niveau: "information", repliHeures: null, texte: (c) => `Le stock de chemises ${c.couleur || ""} est bas.`.replace("  ", " "), lien: () => "/cabinet" },
};

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function moisFr(m) {
  const mt = /^(\d{4})-(\d{2})/.exec(String(m || ""));
  return mt ? `${MOIS[Number(mt[2]) - 1]} ${mt[1]}` : "ce mois";
}

const jourFr = (d) => String(d).slice(0, 10).split("-").reverse().join("/");

function composerTexte(n) {
  const def = CATALOGUE[n.type];
  const charge = n.charge || {};
  return def ? def.texte(charge, n.nombre || 1) : "Nouvelle notification.";
}

function composerLien(n) {
  if (n.lien) return n.lien;
  const def = CATALOGUE[n.type];
  return def ? def.lien(n.charge || {}, n.nombre || 1) : null;
}

// Forme envoyée à l'écran (liste et flux en direct).
function presenter(n) {
  return {
    id: n.id, type: n.type, niveau: n.niveau, texte: composerTexte(n), lien: composerLien(n),
    nombre: n.nombre, a_traiter: n.a_traiter && !n.traitee_le, cree_le: n.cree_le, lue_le: n.lue_le, traitee_le: n.traitee_le,
  };
}

// destinataires : tableau d'identifiants (doublons et valeurs vides ignorés). auteurId est toujours exclu (on ne
// prévient jamais quelqu'un de sa propre action). cle : regroupement. ref : référence métier (ex. id de la tâche), utilisée
// pour marquer « traitée » quand l'action est accomplie (traiter()).
async function notifier({ type, destinataires, auteurId = null, charge = {}, ref = null, niveau = null, aTraiter = false, cle = null, lien = null, mode = "incrementer", db = pool }) {
  const def = CATALOGUE[type];
  if (!def) { console.error("Notification : type inconnu", type); return []; }
  try {
    const ids = [...new Set((destinataires || []).filter(Boolean))].filter((id) => id !== auteurId);
    if (!ids.length) return [];
    const { rows: actifs } = await db.query("SELECT id FROM utilisateurs WHERE id = ANY($1::uuid[]) AND actif", [ids]);
    const crees = [];
    const chargeFinale = { ...charge, ...(ref ? { ref: String(ref) } : {}) };
    for (const { id } of actifs) {
      const { rows: [n] } = await db.query(
        `INSERT INTO notifications (destinataire_id, type, niveau, charge, lien, cle_regroupement, a_traiter)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
         ON CONFLICT (destinataire_id, cle_regroupement) WHERE cle_regroupement IS NOT NULL AND lue_le IS NULL
         DO UPDATE SET nombre = notifications.nombre + (CASE WHEN $8 = 'remplacer' THEN 0 ELSE 1 END), cree_le = now(), charge = EXCLUDED.charge
         RETURNING *`,
        [id, type, niveau || def.niveau, JSON.stringify(chargeFinale), lien, cle, !!aTraiter, mode]);
      crees.push(n);
      await bus.publier(db, [id], { type: "notification", notification: presenter(n) });
    }
    return crees;
  } catch (e) {
    console.error("Notification non créée (action métier non affectée) :", e.message);
    return [];
  }
}

// Marque « traitée » toutes les notifications à traiter d'un type donné pour une référence (la tâche est terminée, le
// conflit est tranché…). Informe aussi les écrans ouverts pour que la marque « à traiter » disparaisse.
async function traiter(types, ref, db = pool) {
  try {
    const liste = Array.isArray(types) ? types : [types];
    const { rows } = await db.query(
      `UPDATE notifications SET traitee_le = now()
       WHERE type = ANY($1::text[]) AND charge->>'ref' = $2 AND a_traiter AND traitee_le IS NULL
       RETURNING id, destinataire_id`, [liste, String(ref)]);
    for (const r of rows) await bus.publier(db, [r.destinataire_id], { type: "notification_traitee", id: r.id });
    return rows.length;
  } catch (e) {
    console.error("Notification : marquage « traitée » impossible :", e.message);
    return 0;
  }
}

// Interrupteur général des e-mails de notification (parametres_cabinet.notifications_email_actif, FALSE par défaut).
async function emailsActifs(db = pool) {
  try {
    const { rows: [r] } = await db.query("SELECT notifications_email_actif AS actif FROM parametres_cabinet WHERE id = 1");
    return !!(r && r.actif);
  } catch (e) { return false; }
}

// Numéro d'un dossier (pour le texte minimal des notifications) ; null si absent.
async function numeroDossier(dossierId, db = pool) {
  if (!dossierId) return null;
  try {
    const { rows: [r] } = await db.query("SELECT numero FROM dossiers WHERE id = $1", [dossierId]);
    return r ? r.numero : null;
  } catch (e) { return null; }
}

// Une notification de ce type pour cette référence existe-t-elle déjà (n'importe quel destinataire, depuis `jours` jours) ?
// Sert aux alertes qui ne doivent partir qu'une fois (solde bas du mois, stock bas…).
async function dejaNotifie(type, ref, jours = 3650, db = pool) {
  const { rows } = await db.query(
    "SELECT 1 FROM notifications WHERE type = $1 AND charge->>'ref' = $2 AND cree_le > now() - ($3 || ' days')::interval LIMIT 1", [type, String(ref), String(jours)]);
  return rows.length > 0;
}

// Union de plusieurs permissions (ex. ceux qui dotent la petite caisse et ceux qui décident).
async function titulairesPermissions(codes, db = pool) {
  const ids = new Set();
  for (const c of codes) for (const id of await titulairesPermission(c, db)) ids.add(id);
  return [...ids];
}

// Titulaires d'une permission de la Matrice (comptes actifs).
async function titulairesPermission(code, db = pool) {
  const { rows } = await db.query(
    `SELECT u.id FROM utilisateurs u JOIN permissions_role pr ON pr.role = u.role AND pr.action_code = $1 AND pr.autorise = TRUE
     WHERE u.actif`, [code]);
  return rows.map((r) => r.id);
}

// Nombre d'heures « ouvrées » entre deux instants : les samedis et dimanches (UTC, fuseau de Bamako) ne comptent pas.
function heuresOuvrees(debut, fin) {
  let h = 0;
  const d0 = new Date(debut).getTime(), d1 = new Date(fin).getTime();
  for (let t = d0; t < d1; t += 3600000) {
    const jour = new Date(t).getUTCDay();
    if (jour !== 0 && jour !== 6) h += Math.min(3600000, d1 - t) / 3600000;
  }
  return h;
}

// Bouton « Relancer » (tâche ou diligence). Peuvent relancer : le créateur de l'action, le responsable du dossier et les
// associés (associé, associé-fondateur) ; jamais soi-même ; pas pour une action déjà finie ; au plus une relance toutes les
// 4 heures par action. La relance est tracée au journal d'audit. Renvoie { statut, corps } pour la route.
const { logAudit } = require("./audit");
async function relancer({ cible, id, action, mot, user, ip, db = pool }) {
  // action : { executant_id, cree_par, dossier_id, dossier_responsable_id, termine }
  if (action.termine) return { statut: 409, corps: { error: "Cette action est déjà terminée ou annulée." } };
  if (!action.executant_id) return { statut: 409, corps: { error: "Personne n'est chargé de cette action." } };
  if (action.executant_id === user.sub) return { statut: 400, corps: { error: "Vous ne pouvez pas vous relancer vous-même." } };
  const autorise = action.cree_par === user.sub || action.dossier_responsable_id === user.sub || ["associe", "associe_fondateur"].includes(user.role);
  if (!autorise) return { statut: 403, corps: { error: "Seuls le créateur de l'action, le responsable du dossier et les associés peuvent relancer." } };
  const { rows: [recente] } = await db.query(
    `SELECT 1 FROM journal_audit WHERE action = 'relancer_action' AND entite_id = $1::uuid AND horodatage > now() - interval '4 hours'`, [id]);
  if (recente) return { statut: 429, corps: { error: "Une relance a déjà été envoyée il y a moins de 4 heures." } };
  const texte = mot ? String(mot).trim().slice(0, 200) : "";
  await notifier({
    type: "relance_action", destinataires: [action.executant_id], auteurId: user.sub, ref: id,
    charge: { cible, dossier: await numeroDossier(action.dossier_id, db), par: user.nom, mot: texte || undefined },
  });
  await logAudit({ utilisateurId: user.sub, action: "relancer_action", entite: cible === "diligence" ? "diligences" : "taches", entiteId: id,
    details: { dossier_id: action.dossier_id || null, executant_id: action.executant_id, avec_mot: !!texte }, ip });
  return { statut: 200, corps: { ok: true } };
}

module.exports = { moisFr, dejaNotifie, titulairesPermissions, emailsActifs, relancer, CATALOGUE, notifier, traiter, numeroDossier, titulairesPermission, presenter, composerTexte, heuresOuvrees };
