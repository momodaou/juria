// JURIA — routes Clients & contrôle des conflits d'intérêts
const express = require("express");
const { pool } = require("../db");
const { requireRole } = require("../auth");
const router = express.Router();

// GET /api/clients?q=
router.get("/", async (req, res) => {
  const { q } = req.query;
  const params = [];
  let where = "";
  if (q) { params.push(`%${q}%`); where = `WHERE COALESCE(denomination,'') || ' ' || COALESCE(nom,'') || ' ' || COALESCE(prenom,'') ILIKE $1`; }
  try {
    const { rows } = await pool.query(
      `SELECT id, type, denomination, prenom, nom, rccm, nif, kyc_statut
       FROM clients ${where} ORDER BY maj_le DESC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/clients
router.post("/", async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await pool.query(
      `INSERT INTO clients
         (type, denomination, rccm, nif, forme_juridique, prenom, nom,
          nationalite, email, telephone, adresse, ville, pays, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13,'Mali'),$14)
       RETURNING id, type, denomination, nom`,
      [b.type, b.denomination, b.rccm, b.nif, b.forme_juridique, b.prenom, b.nom,
       b.nationalite, b.email, b.telephone, b.adresse, b.ville, b.pays, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/clients/conflict-check   { noms: "SODIMA, Bâtir-SA, ..." }
// Recherche client + partie adverse dans toute la base (radar conflits).
router.post("/conflict-check", async (req, res) => {
  const noms = (req.body && req.body.noms) || "";
  const termes = String(noms).split(",").map((s) => s.trim()).filter(Boolean);
  if (termes.length === 0) return res.status(400).json({ error: "Aucun nom fourni" });
  try {
    const found = [];
    for (const t of termes) {
      const like = `%${t}%`;
      const cli = await pool.query(
        `SELECT id, 'client' AS source, COALESCE(denomination, prenom || ' ' || nom) AS nom
         FROM clients
         WHERE COALESCE(denomination,'') || ' ' || COALESCE(nom,'') || ' ' || COALESCE(prenom,'') ILIKE $1`,
        [like]
      );
      const par = await pool.query(
        `SELECT dp.id, 'partie_adverse' AS source, dp.denomination AS nom, d.numero AS dossier
         FROM dossier_parties dp JOIN dossiers d ON d.id = dp.dossier_id
         WHERE dp.denomination ILIKE $1`,
        [like]
      );
      if (cli.rows.length || par.rows.length) {
        found.push({ terme: t, correspondances: [...cli.rows, ...par.rows] });
      }
    }
    res.json({
      resultat: found.length ? "potentiel" : "absence",
      details: found,
      message: found.length
        ? "Rapprochement(s) trouvé(s) : décision d'un associé requise avant ouverture."
        : "Aucun conflit détecté.",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
