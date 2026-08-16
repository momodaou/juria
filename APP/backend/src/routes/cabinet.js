// JURIA — Cabinet (RH) : équipe et charge de travail, congés, alertes RH,
// pointage, compteur d'heures, bulletins de paie (option légère).
const express = require("express");
const { pool } = require("../db");
const { requireRole } = require("../auth");
const router = express.Router();

// GET /api/cabinet/equipe — membres, heures du mois, dossiers actifs, échéance de congé/contrat
router.get("/equipe", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.code, u.prenom, u.nom, u.role, u.pole, u.taux_horaire, u.actif,
              u.type_contrat, u.date_fin_essai, u.date_fin_contrat,
              COALESCE(h.total_heures, 0) AS heures_mois,
              (SELECT COUNT(*) FROM dossiers d WHERE d.responsable_id = u.id AND d.statut = 'ouvert') AS dossiers_actifs
       FROM utilisateurs u
       LEFT JOIN v_heures_mensuelles h
              ON h.utilisateur_id = u.id AND h.mois = date_trunc('month', current_date)
       WHERE u.actif = TRUE
       ORDER BY u.prenom`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/cabinet/echeances — fin d'essai, fin de contrat, visite médicale à venir
router.get("/echeances", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT utilisateur_id, prenom, nom, type_echeance, echeance,
              (echeance - current_date) AS jours_restants
       FROM v_echeances_rh
       WHERE echeance >= current_date - interval '7 days'
       ORDER BY echeance`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/cabinet/conges?utilisateur_id=&statut=
router.get("/conges", async (req, res) => {
  const { utilisateur_id, statut } = req.query;
  const params = [];
  const clauses = [];
  if (utilisateur_id) { params.push(utilisateur_id); clauses.push(`c.utilisateur_id = $${params.length}`); }
  if (statut) { params.push(statut); clauses.push(`c.statut = $${params.length}::statut_conge`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.type, c.date_debut, c.date_fin, c.statut, c.motif,
              u.prenom || ' ' || u.nom AS membre,
              a.prenom || ' ' || a.nom AS approuve_par
       FROM conges c
       JOIN utilisateurs u ON u.id = c.utilisateur_id
       LEFT JOIN utilisateurs a ON a.id = c.approuve_par
       ${where}
       ORDER BY c.date_debut DESC`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/cabinet/conges  { utilisateur_id?, type, date_debut, date_fin, motif? }
// Sans utilisateur_id : demande pour soi-même.
router.post("/conges", async (req, res) => {
  const b = req.body || {};
  if (!b.date_debut || !b.date_fin) return res.status(400).json({ error: "date_debut et date_fin requises" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO conges (utilisateur_id, type, date_debut, date_fin, motif)
       VALUES (COALESCE($1::uuid,$5::uuid),COALESCE($2::type_conge,'annuel'),$3,$4,$6)
       RETURNING id, type, date_debut, date_fin, statut`,
      [b.utilisateur_id || null, b.type, b.date_debut, b.date_fin, req.user.sub, b.motif || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/cabinet/conges/:id/decision  { statut: 'approuve'|'refuse' }  (associé/admin)
router.post("/conges/:id/decision", requireRole("associe", "admin"), async (req, res) => {
  const { statut } = req.body || {};
  if (!["approuve", "refuse"].includes(statut)) return res.status(400).json({ error: "Statut invalide" });
  try {
    const { rows } = await pool.query(
      `UPDATE conges SET statut = $1::statut_conge, approuve_par = $2, approuve_le = now()
       WHERE id = $3 RETURNING id, statut`,
      [statut, req.user.sub, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Demande introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/cabinet/presences?utilisateur_id=&mois=YYYY-MM-01
router.get("/presences", async (req, res) => {
  const uid = req.query.utilisateur_id || req.user.sub;
  const mois = req.query.mois || new Date().toISOString().slice(0, 8) + "01";
  try {
    const jours = await pool.query(
      `SELECT date_jour, heure_arrivee, heure_depart, heures
       FROM presences WHERE utilisateur_id = $1 AND date_trunc('month', date_jour) = $2::date
       ORDER BY date_jour DESC`,
      [uid, mois]
    );
    const total = await pool.query(
      `SELECT total_heures, jours_pointes FROM v_heures_mensuelles
       WHERE utilisateur_id = $1 AND mois = $2::date`,
      [uid, mois]
    );
    res.json({ jours: jours.rows, total_heures: total.rows[0]?.total_heures ?? 0, jours_pointes: total.rows[0]?.jours_pointes ?? 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/cabinet/presences  { date_jour?, heure_arrivee?, heure_depart?, heures? }
// Pointage pour soi-même ; upsert sur (utilisateur_id, date_jour).
router.post("/presences", async (req, res) => {
  const b = req.body || {};
  const date = b.date_jour || new Date().toISOString().slice(0, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO presences (utilisateur_id, date_jour, heure_arrivee, heure_depart, heures, source)
       VALUES ($1,$2,$3,$4,$5,'saisie')
       ON CONFLICT (utilisateur_id, date_jour) DO UPDATE SET
         heure_arrivee = COALESCE(EXCLUDED.heure_arrivee, presences.heure_arrivee),
         heure_depart  = COALESCE(EXCLUDED.heure_depart, presences.heure_depart),
         heures        = COALESCE(EXCLUDED.heures, presences.heures)
       RETURNING id, date_jour, heure_arrivee, heure_depart, heures`,
      [req.user.sub, date, b.heure_arrivee || null, b.heure_depart || null, b.heures || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// GET /api/cabinet/bulletins?utilisateur_id=
router.get("/bulletins", async (req, res) => {
  const uid = req.query.utilisateur_id || req.user.sub;
  try {
    const { rows } = await pool.query(
      `SELECT id, mois, salaire_brut, salaire_net, primes, verse_le
       FROM bulletins_paie WHERE utilisateur_id = $1 ORDER BY mois DESC`,
      [uid]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/cabinet/bulletins  (associé/admin/comptable)
// { utilisateur_id, mois, salaire_brut?, salaire_net?, cotisations_salariales?, cotisations_patronales?, primes?, verse_le? }
router.post("/bulletins", requireRole("associe", "admin", "comptable"), async (req, res) => {
  const b = req.body || {};
  if (!b.utilisateur_id || !b.mois) return res.status(400).json({ error: "utilisateur_id et mois requis" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO bulletins_paie
         (utilisateur_id, mois, salaire_brut, salaire_net, cotisations_salariales, cotisations_patronales, primes, verse_le, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (utilisateur_id, mois) DO UPDATE SET
         salaire_brut = EXCLUDED.salaire_brut, salaire_net = EXCLUDED.salaire_net,
         cotisations_salariales = EXCLUDED.cotisations_salariales,
         cotisations_patronales = EXCLUDED.cotisations_patronales,
         primes = EXCLUDED.primes, verse_le = EXCLUDED.verse_le
       RETURNING id, mois, salaire_brut, salaire_net`,
      [b.utilisateur_id, b.mois, b.salaire_brut || null, b.salaire_net || null,
       b.cotisations_salariales || null, b.cotisations_patronales || null,
       b.primes || null, b.verse_le || null, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
