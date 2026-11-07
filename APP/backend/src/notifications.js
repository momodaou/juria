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
const CATALOGUE = {
  diligence_assignee: { niveau: "action", repliHeures: 4, texte: (c) => `Une diligence vous est confiée${c.date ? " (le " + jourFr(c.date) + ")" : ""}${c.dossier ? " — dossier " + c.dossier : ""}.`, lien: () => "/role-audience" },
  diligence_modifiee: { niveau: "information", repliHeures: null, texte: (c) => `Une diligence qui vous est confiée est ${c.statut === "annule" ? "annulée" : "reportée"}${c.dossier ? " — dossier " + c.dossier : ""}.`, lien: () => "/role-audience" },
  tache_assignee: { niveau: "action", repliHeures: 4, texte: (c) => `Une tâche vous est confiée${c.dossier ? " — dossier " + c.dossier : ""}.`, lien: () => "/plan-action" },
  tache_retard: { niveau: "action", repliHeures: 24, texte: (c) => `Une tâche est en retard${c.dossier ? " — dossier " + c.dossier : ""}.`, lien: () => "/plan-action" },
  relance_action: { niveau: "action", repliHeures: 4, texte: (c) => `${c.par || "Quelqu'un"} vous relance sur ${c.cible === "diligence" ? "une diligence" : "une tâche"}${c.dossier ? " — dossier " + c.dossier : ""}${c.mot ? " : « " + c.mot + " »" : "."}`, lien: (c) => (c.cible === "diligence" ? "/role-audience" : "/plan-action") },
  delai_procedure: { niveau: "action", repliHeures: null, texte: (c) => (c.jours === 0 ? "Un délai de procédure expire aujourd'hui" : `Un délai de procédure expire dans ${c.jours} jour${c.jours > 1 ? "s" : ""}`) + (c.dossier ? ` — dossier ${c.dossier}.` : "."), lien: (c) => (c.dossier_id ? `/dossiers/${c.dossier_id}` : "/echeancier") },
  conflit_a_decider: { niveau: "critique", repliHeures: 2, texte: () => "Un contrôle de conflit d'intérêts attend votre décision.", lien: (c) => (c.ref ? `/conflits?id=${c.ref}` : "/conflits") },
  conflit_tranche: { niveau: "information", repliHeures: null, texte: (c) => `Votre contrôle de conflit est tranché : ${c.decision === "accepte" ? "accepté" : c.decision === "refuse" ? "refusé" : "orienté"}.`, lien: () => "/ouverture" },
  dossier_cree: { niveau: "information", repliHeures: null, texte: (c, n) => (n > 1 ? `${n} nouveaux dossiers ont été créés aujourd'hui.` : `Un nouveau dossier a été créé${c.dossier ? " : " + c.dossier : ""}.`), lien: () => "/dossiers" },
};

const jourFr = (d) => String(d).slice(0, 10).split("-").reverse().join("/");

function composerTexte(n) {
  const def = CATALOGUE[n.type];
  const charge = n.charge || {};
  return def ? def.texte(charge, n.nombre || 1) : "Nouvelle notification.";
}

function composerLien(n) {
  if (n.lien) return n.lien;
  const def = CATALOGUE[n.type];
  return def ? def.lien(n.charge || {}) : null;
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
async function notifier({ type, destinataires, auteurId = null, charge = {}, ref = null, niveau = null, aTraiter = false, cle = null, lien = null, db = pool }) {
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
         DO UPDATE SET nombre = notifications.nombre + 1, cree_le = now(), charge = EXCLUDED.charge
         RETURNING *`,
        [id, type, niveau || def.niveau, JSON.stringify(chargeFinale), lien, cle, !!aTraiter]);
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

module.exports = { emailsActifs, relancer, CATALOGUE, notifier, traiter, numeroDossier, titulairesPermission, presenter, composerTexte, heuresOuvrees };
