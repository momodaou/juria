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
const { executerJobMessagerieNotifications } = require("../jobs/messagerieNotifications");
const { executerJobAlertesFacturationDiscipline } = require("../jobs/alertesFacturationDiscipline");
const { executerJobAlertesRetoursManquants } = require("../jobs/alertesRetoursManquants");
const { executerJobAlertesAbonnements } = require("../jobs/alertesAbonnements");
const { executerJobAlertesTachesRetard } = require("../jobs/alertesTachesRetard");
const { executerJobAlertesDoublons } = require("../jobs/alertesDoublons");
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

// 13/09/2026 — notification e-mail messagerie (message non lu ≥10 min,
// destinataire hors ligne). Cadence recommandée : toutes les 5 minutes.
router.post("/messagerie-notifications", requireSchedulerSecret, async (req, res) => {
  try {
    res.json(await executerJobMessagerieNotifications(pool));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// 18/09/2026 — discipline de facturation, Bloc C (impayé + jamais
// facturé). Cadence recommandée : quotidienne (contrairement à la
// messagerie, ces seuils se comptent en jours, pas en minutes).
router.post("/alertes-facturation-discipline", requireSchedulerSecret, async (req, res) => {
  try {
    res.json(await executerJobAlertesFacturationDiscipline(pool));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// 24/09/2026 — audiences/diligences dont la date est passée sans retour
// saisi. Cadence recommandée : quotidienne (fenêtre glissante de 7 jours,
// pas de colonne de suivi côté schéma — voir jobs/alertesRetoursManquants.js).
router.post("/alertes-retours-manquants", requireSchedulerSecret, async (req, res) => {
  try {
    res.json(await executerJobAlertesRetoursManquants(pool));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// 05/10/2026 — clients contractuels (abonnement) : facturation périodique
// dépassée. Cadence recommandée : quotidienne (comme les autres jobs de
// facturation, ces seuils se comptent en jours).
router.post("/alertes-abonnements", requireSchedulerSecret, async (req, res) => {
  try {
    res.json(await executerJobAlertesAbonnements(pool));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// 10/10/2026 — Bloc B du diagnostic "instruction avocat -> collaborateur" :
// tâches en retard, un e-mail personnalisé par destinataire (ses propres
// tâches en retard + celles qu'il a confiées), sans fenêtre glissante
// contrairement à alertes-retours-manquants (voir jobs/alertesTachesRetard.js).
// Cadence recommandée : quotidienne.
router.post("/alertes-taches-retard", requireSchedulerSecret, async (req, res) => {
  try {
    res.json(await executerJobAlertesTachesRetard(pool));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// 12/10/2026 — rappel actif sur les doublons potentiels (filet de sécurité
// du Tableau de bord, jusqu'ici purement passif). Cadence recommandée :
// hebdomadaire (voir ../jobs/alertesDoublons.js — pas de colonne de
// suivi, un doublon persiste tant qu'il n'est pas corrigé à la main).
router.post("/alertes-doublons", requireSchedulerSecret, async (req, res) => {
  try {
    res.json(await executerJobAlertesDoublons(pool));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
