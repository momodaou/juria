// JURIA — Contrôle des conflits d'intérêts (phase obligatoire avant ouverture)
const express = require("express");
const { pool } = require("../db");
const { requireRole } = require("../auth");
const router = express.Router();

// POST /api/conflict-checks
// body : { intitule_projet, noms: "SODIMA, Bâtir-SA, ..." }
// Recherche client + partie adverse dans toute la base, enregistre le contrôle,
// et renvoie le résultat (absence / potentiel).
router.post("/", async (req, res) => {
  const b = req.body || {};
  const termes = String(b.noms || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (termes.length === 0) return res.status(400).json({ error: "Aucun nom fourni" });
  try {
    const details = [];
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
        details.push({ terme: t, correspondances: [...cli.rows, ...par.rows] });
      }
    }
    const resultat = details.length ? "potentiel" : "absence";

    const ins = await pool.query(
      `INSERT INTO conflict_checks (intitule_projet, noms_recherches, resultat, details, decision, cree_par)
       VALUES ($1,$2,$3,$4,'en_attente',$5)
       RETURNING id, resultat, decision`,
      [b.intitule_projet || null, termes.join(", "), resultat, JSON.stringify(details), req.user.sub]
    );

    res.status(201).json({
      id: ins.rows[0].id,
      resultat,
      decision: ins.rows[0].decision,
      details,
      message: resultat === "potentiel"
        ? "Rapprochement(s) trouvé(s) : décision d'un associé requise avant ouverture."
        : "Aucun conflit détecté : l'ouverture peut se poursuivre.",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/conflict-checks/:id/decision  (réservé aux associés)
// body : { decision: 'accepte'|'refuse'|'oriente', motif }
router.post("/:id/decision", requireRole("associe", "admin"), async (req, res) => {
  const { decision, motif } = req.body || {};
  const permis = ["accepte", "refuse", "oriente"];
  if (!permis.includes(decision)) return res.status(400).json({ error: "Décision invalide" });
  try {
    const { rows } = await pool.query(
      `UPDATE conflict_checks
       SET decision = $1, motif = $2, decide_par = $3, decide_le = now()
       WHERE id = $4
       RETURNING id, decision, motif`,
      [decision, motif || null, req.user.sub, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Contrôle introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
