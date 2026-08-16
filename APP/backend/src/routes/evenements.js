// JURIA — Échéancier : audiences, délais, prescriptions + alertes J-30 → jour J
const express = require("express");
const { pool } = require("../db");
const router = express.Router();

// Détermine le niveau d'alerte à partir du nombre de jours restants.
function niveauAlerte(jours) {
  if (jours < 0) return "depasse";
  if (jours === 0) return "J0";
  if (jours <= 1) return "J-1";
  if (jours <= 7) return "J-7";
  if (jours <= 15) return "J-15";
  if (jours <= 30) return "J-30";
  return "—";
}

// GET /api/evenements  (à venir, tous dossiers) — avec jours restants + niveau d'alerte
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.type, e.titre, e.date_echeance, e.statut, e.dossier_id,
              d.numero AS dossier_numero, d.intitule AS dossier_intitule,
              u.prenom || ' ' || u.nom AS responsable,
              (e.date_echeance::date - current_date) AS jours_restants
       FROM evenements e
       JOIN dossiers d ON d.id = e.dossier_id
       LEFT JOIN utilisateurs u ON u.id = e.responsable_id
       WHERE e.statut = 'a_venir'
       ORDER BY e.date_echeance`
    );
    res.json(rows.map((r) => ({ ...r, alerte: niveauAlerte(Number(r.jours_restants)) })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/evenements  { dossier_id, type, titre, date_echeance, responsable_id? }
router.post("/", async (req, res) => {
  const b = req.body || {};
  if (!b.dossier_id || !b.type || !b.date_echeance) {
    return res.status(400).json({ error: "dossier_id, type et date_echeance requis" });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO evenements (dossier_id, type, titre, date_echeance, responsable_id)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, type, titre, date_echeance, statut`,
      [b.dossier_id, b.type, b.titre || null, b.date_echeance, b.responsable_id || req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/evenements/jobs/alertes
// Appelé chaque jour par Cloud Scheduler. Repère les échéances qui franchissent
// un seuil (J-30/J-15/J-7/J-1/J0) et marque l'alerte comme envoyée (ici : renvoie
// la liste ; l'envoi e-mail/notification est branché à cette étape).
router.post("/jobs/alertes", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.titre, e.date_echeance, e.dossier_id, d.numero AS dossier_numero,
              e.responsable_id, (e.date_echeance::date - current_date) AS jours_restants,
              e.alerte_j30, e.alerte_j15, e.alerte_j7, e.alerte_j1, e.alerte_j0
       FROM evenements e JOIN dossiers d ON d.id = e.dossier_id
       WHERE e.statut = 'a_venir' AND e.date_echeance::date >= current_date`
    );
    const aNotifier = [];
    for (const e of rows) {
      const j = Number(e.jours_restants);
      let col = null;
      if (j === 0 && !e.alerte_j0) col = "alerte_j0";
      else if (j <= 1 && !e.alerte_j1) col = "alerte_j1";
      else if (j <= 7 && !e.alerte_j7) col = "alerte_j7";
      else if (j <= 15 && !e.alerte_j15) col = "alerte_j15";
      else if (j <= 30 && !e.alerte_j30) col = "alerte_j30";
      if (col) {
        await pool.query(`UPDATE evenements SET ${col} = true WHERE id = $1`, [e.id]);
        aNotifier.push({ id: e.id, dossier: e.dossier_numero, titre: e.titre, jours: j, seuil: col });
      }
    }
    // TODO (prod) : envoyer e-mail / notification interne pour chaque élément de aNotifier.
    res.json({ traites: rows.length, notifies: aNotifier.length, details: aNotifier });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
