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
const { CATALOGUE, CODES_VALIDES } = require("../permissions");

const router = express.Router();
// Gestion des comptes/rôles/délégations : associé, administrateur général
// ou administrateur IT. La matrice de permissions ci-dessous (routes
// /permissions) applique une restriction plus étroite encore, volontairement
// écartée de cette garde commune — voir plus bas.
//
// associe_fondateur volontairement EXCLU (29/08/2026, correction explicite
// de l'utilisateur) : contrairement à la décision initiale du 17/08/2026
// (mêmes droits qu'associe SAUF la matrice), le module Accès & permissions
// dans son ensemble — comptes, délégations, journal d'audit — lui est
// désormais fermé, pas seulement la matrice.
router.use(requireRole("associe", "admin_general", "admin_it"));

// 13 statuts réels du cabinet (17/08/2026, complété après coup avec
// associe_fondateur et la distinction avocat_stagiaire/stagiaire) — voir
// CLAUDE.md pour le détail de chacun.
const ROLES_VALIDES = [
  "associe", "associe_fondateur", "of_counsel", "collaborateur",
  "avocat_stagiaire", "stagiaire", "juriste",
  "admin_general", "assistante", "comptable", "assistant_comptable",
  "admin_it", "archiviste",
];

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

// PUT /api/acces/utilisateurs/:id  { code?, prenom?, nom?, email?, pole? }
// Corrige la fiche d'un compte existant (ex. e-mail erroné à la création) —
// jamais le rôle (route dédiée ci-dessous) ni le mot de passe (routes
// dédiées plus haut). Un champ omis garde sa valeur actuelle (COALESCE,
// même patron que dossiers.js/clients.js).
router.put("/utilisateurs/:id", async (req, res) => {
  const b = req.body || {};
  if (!b.code && !b.prenom && !b.nom && !b.email && !b.pole) {
    return res.status(400).json({ error: "Au moins un champ à modifier (code, prenom, nom, email, pole)" });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE utilisateurs SET
         code = COALESCE($1, code), prenom = COALESCE($2, prenom),
         nom = COALESCE($3, nom), email = COALESCE($4, email),
         pole = COALESCE($5::pole_cabinet, pole)
       WHERE id = $6
       RETURNING id, code, prenom, nom, email, role, pole`,
      [b.code || null, b.prenom || null, b.nom || null, b.email || null, b.pole || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Compte introuvable" });
    await logAudit({
      utilisateurId: req.user.sub, action: "modifier_compte", entite: "utilisateurs",
      entiteId: req.params.id, details: b, ip: req.ip,
    });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
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

// Matrice de permissions : restreinte à Associé + Administrateur IT
// uniquement — l'associé-fondateur a les mêmes droits qu'un associé
// classique PARTOUT AILLEURS dans ce module, mais est explicitement exclu
// de la matrice elle-même (précision de l'utilisateur, 17/08/2026). Les
// deux middlewares s'appliquent en ET : même si le garde commun ci-dessus
// laisse passer associe_fondateur/admin_general, celui-ci les rejette
// spécifiquement sur ces deux routes.
const requireAssocieOuAdminIt = requireRole("associe", "admin_it");

// GET /api/acces/permissions — catalogue complet croisé avec les valeurs
// actuelles (une case sans ligne en base est retournée à false : aucun accès
// implicite, cohérent avec requirePermission()).
router.get("/permissions", requireAssocieOuAdminIt, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT role, action_code, autorise FROM permissions_role");
    const valeurs = {};
    for (const r of rows) valeurs[`${r.role}::${r.action_code}`] = r.autorise;
    res.json({
      catalogue: CATALOGUE,
      roles: ROLES_VALIDES,
      valeurs, // clé "role::action_code" -> booléen ; absente = false
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /api/acces/permissions  { role, action_code, autorise }
router.put("/permissions", requireAssocieOuAdminIt, async (req, res) => {
  const { role, action_code, autorise } = req.body || {};
  if (!ROLES_VALIDES.includes(role)) return res.status(400).json({ error: "Rôle invalide" });
  if (!CODES_VALIDES.has(action_code)) return res.status(400).json({ error: "Action inconnue" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO permissions_role (role, action_code, autorise, maj_par, maj_le)
       VALUES ($1::role_utilisateur,$2,$3,$4,now())
       ON CONFLICT (role, action_code) DO UPDATE SET autorise = EXCLUDED.autorise, maj_par = EXCLUDED.maj_par, maj_le = now()
       RETURNING role, action_code, autorise`,
      [role, action_code, !!autorise, req.user.sub]
    );
    await logAudit({
      utilisateurId: req.user.sub, action: "maj_permission", entite: "permissions_role",
      entiteId: null, details: { role, action_code, autorise: !!autorise }, ip: req.ip,
    });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
