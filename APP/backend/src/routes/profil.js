// JURIA — Profil personnel : consultation de ses propres informations et
// changement de son mot de passe. Accessible à tout utilisateur authentifié
// (contrairement à /api/acces, réservé associé/admin).
const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db");
const { logAudit } = require("../audit");
const router = express.Router();

// GET /api/profil — inclut la liste des action_code autorisés pour le rôle
// de l'appelant (permissions.autorise=TRUE), pour que le frontend puisse
// masquer les sections/menus auxquels il n'a pas droit sans avoir à deviner
// ou à essayer un appel pour voir s'il échoue.
//
// Délégations d'accès (09/10/2026) : en plus du rôle, une action précise
// peut aussi venir d'une délégation active et ciblée (delegations_acces.
// action_code), même logique que estAutorise() côté middleware — sinon
// l'API accepterait la requête (via requirePermission) mais le menu/bouton
// resterait masqué côté écran faute de figurer dans cette liste.
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, code, prenom, nom, email, role, pole, titre_avocat FROM utilisateurs WHERE id = $1",
      [req.user.sub]
    );
    if (!rows[0]) return res.status(404).json({ error: "Utilisateur introuvable" });
    const perms = await pool.query(
      `SELECT action_code FROM permissions_role WHERE role = $1 AND autorise = TRUE
       UNION
       SELECT action_code FROM delegations_acces
       WHERE utilisateur_id = $2 AND action_code IS NOT NULL AND actif = TRUE
         AND date_debut <= current_date
         AND (portee = 'permanent' OR date_fin IS NULL OR date_fin >= current_date)`,
      [req.user.role, req.user.sub]
    );
    res.json({ ...rows[0], permissions: perms.rows.map((r) => r.action_code) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /api/profil  { titre_avocat } — titre porté dans la signature des actes
// (« Avocat au Barreau du Mali et de Paris »), saisi par chacun pour lui-même.
router.put("/", async (req, res) => {
  const titre = typeof req.body?.titre_avocat === "string" ? req.body.titre_avocat.trim() : null;
  if (titre === null) return res.status(400).json({ error: "titre_avocat requis" });
  if (titre.length > 200) return res.status(400).json({ error: "titre_avocat : 200 caractères maximum" });
  try {
    const { rows } = await pool.query(
      "UPDATE utilisateurs SET titre_avocat = NULLIF($1::text,'') WHERE id = $2 RETURNING titre_avocat",
      [titre, req.user.sub]
    );
    if (!rows[0]) return res.status(404).json({ error: "Utilisateur introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /api/profil/mot-de-passe  { ancien_mot_de_passe, nouveau_mot_de_passe }
router.put("/mot-de-passe", async (req, res) => {
  const { ancien_mot_de_passe, nouveau_mot_de_passe } = req.body || {};
  if (!ancien_mot_de_passe || !nouveau_mot_de_passe) {
    return res.status(400).json({ error: "ancien_mot_de_passe et nouveau_mot_de_passe requis" });
  }
  if (nouveau_mot_de_passe.length < 8) {
    return res.status(400).json({ error: "Le nouveau mot de passe doit contenir au moins 8 caractères" });
  }
  if (nouveau_mot_de_passe === ancien_mot_de_passe) {
    return res.status(400).json({ error: "Le nouveau mot de passe doit être différent de l'ancien" });
  }
  try {
    const { rows } = await pool.query("SELECT mot_de_passe FROM utilisateurs WHERE id = $1", [req.user.sub]);
    if (!rows[0]) return res.status(404).json({ error: "Utilisateur introuvable" });

    const ok = await bcrypt.compare(ancien_mot_de_passe, rows[0].mot_de_passe);
    if (!ok) return res.status(401).json({ error: "Mot de passe actuel incorrect" });

    const hash = await bcrypt.hash(nouveau_mot_de_passe, 10);
    await pool.query("UPDATE utilisateurs SET mot_de_passe = $1 WHERE id = $2", [hash, req.user.sub]);

    await logAudit({ utilisateurId: req.user.sub, action: "changer_mot_de_passe", entite: "utilisateurs", entiteId: req.user.sub, ip: req.ip });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
