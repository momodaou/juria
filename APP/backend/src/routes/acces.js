// JURIA — Accès & permissions : création de compte + validation à l'entrée,
// évolution des rôles, délégations d'accès temporaires/permanentes,
// consultation du journal d'audit.
// Toutes les routes de ce module sont réservées associé/admin (direction).
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { pool } = require("../db");
const { requireRole } = require("../auth");
const { logAudit } = require("../audit");

const router = express.Router();
router.use(requireRole("associe", "admin"));

const ROLES_VALIDES = ["associe", "collaborateur", "stagiaire", "assistante", "comptable", "admin"];

// Mot de passe temporaire lisible (12 caractères, sans caractères ambigus).
function genererMotDePasseTemporaire() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.randomBytes(12))
    .map((b) => alphabet[b % alphabet.length])
    .join("");
}

// POST /api/acces/utilisateurs  { code, prenom, nom, email, role, pole? }
// Crée le compte INACTIF (en attente de validation) et renvoie un mot de
// passe temporaire — affiché une seule fois dans cette réponse, jamais
// journalisé ni récupérable ensuite. Le compte ne pourra se connecter
// qu'après validation explicite (POST .../valider).
router.post("/utilisateurs", async (req, res) => {
  const b = req.body || {};
  if (!b.code || !b.prenom || !b.nom || !b.email || !ROLES_VALIDES.includes(b.role)) {
    return res.status(400).json({ error: "code, prenom, nom, email et role (valide) requis" });
  }
  const motDePasseTemporaire = genererMotDePasseTemporaire();
  try {
    const hash = await bcrypt.hash(motDePasseTemporaire, 10);
    const { rows } = await pool.query(
      `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, pole, actif)
       VALUES ($1,$2,$3,$4,$5,$6::role_utilisateur,$7,FALSE)
       RETURNING id, code, prenom, nom, email, role`,
      [b.code, b.prenom, b.nom, b.email, hash, b.role, b.pole || null]
    );
    await logAudit({
      utilisateurId: req.user.sub, action: "creer_compte", entite: "utilisateurs",
      entiteId: rows[0].id, details: { role: b.role }, ip: req.ip,
    });
    res.status(201).json({ ...rows[0], mot_de_passe_temporaire: motDePasseTemporaire });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/acces/utilisateurs/:id/valider
// Première activation d'un compte en attente (distincte de la réactivation
// après suspension : renseigne valide_par/valide_le, une seule fois).
router.post("/utilisateurs/:id/valider", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE utilisateurs SET actif = TRUE, valide_par = $1, valide_le = now()
       WHERE id = $2 AND valide_le IS NULL
       RETURNING id, prenom, nom, actif, valide_le`,
      [req.user.sub, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Compte introuvable ou déjà validé" });
    await logAudit({ utilisateurId: req.user.sub, action: "valider_compte", entite: "utilisateurs", entiteId: req.params.id, ip: req.ip });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/acces/utilisateurs/:id/reinitialiser-mot-de-passe
// Génère un nouveau mot de passe temporaire pour un compte existant (mot de
// passe oublié). N'affecte ni le rôle, ni le statut actif/suspendu/en attente
// du compte — seule la connexion redevient possible avec ce nouveau mot de
// passe. Affiché une seule fois, jamais journalisé en clair.
router.post("/utilisateurs/:id/reinitialiser-mot-de-passe", async (req, res) => {
  const motDePasseTemporaire = genererMotDePasseTemporaire();
  try {
    const hash = await bcrypt.hash(motDePasseTemporaire, 10);
    const { rows } = await pool.query(
      `UPDATE utilisateurs SET mot_de_passe = $1 WHERE id = $2 RETURNING id, prenom, nom`,
      [hash, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Compte introuvable" });
    await logAudit({ utilisateurId: req.user.sub, action: "reinitialiser_mot_de_passe", entite: "utilisateurs", entiteId: req.params.id, ip: req.ip });
    res.json({ ...rows[0], mot_de_passe_temporaire: motDePasseTemporaire });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /api/acces/utilisateurs/:id/role  { role }
router.put("/utilisateurs/:id/role", async (req, res) => {
  const { role } = req.body || {};
  if (!ROLES_VALIDES.includes(role)) return res.status(400).json({ error: "Rôle invalide" });
  try {
    const { rows } = await pool.query(
      "UPDATE utilisateurs SET role = $1::role_utilisateur WHERE id = $2 RETURNING id, prenom, nom, role",
      [role, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Utilisateur introuvable" });
    await logAudit({
      utilisateurId: req.user.sub, action: "update_role", entite: "utilisateurs",
      entiteId: req.params.id, details: { nouveau_role: role }, ip: req.ip,
    });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/acces/utilisateurs/:id/actif  { actif }
router.put("/utilisateurs/:id/actif", async (req, res) => {
  const { actif } = req.body || {};
  try {
    const { rows } = await pool.query(
      "UPDATE utilisateurs SET actif = $1 WHERE id = $2 RETURNING id, prenom, nom, actif",
      [!!actif, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Utilisateur introuvable" });
    await logAudit({
      utilisateurId: req.user.sub, action: actif ? "reactiver_compte" : "desactiver_compte",
      entite: "utilisateurs", entiteId: req.params.id, ip: req.ip,
    });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/acces/delegations?utilisateur_id=&actif=
router.get("/delegations", async (req, res) => {
  const { utilisateur_id, actif } = req.query;
  const params = [];
  const clauses = [];
  if (utilisateur_id) { params.push(utilisateur_id); clauses.push(`d.utilisateur_id = $${params.length}`); }
  if (actif !== undefined) { params.push(actif === "true"); clauses.push(`d.actif = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.portee, d.description, d.date_debut, d.date_fin, d.motif, d.actif,
              u.prenom || ' ' || u.nom AS utilisateur,
              a.prenom || ' ' || a.nom AS accorde_par
       FROM delegations_acces d
       JOIN utilisateurs u ON u.id = d.utilisateur_id
       LEFT JOIN utilisateurs a ON a.id = d.accorde_par
       ${where}
       ORDER BY d.date_debut DESC`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/acces/delegations  { utilisateur_id, portee, description, date_debut?, date_fin?, motif? }
router.post("/delegations", async (req, res) => {
  const b = req.body || {};
  if (!b.utilisateur_id || !b.description) return res.status(400).json({ error: "utilisateur_id et description requis" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO delegations_acces (utilisateur_id, accorde_par, portee, description, date_debut, date_fin, motif)
       VALUES ($1,$2,COALESCE($3::portee_delegation,'temporaire'),$4,COALESCE($5,current_date),$6,$7)
       RETURNING id, portee, description, date_debut, date_fin`,
      [b.utilisateur_id, req.user.sub, b.portee, b.description, b.date_debut || null, b.date_fin || null, b.motif || null]
    );
    await logAudit({
      utilisateurId: req.user.sub, action: "accorder_delegation", entite: "delegations_acces",
      entiteId: rows[0].id, details: { utilisateur_id: b.utilisateur_id, description: b.description }, ip: req.ip,
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/acces/delegations/:id/revoquer
router.post("/delegations/:id/revoquer", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE delegations_acces SET actif = FALSE WHERE id = $1 RETURNING id, actif",
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Délégation introuvable" });
    await logAudit({ utilisateurId: req.user.sub, action: "revoquer_delegation", entite: "delegations_acces", entiteId: req.params.id, ip: req.ip });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/acces/audit?utilisateur_id=&entite=&limit=
router.get("/audit", async (req, res) => {
  const { utilisateur_id, entite } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const params = [];
  const clauses = [];
  if (utilisateur_id) { params.push(utilisateur_id); clauses.push(`j.utilisateur_id = $${params.length}`); }
  if (entite) { params.push(entite); clauses.push(`j.entite = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);
  try {
    const { rows } = await pool.query(
      `SELECT j.id, j.action, j.entite, j.entite_id, j.details, j.horodatage,
              u.prenom || ' ' || u.nom AS utilisateur
       FROM journal_audit j
       LEFT JOIN utilisateurs u ON u.id = j.utilisateur_id
       ${where}
       ORDER BY j.horodatage DESC LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
