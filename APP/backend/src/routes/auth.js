// JURIA — routes d'authentification
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const { SECRET } = require("../auth");

const router = express.Router();

// POST /auth/login  { email, mot_de_passe }
router.post("/login", async (req, res) => {
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
    res.json({ token, utilisateur: { id: u.id, nom: `${u.prenom} ${u.nom}`, role: u.role } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
