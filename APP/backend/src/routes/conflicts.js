// JURIA — Contrôle des conflits d'intérêts (phase obligatoire avant ouverture)
const express = require("express");
const { pool } = require("../db");
const { requirePermission, estAutorise } = require("../permissions");
const { envoyerEmail } = require("../mailer");
const { logAudit } = require("../audit");
const router = express.Router();

// Débloquer les conflits à distance (13/10/2026) — jusqu'ici la décision
// (accepte/refuse/oriente) n'était reachable QUE depuis l'écran où le
// collaborateur a lui-même lancé le contrôle (seul endroit qui affichait
// les boutons de décision) : aucun registre, aucune notification. Un
// associé devait physiquement s'asseoir devant la machine du collaborateur
// bloqué pour pouvoir décider. Corrigé par : (1) un e-mail immédiat aux
// titulaires de `conflits.decision` dès qu'un contrôle sort "potentiel",
// (2) GET / ci-dessous, qui liste les contrôles en attente pour que la
// décision se prenne depuis le propre compte de l'associé, où qu'il soit —
// la route de décision elle-même (POST /:id/decision) était déjà
// reachable à distance, seule l'absence d'écran/notification bloquait.
// Destinataires résolus depuis permissions_role (même principe que
// alertesDoublons.js : jamais une liste de rôles recopiée à la main, qui a
// déjà dérivé de la réalité de la matrice sur ce projet).
async function destinatairesConflit() {
  const { rows } = await pool.query(
    `SELECT DISTINCT u.email, u.prenom
     FROM utilisateurs u
     JOIN permissions_role pr ON pr.role = u.role AND pr.action_code = 'conflits.decision' AND pr.autorise = TRUE
     WHERE u.actif = TRUE`
  );
  return rows;
}

// Lien direct vers UN contrôle précis (13/10/2026, constat utilisateur :
// le lien du mail renvoyait vers le registre entier, sans jamais pointer
// vers le contrôle concerné — « il faut chercher jusqu'en bas pour
// retrouver le dossier récent »). ?id= est lu par conflits.component.ts
// pour défiler/surligner directement la bonne entrée.
function lienConflit(id) {
  const base = process.env.FRONTEND_URL || "https://juria-web-552099340909.europe-west1.run.app";
  return `${base}/conflits?id=${id}`;
}

// Lien de retour pour le COLLABORATEUR (13/10/2026, suite de la
// réflexion sur « que se passe-t-il si entre-temps il est passé à autre
// chose ») — pointe vers /ouverture?conflit=<id>, lu par
// ouverture.component.ts pour restaurer CE contrôle précis, en priorité
// sur tout ce qui se trouve dans son localStorage à ce moment-là (qui a
// pu être écrasé par un contrôle plus récent entre-temps).
function lienOuverture(id) {
  const base = process.env.FRONTEND_URL || "https://juria-web-552099340909.europe-west1.run.app";
  return `${base}/ouverture?conflit=${id}`;
}

const LIBELLES_DECISION = {
  accepte: "accepté",
  refuse: "refusé",
  oriente: "orienté vers un confrère",
};

// Notification au CRÉATEUR une fois la décision prise (13/10/2026) —
// jusqu'ici aucun signal ne revenait vers lui : il ne découvrait la
// décision qu'en revenant par hasard sur l'écran d'ouverture (et perdait
// même cette trace s'il avait entre-temps lancé un autre contrôle,
// écrasant son localStorage). Complète le panneau « Vos contrôles de
// conflit » (GET /mes-controles) plutôt que de s'y substituer : la tuile
// garantit que rien n'est jamais perdu, l'e-mail évite d'attendre qu'il
// retourne par hasard sur « Nouveau dossier » pour le découvrir.
async function notifierDecisionConflit(checkId, decision) {
  try {
    const { rows } = await pool.query(
      `SELECT cc.intitule_projet, u.email, u.prenom
       FROM conflict_checks cc JOIN utilisateurs u ON u.id = cc.cree_par
       WHERE cc.id = $1 AND u.actif = TRUE`,
      [checkId]
    );
    const d = rows[0];
    if (!d || !d.email) return;
    const libelle = LIBELLES_DECISION[decision] || decision;
    const suite = decision === "accepte"
      ? `<p>Vous pouvez reprendre l'ouverture du dossier dès maintenant.</p>`
      : `<p>L'ouverture de ce dossier reste bloquée.</p>`;
    await envoyerEmail({
      to: d.email,
      subject: `Conflit d'intérêts ${libelle} — ${d.intitule_projet || "dossier en préparation"}`,
      html: `<p>Bonjour ${d.prenom},</p>
             <p>Votre contrôle de conflit d'intérêts (projet : <strong>${d.intitule_projet || "non précisé"}</strong>)
             a été <strong>${libelle}</strong>.</p>
             ${suite}
             <p>Voir <a href="${lienOuverture(checkId)}">ce contrôle sur l'écran d'ouverture</a>
             pour continuer — ce lien reste valable même si vous avez entre-temps commencé
             l'ouverture d'un autre dossier.</p>`,
    });
  } catch (e) {
    console.error("Notification de décision de conflit échouée (non bloquant) :", e);
  }
}

async function notifierConflitPotentiel(check, termes) {
  try {
    const dests = await destinatairesConflit();
    if (!dests.length) return;
    const liste = termes.map((t) => `<li>${t.terme} — ${t.correspondances.length} rapprochement(s)</li>`).join("");
    for (const d of dests) {
      await envoyerEmail({
        to: d.email,
        subject: `Conflit d'intérêts à valider — ${check.intitule_projet || "dossier en préparation"}`,
        html: `<p>Bonjour ${d.prenom},</p>
               <p>Un contrôle de conflit d'intérêts vient de signaler un rapprochement
               potentiel (projet : <strong>${check.intitule_projet || "non précisé"}</strong>) :</p>
               <ul>${liste}</ul>
               <p>Le collaborateur reste bloqué à l'étape d'ouverture du dossier tant
               qu'aucune décision n'est prise. Voir <a href="${lienConflit(check.id)}">ce
               contrôle dans le registre</a> pour décider depuis votre propre compte.</p>`,
      });
    }
  } catch (e) {
    console.error("Notification de conflit potentiel échouée (non bloquant) :", e);
  }
}

// POST /api/conflict-checks
// body : { intitule_projet, noms: "SODIMA, Bâtir-SA, ..." }
// Recherche client + partie adverse dans toute la base, enregistre le contrôle,
// et renvoie le résultat (absence / potentiel).
router.post("/", requirePermission("conflits.soumettre"), async (req, res) => {
  const b = req.body || {};
  const termes = String(b.noms || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (termes.length === 0) return res.status(400).json({ error: "Aucun nom fourni" });
  try {
    const details = [];
    for (const t of termes) {
      // Comparaison insensible à l'espace/tiret/point/virgule (21/08/2026,
      // diagnostic utilisateur) — un simple ILIKE %terme% ratait un
      // rapprochement pourtant réel dès qu'un espace/tiret différait entre
      // le nom saisi et le nom déjà en base (ex. « Bâtir SA » vs
      // « Bâtir-SA »). Même normalisation que le contrôle de doublon client
      // (clients.js, GET /verifier-doublon).
      const cli = await pool.query(
        `SELECT id, 'client' AS source, COALESCE(NULLIF(denomination, ''), prenom || ' ' || nom) AS nom
         FROM clients
         WHERE regexp_replace(lower(COALESCE(denomination,'') || ' ' || COALESCE(nom,'') || ' ' || COALESCE(prenom,'')), '[\\s\\-.,]', '', 'g')
               LIKE '%' || regexp_replace(lower($1), '[\\s\\-.,]', '', 'g') || '%'`,
        [t]
      );
      const par = await pool.query(
        `SELECT dp.id, 'partie_adverse' AS source, dp.denomination AS nom, d.numero AS dossier
         FROM dossier_parties dp JOIN dossiers d ON d.id = dp.dossier_id
         WHERE regexp_replace(lower(dp.denomination), '[\\s\\-.,]', '', 'g')
               LIKE '%' || regexp_replace(lower($1), '[\\s\\-.,]', '', 'g') || '%'`,
        [t]
      );
      if (cli.rows.length || par.rows.length) {
        details.push({ terme: t, correspondances: [...cli.rows, ...par.rows] });
      }
    }
    const resultat = details.length ? "potentiel" : "absence";

    const ins = await pool.query(
      `INSERT INTO conflict_checks (intitule_projet, noms_recherches, resultat, details, decision, cree_par)
       VALUES ($1,$2,$3,$4,'en_attente',$5)
       RETURNING id, resultat, decision`,
      [b.intitule_projet || null, termes.join(", "), resultat, JSON.stringify(details), req.user.sub]
    );

    if (resultat === "potentiel") {
      // Hors chemin critique (même principe que la lettre de mission auto
      // de dossiers.js) : un échec d'envoi ne doit jamais faire échouer le
      // contrôle lui-même, dont la réponse est déjà prête.
      await notifierConflitPotentiel(
        { id: ins.rows[0].id, intitule_projet: b.intitule_projet || null },
        details
      );
    }

    res.status(201).json({
      id: ins.rows[0].id,
      resultat,
      decision: ins.rows[0].decision,
      details,
      message: resultat === "potentiel"
        ? "Rapprochement(s) trouvé(s) : décision d'un associé requise avant ouverture."
        : "Aucun conflit détecté : l'ouverture peut se poursuivre.",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/conflict-checks — registre des contrôles en attente de décision
// (13/10/2026), réservé aux mêmes titulaires que la décision elle-même.
// Permet à un associé de décider depuis SON compte, sans avoir à être sur
// l'écran du collaborateur qui a lancé le contrôle (voir note plus haut).
//
// ⚠️ Bug corrigé le 13/10/2026 (après-midi, constat utilisateur : « des
// dossiers anciens affichés à valider qui sont déjà créés ») : le filtre
// ne portait QUE sur `decision = 'en_attente'`, jamais sur `resultat` —
// un contrôle 'absence' (aucun conflit trouvé, l'ouverture se poursuit
// directement, AUCUNE décision n'a jamais été attendue) garde pourtant
// `decision = 'en_attente'` pour toujours, puisque rien n'appelle jamais
// POST /:id/decision dessus. Résultat réel observé en production : 39
// entrées listées, dont 32 'absence' remontant jusqu'au 18/08/2026 — de
// purs résidus historiques, jamais de vrais contrôles en attente. Ajout
// de `AND cc.resultat = 'potentiel'` : élimine le bruit d'un coup, sans
// migration ni purge (les lignes restent en base, juste hors de ce
// filtre — aucune perte d'historique).
// Tri inversé en DESC (le plus récent en tête, demande explicite de
// l'utilisateur) — avec le filtre ci-dessus, la liste reste courte, mais
// l'ordre chronologique reste la bonne convention par défaut.
router.get("/", requirePermission("conflits.decision"), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT cc.id, cc.intitule_projet, cc.noms_recherches, cc.resultat, cc.details, cc.decision, cc.cree_le,
            u.prenom || ' ' || u.nom AS cree_par_nom, u.code AS cree_par_code
     FROM conflict_checks cc
     LEFT JOIN utilisateurs u ON u.id = cc.cree_par
     WHERE cc.decision = 'en_attente' AND cc.resultat = 'potentiel'
     ORDER BY cc.cree_le DESC`
  );
  res.json(rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : [] })));
});

// GET /api/conflict-checks/mes-controles — panneau personnel du
// CRÉATEUR (13/10/2026, demande explicite de l'utilisateur : « une tuile
// séparée dans Nouveau dossier pour lui permettre de reprendre
// l'ouverture »). Contrairement à GET / (registre de décision, réservé
// aux titulaires conflits.decision), ici chacun ne voit QUE ses propres
// contrôles — aucune permission particulière requise. Montre à la fois
// les contrôles encore en attente ET ceux déjà décidés mais pas encore
// `vu` par leur créateur (POST /:id/vu) — règle le vrai problème du
// patch localStorage : celui-ci n'en retient qu'UN seul (le plus récent),
// écrasé dès qu'un nouveau contrôle est lancé ; ce panneau, lui, retrouve
// TOUS les contrôles du créateur, quel que soit leur nombre.
// Placée AVANT GET /:id (sinon Express la capturerait comme si
// "mes-controles" était un id).
router.get("/mes-controles", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, intitule_projet, noms_recherches, resultat, details, decision, motif, cree_le, decide_le
     FROM conflict_checks
     WHERE cree_par = $1 AND resultat = 'potentiel' AND vu_le IS NULL
     ORDER BY cree_le DESC`,
    [req.user.sub]
  );
  res.json(rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : [] })));
});

// POST /api/conflict-checks/:id/vu — le créateur masque/acquitte un
// contrôle de son propre panneau (13/10/2026) : purement personnel,
// aucun effet sur `decision` ni sur le registre de l'associé (GET /).
// Appelée aussi automatiquement quand le dossier est effectivement créé
// à partir de ce contrôle (voir ouverture.component.ts).
router.post("/:id/vu", async (req, res) => {
  const { rows } = await pool.query(
    "UPDATE conflict_checks SET vu_le = now() WHERE id = $1 AND cree_par = $2 RETURNING id",
    [req.params.id, req.user.sub]
  );
  if (!rows[0]) return res.status(404).json({ error: "Contrôle introuvable" });
  res.status(204).send();
});

// GET /api/conflict-checks/:id — consulter l'état d'UN contrôle précis
// (13/10/2026, patch minimal retenu par l'utilisateur pour le bug « en
// actualisant, tout le processus nouveau dossier se réinitialise ») : le
// collaborateur qui a lancé le contrôle n'avait jusqu'ici aucun moyen de
// retrouver son état après un rafraîchissement de page — son seul repère
// vivait dans la mémoire du composant Angular, perdu au moindre F5, ce qui
// le poussait à relancer un second contrôle (doublon + 2e e-mail). Cette
// route sert à restaurer l'écran côté créateur (voir ouverture.component.ts,
// localStorage) — reachable par le créateur du contrôle OU par un titulaire
// de conflits.decision (cohérence avec le registre GET / ci-dessus).
router.get("/:id", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT cc.id, cc.intitule_projet, cc.noms_recherches, cc.resultat, cc.details, cc.decision, cc.motif, cc.cree_par
     FROM conflict_checks cc WHERE cc.id = $1`,
    [req.params.id]
  );
  const check = rows[0];
  if (!check) return res.status(404).json({ error: "Contrôle introuvable" });
  const estCreateur = check.cree_par === req.user.sub;
  const estDecideur = await estAutorise(req.user.role, "conflits.decision", req.user.sub);
  if (!estCreateur && !estDecideur) return res.status(403).json({ error: "Non autorisé" });
  const details = check.details ? JSON.parse(check.details) : [];
  res.json({
    id: check.id,
    intitule_projet: check.intitule_projet,
    noms_recherches: check.noms_recherches,
    resultat: check.resultat,
    decision: check.decision,
    motif: check.motif,
    details,
    message: check.resultat === "potentiel"
      ? (check.decision === "en_attente"
          ? "Rapprochement(s) trouvé(s) : décision d'un associé requise avant ouverture."
          : `Décision enregistrée : ${check.decision}.`)
      : "Aucun conflit détecté : l'ouverture peut se poursuivre.",
  });
});

// POST /api/conflict-checks/:id/decision  (réservé aux associés)
// body : { decision: 'accepte'|'refuse'|'oriente', motif }
router.post("/:id/decision", requirePermission("conflits.decision"), async (req, res) => {
  const { decision, motif } = req.body || {};
  const permis = ["accepte", "refuse", "oriente"];
  if (!permis.includes(decision)) return res.status(400).json({ error: "Décision invalide" });
  try {
    // Garde contre une double décision concurrente sur le même contrôle.
    const { rows } = await pool.query(
      `UPDATE conflict_checks
       SET decision = $1, motif = $2, decide_par = $3, decide_le = now()
       WHERE id = $4 AND decision = 'en_attente'
       RETURNING id, decision, motif`,
      [decision, motif || null, req.user.sub, req.params.id]
    );
    if (!rows[0]) {
      const existe = await pool.query("SELECT 1 FROM conflict_checks WHERE id = $1", [req.params.id]);
      return res.status(existe.rows[0] ? 409 : 404).json({
        error: existe.rows[0] ? "Ce contrôle a déjà reçu une décision (par quelqu'un d'autre entre-temps ?)" : "Contrôle introuvable",
      });
    }
    // Hors chemin critique (même principe que notifierConflitPotentiel
    // ci-dessus) : un échec d'envoi ne doit jamais faire échouer la
    // décision elle-même, déjà enregistrée.
    await notifierDecisionConflit(req.params.id, decision);
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /api/conflict-checks/:id — retirer une entrée du registre sans
// porter de décision (13/10/2026, demande explicite de l'utilisateur :
// « voir si on peut supprimer ou valider »). Usage réel visé : un
// contrôle abandonné ou saisi en double (ex. le collaborateur relance un
// 2e contrôle après avoir perdu sa référence) — un « Refuser » motivé
// serait sémantiquement faux pour ce cas (aucun conflit à refuser, juste
// une entrée à nettoyer). AUCUN lien avec la table dossiers : vérifié
// qu'aucune route n'écrit jamais `conflict_checks.dossier_id` (colonne
// jamais câblée, prévue au schéma mais morte) et qu'aucune autre table
// ne référence `conflict_checks.id` — supprimer cette ligne n'efface
// donc jamais un dossier déjà créé, et n'envoie jamais de mail (l'envoi
// n'a lieu qu'à la création du contrôle, pas à sa décision/suppression).
router.delete("/:id", requirePermission("conflits.decision"), async (req, res) => {
  const { rows } = await pool.query(
    "DELETE FROM conflict_checks WHERE id = $1 RETURNING id, noms_recherches, resultat",
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Contrôle introuvable" });
  await logAudit({
    utilisateurId: req.user.sub, action: "supprimer_conflit", entite: "conflict_checks",
    entiteId: rows[0].id, details: { noms_recherches: rows[0].noms_recherches, resultat: rows[0].resultat }, ip: req.ip,
  });
  res.status(204).send();
});

module.exports = router;
