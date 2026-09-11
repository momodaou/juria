// JURIA — Échéancier : audiences, délais, prescriptions + alertes J-30 → jour J
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const { executerJobAlertesDelais } = require("../jobs/alertesDelais");
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

// GET /api/evenements?dossier_id=  (à venir, tous dossiers sauf filtre) — avec
// jours restants + niveau d'alerte. Filtre ajouté le 06/09/2026 pour le lien
// "Voir dans l'Échéancier" depuis la fiche dossier (navigation inter-modules).
router.get("/", requirePermission("echeancier.consulter"), async (req, res) => {
  const { dossier_id } = req.query;
  const params = [];
  let clause = "e.statut = 'a_venir'";
  if (dossier_id) { params.push(dossier_id); clause += ` AND e.dossier_id = $${params.length}`; }
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.type, e.precision, e.titre, e.date_echeance, e.statut, e.dossier_id,
              d.numero AS dossier_numero, d.intitule AS dossier_intitule,
              u.prenom || ' ' || u.nom AS responsable,
              (e.date_echeance::date - current_date) AS jours_restants
       FROM evenements e
       JOIN dossiers d ON d.id = e.dossier_id
       LEFT JOIN utilisateurs u ON u.id = e.responsable_id
       WHERE ${clause}
       ORDER BY e.date_echeance`,
      params
    );
    res.json(rows.map((r) => ({ ...r, alerte: niveauAlerte(Number(r.jours_restants)) })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/evenements  { dossier_id, type, titre, date_echeance, responsable_id?, precision? }
// precision : texte libre, pertinent surtout quand type='autre' (même
// principe que depenses.precision) — pas de validation stricte côté
// serveur sur ce couplage, simple champ optionnel comme les autres.
router.post("/", requirePermission("evenements.creer"), async (req, res) => {
  const b = req.body || {};
  if (!b.dossier_id || !b.type || !b.date_echeance) {
    return res.status(400).json({ error: "dossier_id, type et date_echeance requis" });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO evenements (dossier_id, type, titre, date_echeance, responsable_id, precision)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, type, titre, date_echeance, statut`,
      [b.dossier_id, b.type, b.titre || null, b.date_echeance, b.responsable_id || req.user.sub, b.precision || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/evenements/jobs/alertes  (déclenchement manuel, authentifié)
// Repère les échéances qui franchissent un seuil (J-30/J-15/J-7/J-1/J0) et
// marque l'alerte comme envoyée. Jusqu'au 18/08/2026, n'importe quel
// utilisateur authentifié pouvait déclencher ce job (aucun contrôle de
// permission dessus) — corrigé au passage en creusant le même patron pour
// construire le job d'alertes honoraires. Le déclenchement automatique
// réel passe désormais par Cloud Scheduler → /internal/jobs/alertes-delais
// (routes/internal-jobs.js, protégé par secret partagé, pas par un jeton
// utilisateur) ; cette route reste utile pour un test/déclenchement manuel.
router.post("/jobs/alertes", requirePermission("evenements.jobs.declencher"), async (req, res) => {
  try {
    res.json(await executerJobAlertesDelais(pool));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
