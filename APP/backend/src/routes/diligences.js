// JURIA — Diligences (planning des rendez-vous/démarches de terrain :
// audition en juridiction, enquête, formalité, expertise…) — gap comblé le
// 11/09/2026. La table et son catalogue listes_valeurs('type_diligence')
// existaient depuis le tout premier schéma, mais seul le déclencheur
// automatique de courriers.js y écrivait (POST courrier de type
// "convocation" sur un dossier) — aucune route pour les consulter,
// en créer une à la main, ou faire évoluer leur statut. Trouvé en
// répondant à une question de l'utilisateur sur l'interconnexion entre
// Registre du courrier, Rôle d'audience et les dossiers.
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const { logAudit } = require("../audit");
const router = express.Router();

// GET /api/diligences?dossier_id=&statut=  — même permission de
// consultation que le reste du module Rôle d'audience.
router.get("/", requirePermission("audiences.consulter"), async (req, res) => {
  const { dossier_id, statut } = req.query;
  const params = [];
  const clauses = [];
  if (dossier_id) { params.push(dossier_id); clauses.push(`dl.dossier_id = $${params.length}`); }
  if (statut) { params.push(statut); clauses.push(`dl.statut = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT dl.id, dl.type_diligence, dl.type_precision, dl.dossier_id,
              d.numero AS dossier_numero, d.intitule AS dossier_intitule, d.responsable_id AS dossier_responsable_id,
              dl.membre_id, u.prenom || ' ' || u.nom AS membre_nom,
              dl.date_diligence, dl.heure, dl.lieu, dl.objet, dl.statut,
              dl.observations, dl.courrier_id,
              dl.cree_par, cp.prenom || ' ' || cp.nom AS cree_par_nom
       FROM diligences dl
       LEFT JOIN dossiers d ON d.id = dl.dossier_id
       LEFT JOIN utilisateurs u ON u.id = dl.membre_id
       LEFT JOIN utilisateurs cp ON cp.id = dl.cree_par
       ${where}
       ORDER BY dl.date_diligence, dl.heure NULLS LAST
       LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/diligences/verifier-doublon?dossier_id=&date_diligence=&type_diligence=
// (26/09/2026, audit doublons) — signale, sans jamais bloquer, une diligence
// déjà programmée le même jour pour le même dossier et le même type.
router.get("/verifier-doublon", requirePermission("audiences.diligence.gerer"), async (req, res) => {
  const { dossier_id, date_diligence, type_diligence } = req.query;
  if (!date_diligence) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT dl.id, dl.type_diligence, dl.objet, dl.heure
       FROM diligences dl
       WHERE dl.date_diligence = $1
         AND ($2::uuid IS NULL OR dl.dossier_id = $2)
         AND ($3::varchar IS NULL OR dl.type_diligence = $3)`,
      [date_diligence, dossier_id || null, type_diligence || null]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/diligences
// { type_diligence?, type_precision?, dossier_id?, membre_id?, date_diligence,
//   heure?, lieu?, objet?, observations? } — dossier_id optionnel : une
// diligence peut exister sans dossier précis (ex. formalité générale de
// greffe), contrairement aux audiences du rôle hebdomadaire.
router.post("/", requirePermission("audiences.diligence.gerer"), async (req, res) => {
  const b = req.body || {};
  if (!b.date_diligence) return res.status(400).json({ error: "date_diligence requis" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO diligences
         (type_diligence, type_precision, dossier_id, membre_id, date_diligence, heure, lieu, objet, observations, cree_par)
       VALUES (COALESCE($1,'diligence'),$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, type_diligence, date_diligence, statut, dossier_id, membre_id`,
      [b.type_diligence || null, b.type_precision || null, b.dossier_id || null, b.membre_id || null,
       b.date_diligence, b.heure || null, b.lieu || null, b.objet || null, b.observations || null, req.user.sub]
    );
    // 10/10/2026 — Bloc A du diagnostic "instruction avocat -> collaborateur"
    // (voir CLAUDE.md) : les diligences n'étaient tracées nulle part dans
    // journal_audit, contrairement aux audiences.
    await logAudit({
      utilisateurId: req.user.sub, action: "creer_diligence", entite: "diligences", entiteId: rows[0].id,
      details: { dossier_id: rows[0].dossier_id, membre_id: rows[0].membre_id, objet: b.objet || null },
      ip: req.ip,
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/diligences/:id/statut  { statut: 'fait'|'reporte'|'annule'|'a_faire', observations? }
// 10/10/2026 — Bloc A du diagnostic "instruction avocat -> collaborateur"
// (voir CLAUDE.md) : cette route était gardée par la seule permission
// générique `audiences.diligence.gerer` — ouverte à TOUS les rôles sans
// exception — donc n'importe qui pouvait clôturer la diligence de
// n'importe qui d'autre. Restreint désormais au membre assigné, au
// créateur, ou au responsable du dossier concerné. `observations` (déjà en
// base, jamais exposée) sert de compte-rendu écrit au moment de la
// clôture — remplace la valeur existante si fournie, jamais effacée sinon.
router.put("/:id/statut", requirePermission("audiences.diligence.gerer"), async (req, res) => {
  const { statut, observations } = req.body || {};
  if (!["fait", "reporte", "annule", "a_faire"].includes(statut)) {
    return res.status(400).json({ error: "Statut invalide" });
  }
  try {
    const { rows: [actuelle] } = await pool.query(
      `SELECT dl.membre_id, dl.cree_par, dl.statut, dl.dossier_id, d.responsable_id AS dossier_responsable_id
       FROM diligences dl LEFT JOIN dossiers d ON d.id = dl.dossier_id
       WHERE dl.id = $1`,
      [req.params.id]
    );
    if (!actuelle) return res.status(404).json({ error: "Diligence introuvable" });
    const autorise = actuelle.membre_id === req.user.sub
      || actuelle.cree_par === req.user.sub
      || actuelle.dossier_responsable_id === req.user.sub;
    if (!autorise) {
      return res.status(403).json({
        error: "Seul le membre assigné, le créateur de la diligence ou le responsable du dossier peut faire évoluer son statut.",
      });
    }
    const { rows } = await pool.query(
      "UPDATE diligences SET statut = $1, observations = COALESCE($2, observations) WHERE id = $3 RETURNING id, statut, dossier_id, observations",
      [statut, observations ?? null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Diligence introuvable" });
    if (actuelle.statut !== statut) {
      await logAudit({
        utilisateurId: req.user.sub, action: "modifier_statut_diligence", entite: "diligences", entiteId: req.params.id,
        details: { dossier_id: actuelle.dossier_id, avant: actuelle.statut, apres: statut }, ip: req.ip,
      });
    }
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
