// JURIA — routes d'authentification
const express = require("express");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { pool } = require("../db");
const { SECRET } = require("../auth");
const { logAudit } = require("../audit");
const { envoyerEmail } = require("../mailer");

const router = express.Router();

// Anti-bourrage d'identifiants : 10 tentatives / 15 min / IP sur la connexion.
const limiteurLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives de connexion. Réessayez dans quelques minutes." },
});

// POST /auth/login  { email, mot_de_passe }
router.post("/login", limiteurLogin, async (req, res) => {
  const { email, mot_de_passe } = req.body || {};
  if (!email || !mot_de_passe) {
    return res.status(400).json({ error: "Email et mot de passe requis" });
  }
  try {
    const { rows } = await pool.query(
      "SELECT id, prenom, nom, role, mot_de_passe, actif FROM utilisateurs WHERE email = $1",
      [email]
    );
    const u = rows[0];
    if (!u || !u.actif) return res.status(401).json({ error: "Identifiants invalides" });

    const ok = await bcrypt.compare(mot_de_passe, u.mot_de_passe);
    if (!ok) return res.status(401).json({ error: "Identifiants invalides" });

    const token = jwt.sign(
      { sub: u.id, role: u.role, nom: `${u.prenom} ${u.nom}` },
      SECRET,
      { expiresIn: "8h" }
    );
    pool.query("UPDATE utilisateurs SET derniere_connexion = now() WHERE id = $1", [u.id]).catch(() => {});
    logAudit({ utilisateurId: u.id, action: "login", entite: "utilisateurs", entiteId: u.id, ip: req.ip });
    res.json({ token, utilisateur: { id: u.id, nom: `${u.prenom} ${u.nom}`, role: u.role } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Réinitialisation de mot de passe en libre-service (31/08/2026) — comble
// le gap documenté depuis le 17/08/2026 : jusqu'ici un utilisateur qui
// oublie son mot de passe devait obligatoirement demander à un
// associé/admin de le réinitialiser à la main. Même limiteur de débit que
// /login (anti-abus — empêche de spammer un e-mail de demandes).
// skip en NODE_ENV=test : un parcours de test légitime (demande, jeton,
// réinitialisation, restauration du mot de passe pour ne pas casser les
// autres suites) dépasse vite 10 appels sur les deux routes combinées dans
// un même fichier — même principe que le garde NODE_ENV=test déjà utilisé
// pour messagerie-bus.js (LISTEN sauté en test).
const limiteurReinit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  message: { error: "Trop de tentatives. Réessayez dans quelques minutes." },
});

const DUREE_VALIDITE_JETON_MS = 60 * 60 * 1000; // 1h

function hacherJeton(jeton) {
  return crypto.createHash("sha256").update(jeton).digest("hex");
}

// POST /auth/mot-de-passe-oublie  { email }
// Réponse volontairement identique que l'e-mail corresponde ou non à un
// compte réel (anti-énumération de comptes) — seule la présence effective
// d'un compte déclenche l'envoi. Le lien part exclusivement vers l'adresse
// déjà enregistrée pour ce compte : aucun champ ne permet d'en indiquer une
// autre.
router.post("/mot-de-passe-oublie", limiteurReinit, async (req, res) => {
  const { email } = req.body || {};
  const messageGenerique = { message: "Si un compte existe avec cette adresse, un lien de réinitialisation a été envoyé." };
  if (!email) return res.status(400).json({ error: "Email requis" });
  try {
    const { rows } = await pool.query(
      "SELECT id, prenom, nom, email FROM utilisateurs WHERE email = $1 AND actif = TRUE",
      [email]
    );
    const u = rows[0];
    if (!u) return res.json(messageGenerique); // compte inexistant/inactif : même réponse, pas d'envoi

    const jeton = crypto.randomBytes(32).toString("hex");
    await pool.query(
      `INSERT INTO reinitialisations_mot_de_passe (utilisateur_id, jeton_hash, expire_le, demande_ip)
       VALUES ($1,$2, now() + interval '1 hour', $3)`,
      [u.id, hacherJeton(jeton), req.ip]
    );

    const lienBase = process.env.FRONTEND_URL || "https://juria-web-552099340909.europe-west1.run.app";
    const lien = `${lienBase}/reinitialiser-mot-de-passe?token=${jeton}`;
    await envoyerEmail({
      to: u.email,
      subject: "JURIA — Réinitialisation de votre mot de passe",
      html: `<p>Bonjour ${u.prenom},</p>
        <p>Une demande de réinitialisation de mot de passe a été effectuée pour votre compte JURIA.</p>
        <p><a href="${lien}">Cliquez ici pour choisir un nouveau mot de passe</a> (lien valable 1 heure, à usage unique).</p>
        <p>Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail — votre mot de passe actuel reste inchangé.</p>`,
    });
    logAudit({ utilisateurId: u.id, action: "mot_de_passe_oublie_demande", entite: "utilisateurs", entiteId: u.id, ip: req.ip });
    res.json(messageGenerique);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /auth/reinitialiser-mot-de-passe  { token, nouveau_mot_de_passe }
// Jeton à usage unique (WHERE utilise_le IS NULL, même patron anti-double-
// déclenchement que le reste du projet) : une deuxième tentative avec le
// même jeton échoue explicitement plutôt que d'écraser silencieusement.
router.post("/reinitialiser-mot-de-passe", limiteurReinit, async (req, res) => {
  const { token, nouveau_mot_de_passe } = req.body || {};
  if (!token || !nouveau_mot_de_passe) {
    return res.status(400).json({ error: "token et nouveau_mot_de_passe requis" });
  }
  if (nouveau_mot_de_passe.length < 8) {
    return res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caractères" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, utilisateur_id FROM reinitialisations_mot_de_passe
       WHERE jeton_hash = $1 AND expire_le > now() AND utilise_le IS NULL`,
      [hacherJeton(token)]
    );
    const r = rows[0];
    if (!r) return res.status(400).json({ error: "Lien invalide, expiré ou déjà utilisé." });

    const hash = await bcrypt.hash(nouveau_mot_de_passe, 10);
    await pool.query("UPDATE utilisateurs SET mot_de_passe = $1 WHERE id = $2", [hash, r.utilisateur_id]);
    await pool.query(
      "UPDATE reinitialisations_mot_de_passe SET utilise_le = now() WHERE id = $1 AND utilise_le IS NULL",
      [r.id]
    );
    logAudit({ utilisateurId: r.utilisateur_id, action: "mot_de_passe_reinitialise", entite: "utilisateurs", entiteId: r.utilisateur_id, ip: req.ip });
    res.json({ message: "Mot de passe réinitialisé. Vous pouvez vous connecter." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
