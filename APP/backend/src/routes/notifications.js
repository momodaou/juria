// JURIA — centre de notifications : lecture de MES notifications uniquement (chacun ne voit jamais que les siennes).
// Montée avec authenticate dans server.js. Voir src/notifications.js pour la création.
const express = require("express");
const { pool } = require("../db");
const { presenter } = require("../notifications");
const bus = require("../messagerie-bus");
const prefs = require("../preferencesNotifications");

const router = express.Router();

// GET /api/notifications?filtre=tout|non_lues|a_traiter&niveau=critique&limite=30&avant=<iso>
router.get("/", async (req, res) => {
  const filtre = ["tout", "non_lues", "a_traiter"].includes(req.query.filtre) ? req.query.filtre : "tout";
  const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 30, 1), 100);
  const niveau = ["information", "action", "critique"].includes(req.query.niveau) ? req.query.niveau : null;
  const avant = req.query.avant && !Number.isNaN(Date.parse(req.query.avant)) ? req.query.avant : null;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM notifications
       WHERE destinataire_id = $1
         AND ($2 = 'tout' OR ($2 = 'non_lues' AND lue_le IS NULL) OR ($2 = 'a_traiter' AND a_traiter AND traitee_le IS NULL))
         AND ($3::timestamptz IS NULL OR cree_le < $3::timestamptz)
         AND ($5::varchar IS NULL OR niveau = $5::varchar)
       ORDER BY cree_le DESC LIMIT $4`, [req.user.sub, filtre, avant, limite, niveau]);
    res.json(rows.map(presenter));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/notifications/compteur — pastille de la cloche
router.get("/compteur", async (req, res) => {
  try {
    const { rows: [r] } = await pool.query(
      `SELECT count(*) FILTER (WHERE lue_le IS NULL)::int AS non_lues,
              count(*) FILTER (WHERE a_traiter AND traitee_le IS NULL)::int AS a_traiter
       FROM notifications WHERE destinataire_id = $1`, [req.user.sub]);
    res.json(r);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET/PUT /api/notifications/preferences — MES réglages d'e-mail (jamais ceux d'un autre). Ils ne portent que sur l'e-mail en plus :
// la cloche, le bandeau des urgences et la bulle du navigateur ne se coupent pas. Un champ verrouillé reste vrai quoi qu'on envoie.
async function reponsePrefs(user) {
  const { rows: [l] } = await pool.query("SELECT * FROM preferences_notifications WHERE utilisateur_id = $1", [user.sub]);
  const { rows: [g] } = await pool.query("SELECT notifications_email_actif AS actif FROM parametres_cabinet WHERE id = 1");
  return { valeurs: prefs.effectif(user.role, l), verrouille: prefs.verrouille(user.role), emails_actifs_cabinet: !!(g && g.actif) };
}
router.get("/preferences", async (req, res) => {
  try { res.json(await reponsePrefs(req.user)); }
  catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});
router.put("/preferences", async (req, res) => {
  try {
    await prefs.enregistrer(req.user.sub, req.user.role, req.body || {});
    res.json(await reponsePrefs(req.user));
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/notifications/tout-lire
router.post("/tout-lire", async (req, res) => {
  try {
    const r = await pool.query("UPDATE notifications SET lue_le = now() WHERE destinataire_id = $1 AND lue_le IS NULL", [req.user.sub]);
    res.json({ marquees: r.rowCount });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/notifications/:id/lue — uniquement une notification qui est la mienne
router.post("/:id/lue", async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: "Identifiant invalide" });
  try {
    const r = await pool.query(
      "UPDATE notifications SET lue_le = COALESCE(lue_le, now()) WHERE id = $1 AND destinataire_id = $2 RETURNING id", [req.params.id, req.user.sub]);
    if (!r.rows[0]) return res.status(404).json({ error: "Notification introuvable" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/notifications/:id/traitee — « Marquer comme traitée » : seulement une notification d'ACTION qui est la mienne
// (jamais le niveau critique, qui se ferme seul quand la situation est réglée ; pas d'« Ignorer »).
router.post("/:id/traitee", async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: "Identifiant invalide" });
  try {
    const { rows: [n] } = await pool.query("SELECT niveau, a_traiter, traitee_le FROM notifications WHERE id = $1 AND destinataire_id = $2", [req.params.id, req.user.sub]);
    if (!n) return res.status(404).json({ error: "Notification introuvable" });
    if (n.niveau !== "action") return res.status(409).json({ error: "Seule une notification d'action peut être marquée comme traitée." });
    await pool.query("UPDATE notifications SET traitee_le = COALESCE(traitee_le, now()), lue_le = COALESCE(lue_le, now()) WHERE id = $1", [req.params.id]);
    await bus.publier(pool, [req.user.sub], { type: "notification_traitee", id: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
