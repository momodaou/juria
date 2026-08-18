// JURIA — points d'entrée internes destinés à Cloud Scheduler (ajout
// 18/08/2026), hors du middleware authenticate standard : un job planifié
// n'a pas de jeton utilisateur à fournir. Protégé par un secret partagé
// (X-Scheduler-Secret, comparé à process.env.SCHEDULER_SECRET, stocké dans
// Secret Manager comme juria-db-password/juria-jwt-secret) plutôt que par
// JWT — même principe que /api/messagerie/stream, qui gère déjà sa propre
// authentification en dehors du middleware standard.
//
// Avant cet ajout, le job d'alertes de délais existant (evenements.js)
// n'était jamais réellement déclenché en production : aucun Cloud
// Scheduler n'était configuré dans le projet. Les deux jobs (délais +
// honoraires) sont donc exposés ici, réutilisant la même logique que les
// routes de déclenchement manuel authentifiées.
const express = require("express");
const { pool } = require("../db");
const bus = require("../messagerie-bus");
const { executerJobAlertesDelais } = require("../jobs/alertesDelais");
const { executerJobAlertesHonoraires } = require("../jobs/alertesHonoraires");
const router = express.Router();

function requireSchedulerSecret(req, res, next) {
  const secret = process.env.SCHEDULER_SECRET;
  if (!secret) {
    // Pas de secret configuré (dev local sans variable d'env) : on refuse
    // plutôt que d'accepter tout appel non authentifié par défaut.
    return res.status(503).json({ error: "SCHEDULER_SECRET non configuré" });
  }
  if (req.headers["x-scheduler-secret"] !== secret) {
    return res.status(401).json({ error: "Secret de planification invalide" });
  }
  next();
}

router.post("/alertes-delais", requireSchedulerSecret, async (req, res) => {
  try {
    res.json(await executerJobAlertesDelais(pool));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/alertes-honoraires", requireSchedulerSecret, async (req, res) => {
  try {
    res.json(await executerJobAlertesHonoraires(pool, bus));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
