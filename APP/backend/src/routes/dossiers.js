// JURIA — routes Dossiers
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const router = express.Router();

// GET /api/dossiers?statut=&responsable=&q=
router.get("/", async (req, res) => {
  const { statut, responsable, q } = req.query;
  const cond = [];
  const params = [];
  if (statut) { params.push(statut); cond.push(`d.statut = $${params.length}`); }
  if (responsable) { params.push(responsable); cond.push(`d.responsable_id = $${params.length}`); }
  if (q) { params.push(`%${q}%`); cond.push(`(d.intitule ILIKE $${params.length} OR d.numero ILIKE $${params.length})`); }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.numero, d.intitule, d.statut, d.phase, d.urgence,
              COALESCE(c.denomination, c.prenom || ' ' || c.nom) AS client,
              u.prenom || ' ' || u.nom AS responsable
       FROM dossiers d
       JOIN clients c ON c.id = d.client_id
       JOIN utilisateurs u ON u.id = d.responsable_id
       ${where}
       ORDER BY d.maj_le DESC
       LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/dossiers/:id  -> dossier enrichi (client, responsable, parties, équipe)
router.get("/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const d = await pool.query(
      `SELECT d.*,
              COALESCE(c.denomination, c.prenom || ' ' || c.nom) AS client_nom,
              u.prenom || ' ' || u.nom AS responsable_nom
       FROM dossiers d
       JOIN clients c ON c.id = d.client_id
       JOIN utilisateurs u ON u.id = d.responsable_id
       WHERE d.id = $1`,
      [id]
    );
    if (!d.rows[0]) return res.status(404).json({ error: "Dossier introuvable" });

    const parties = await pool.query(
      "SELECT id, role, denomination, conseil FROM dossier_parties WHERE dossier_id = $1",
      [id]
    );
    const equipe = await pool.query(
      `SELECT u.prenom || ' ' || u.nom AS nom, di.role_dossier
       FROM dossier_intervenants di JOIN utilisateurs u ON u.id = di.utilisateur_id
       WHERE di.dossier_id = $1`,
      [id]
    );
    res.json({ ...d.rows[0], parties: parties.rows, equipe: equipe.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/dossiers/:id/evenements  -> délais & audiences du dossier
router.get("/:id/evenements", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, titre, date_echeance, statut,
              (date_echeance::date - current_date) AS jours_restants
       FROM evenements WHERE dossier_id = $1 ORDER BY date_echeance`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/dossiers/:id/documents  -> pièces (GED) du dossier
router.get("/:id/documents", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nom, categorie, version, statut, confidentialite, cree_le
       FROM documents WHERE dossier_id = $1 ORDER BY cree_le DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/dossiers
router.post("/", requirePermission("dossiers.creer"), async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await pool.query(
      `INSERT INTO dossiers
         (numero, intitule, client_id, pole, matiere, juridiction,
          montant_litige, mode_honoraires, urgence, responsable_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::urgence_niveau,'moyenne'),$10)
       RETURNING id, numero, intitule`,
      [b.numero, b.intitule, b.client_id, b.pole, b.matiere, b.juridiction,
       b.montant_litige, b.mode_honoraires, b.urgence, b.responsable_id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
