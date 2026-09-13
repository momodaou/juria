// JURIA — Messagerie instantanée interne (distincte du « Fil du dossier »
// de communications.js, qui est un journal de traçabilité, pas un canal de
// discussion). Diffusion en direct : voir messagerie-bus.js.
const express = require("express");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const { SECRET, authenticate } = require("../auth");
const { requirePermission } = require("../permissions");
const bus = require("../messagerie-bus");

const router = express.Router();

// Toutes les routes de ce module exigent une authentification, SAUF /stream
// qui ne peut pas passer par le middleware standard (EventSource ne pose
// pas d'en-tête Authorization) — elle vérifie son propre jeton en query,
// voir plus bas.
router.use((req, res, next) => (req.path === "/stream" ? next() : authenticate(req, res, next)));

// Connexion d'écoute LISTEN dédiée, démarrée une fois au chargement du
// module (donc une fois par instance Cloud Run). Mêmes paramètres que le
// pool de db.js. Sautée sous Jest (NODE_ENV=test, positionné automatiquement
// par le runner) : une connexion PG maintenue ouverte indéfiniment empêche
// le process de test de se terminer proprement.
if (process.env.NODE_ENV !== "test") {
  bus.demarrerEcoute({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "juria_app",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "juria",
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  });
}

// Vérifie l'appartenance de l'utilisateur à une conversation ; lève une
// erreur 403/404 gérée par l'appelant si absent.
async function estParticipant(conversationId, utilisateurId) {
  const { rows } = await pool.query(
    "SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND utilisateur_id = $2",
    [conversationId, utilisateurId]
  );
  return !!rows[0];
}

// GET /api/messagerie/conversations — mes conversations, dernier message
// et nombre de non-lus (messages postés après dernier_lu_le, ou tous si
// jamais lu).
router.get("/conversations", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.titre, c.dossier_id, c.cree_le,
              cp.dernier_lu_le,
              (SELECT array_agg(u.prenom || ' ' || u.nom ORDER BY u.prenom)
                 FROM conversation_participants cp2 JOIN utilisateurs u ON u.id = cp2.utilisateur_id
                 WHERE cp2.conversation_id = c.id AND cp2.utilisateur_id <> $1) AS autres_participants,
              -- Alignés index par index avec autres_participants (même ORDER BY) — 13/09/2026,
              -- présence : permet au client de savoir QUI afficher en ligne/hors ligne
              -- sans dépendre d'une correspondance fragile sur le nom affiché.
              (SELECT array_agg(u.id ORDER BY u.prenom)
                 FROM conversation_participants cp2 JOIN utilisateurs u ON u.id = cp2.utilisateur_id
                 WHERE cp2.conversation_id = c.id AND cp2.utilisateur_id <> $1) AS autres_participants_ids,
              (SELECT m.contenu FROM messages m WHERE m.conversation_id = c.id ORDER BY m.cree_le DESC LIMIT 1) AS dernier_message,
              (SELECT m.cree_le FROM messages m WHERE m.conversation_id = c.id ORDER BY m.cree_le DESC LIMIT 1) AS dernier_message_le,
              (SELECT COUNT(*) FROM messages m
                 WHERE m.conversation_id = c.id
                   AND m.cree_le > COALESCE(cp.dernier_lu_le, 'epoch'::timestamptz)
                   AND m.auteur_id <> $1) AS non_lus
       FROM conversations c
       JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.utilisateur_id = $1
       ORDER BY dernier_message_le DESC NULLS LAST, c.cree_le DESC`,
      [req.user.sub]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/messagerie/non-lus — total, pour la pastille de la barre latérale.
router.get("/non-lus", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM messages m
       JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.utilisateur_id = $1
       WHERE m.cree_le > COALESCE(cp.dernier_lu_le, 'epoch'::timestamptz) AND m.auteur_id <> $1`,
      [req.user.sub]
    );
    res.json({ total: Number(rows[0].total) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/messagerie/conversations  { participants: [id,...], titre?, dossier_id? }
router.post("/conversations", requirePermission("messagerie.creer_conversation"), async (req, res) => {
  const b = req.body || {};
  const participants = Array.isArray(b.participants) ? b.participants.filter(Boolean) : [];
  if (participants.length === 0) return res.status(400).json({ error: "Au moins un autre participant requis" });
  const tousParticipants = [...new Set([req.user.sub, ...participants])];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const conv = await client.query(
      `INSERT INTO conversations (titre, dossier_id, cree_par) VALUES ($1,$2,$3) RETURNING id, titre, dossier_id, cree_le`,
      [b.titre || null, b.dossier_id || null, req.user.sub]
    );
    for (const uid of tousParticipants) {
      await client.query(
        "INSERT INTO conversation_participants (conversation_id, utilisateur_id) VALUES ($1,$2)",
        [conv.rows[0].id, uid]
      );
    }
    await client.query("COMMIT");
    res.status(201).json(conv.rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// GET /api/messagerie/conversations/:id/messages?avant=<ISO>  (page de 50)
router.get("/conversations/:id/messages", async (req, res) => {
  try {
    if (!(await estParticipant(req.params.id, req.user.sub))) {
      return res.status(403).json({ error: "Vous ne participez pas à cette conversation" });
    }
    const params = [req.params.id];
    let clause = "";
    if (req.query.avant) { params.push(req.query.avant); clause = "AND m.cree_le < $2"; }
    const { rows } = await pool.query(
      `SELECT m.id, m.contenu, m.cree_le, m.auteur_id, u.prenom || ' ' || u.nom AS auteur
       FROM messages m JOIN utilisateurs u ON u.id = m.auteur_id
       WHERE m.conversation_id = $1 ${clause}
       ORDER BY m.cree_le DESC LIMIT 50`,
      params
    );
    res.json(rows.reverse());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/messagerie/conversations/:id/messages  { contenu }
router.post("/conversations/:id/messages", requirePermission("messagerie.envoyer_message"), async (req, res) => {
  const contenu = (req.body?.contenu || "").trim();
  if (!contenu) return res.status(400).json({ error: "contenu requis" });
  try {
    if (!(await estParticipant(req.params.id, req.user.sub))) {
      return res.status(403).json({ error: "Vous ne participez pas à cette conversation" });
    }
    const { rows } = await pool.query(
      `INSERT INTO messages (conversation_id, auteur_id, contenu) VALUES ($1,$2,$3)
       RETURNING id, contenu, cree_le, auteur_id`,
      [req.params.id, req.user.sub, contenu]
    );
    const message = { ...rows[0], auteur: req.user.nom, conversation_id: req.params.id };

    const participants = await pool.query(
      "SELECT utilisateur_id FROM conversation_participants WHERE conversation_id = $1",
      [req.params.id]
    );
    const destinataireIds = participants.rows.map((r) => r.utilisateur_id);
    await bus.publier(pool, destinataireIds, { type: "message", message });

    res.status(201).json(message);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/messagerie/conversations/:id/lu
router.post("/conversations/:id/lu", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE conversation_participants SET dernier_lu_le = now()
       WHERE conversation_id = $1 AND utilisateur_id = $2 RETURNING dernier_lu_le`,
      [req.params.id, req.user.sub]
    );
    if (!rows[0]) return res.status(403).json({ error: "Vous ne participez pas à cette conversation" });

    // Accusé de lecture (13/09/2026) : diffuse aux AUTRES participants pour
    // qu'ils voient « Lu » se mettre à jour en direct sur leurs propres
    // messages, sans avoir à rouvrir la conversation. Aucune nouvelle table
    // — dernier_lu_le est déjà la source de vérité, seulement rediffusée.
    const autres = await pool.query(
      "SELECT utilisateur_id FROM conversation_participants WHERE conversation_id = $1 AND utilisateur_id <> $2",
      [req.params.id, req.user.sub]
    );
    await bus.publier(pool, autres.rows.map((r) => r.utilisateur_id), {
      type: "lu", conversation_id: req.params.id, utilisateur_id: req.user.sub, lu_le: rows[0].dernier_lu_le,
    });

    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/messagerie/conversations/:id/lecture — état de lecture des
// AUTRES participants (13/09/2026, accusé de lecture), lu une fois à
// l'ouverture d'une conversation puis tenu à jour côté client via
// l'événement "lu" diffusé ci-dessus. Distinct de la liste des messages
// pour ne pas casser la forme de réponse existante de /messages.
router.get("/conversations/:id/lecture", async (req, res) => {
  try {
    if (!(await estParticipant(req.params.id, req.user.sub))) {
      return res.status(403).json({ error: "Vous ne participez pas à cette conversation" });
    }
    const { rows } = await pool.query(
      `SELECT cp.utilisateur_id, cp.dernier_lu_le
       FROM conversation_participants cp
       WHERE cp.conversation_id = $1 AND cp.utilisateur_id <> $2`,
      [req.params.id, req.user.sub]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/messagerie/conversations/:id/frappe — indicateur de frappe
// (13/09/2026, « X est en train d'écrire… »). Événement éphémère, jamais
// persisté (contrairement à un message) : réutilise simplement la même
// diffusion LISTEN/NOTIFY/SSE. Le client limite lui-même l'envoi (au plus
// une fois toutes les ~3s pendant la saisie), et l'affichage s'éteint tout
// seul côté récepteur après quelques secondes sans nouvel événement — pas
// besoin d'un événement "a arrêté d'écrire" fiable, cassé si l'onglet se
// ferme brutalement.
router.post("/conversations/:id/frappe", async (req, res) => {
  try {
    if (!(await estParticipant(req.params.id, req.user.sub))) {
      return res.status(403).json({ error: "Vous ne participez pas à cette conversation" });
    }
    const autres = await pool.query(
      "SELECT utilisateur_id FROM conversation_participants WHERE conversation_id = $1 AND utilisateur_id <> $2",
      [req.params.id, req.user.sub]
    );
    await bus.publier(pool, autres.rows.map((r) => r.utilisateur_id), {
      type: "frappe", conversation_id: req.params.id, auteur_id: req.user.sub, auteur: req.user.nom,
    });
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/messagerie/stream — flux SSE. EventSource ne pouvant pas poser
// d'en-tête Authorization, le jeton est accepté en paramètre de requête et
// vérifié manuellement (même secret que le middleware authenticate normal).
// Monté SANS le middleware authenticate standard — voir server.js.
router.get("/stream", (req, res) => {
  let utilisateur;
  try {
    utilisateur = jwt.verify(req.query.token, SECRET);
  } catch (e) {
    return res.status(401).json({ error: "Jeton invalide ou expiré" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connecte\n\n");

  bus.abonner(utilisateur.sub, res);

  // Présence (13/09/2026) : upsert immédiat à la connexion, puis à chaque
  // ping (réutilise le timer existant, pas de nouveau). « En ligne » est
  // calculé à la lecture (utilisateurs.js) à partir de cette seule colonne.
  const marquerPresent = () => {
    pool
      .query(
        `INSERT INTO presence_utilisateurs (utilisateur_id, derniere_activite) VALUES ($1, now())
         ON CONFLICT (utilisateur_id) DO UPDATE SET derniere_activite = now()`,
        [utilisateur.sub]
      )
      .catch((e) => console.error("Présence : échec de mise à jour :", e.message));
  };
  marquerPresent();

  // Ping toutes les 25s pour garder la connexion active à travers d'éventuels
  // proxys intermédiaires (Cloud Run inclus).
  const ping = setInterval(() => {
    res.write(": ping\n\n");
    marquerPresent();
  }, 25000);

  req.on("close", () => {
    clearInterval(ping);
    bus.desabonner(utilisateur.sub, res);
    // Déconnexion propre : hors ligne tout de suite plutôt que d'attendre
    // l'expiration de 45s — seule une coupure sale (crash, réseau) passe
    // par le délai d'expiration calculé côté lecture.
    pool.query("DELETE FROM presence_utilisateurs WHERE utilisateur_id = $1", [utilisateur.sub])
      .catch((e) => console.error("Présence : échec de suppression :", e.message));
  });
});

module.exports = router;
