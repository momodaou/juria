// JURIA — routes Communication (« Fil du dossier »)
//
// MVP : journalisation des communications (e-mail, courrier, appel, WhatsApp,
//       réunion, note) rattachées à un dossier. On enregistre la trace et le
//       résumé ; le message d'origine peut être joint via la GED (documents).
//
// PHASE 3 — INTÉGRATION MESSAGERIE (préparée, non activée dans le MVP) :
//   * Google Workspace / Gmail : OAuth2 + API Gmail pour lire/envoyer des
//     e-mails depuis JURIA et rattacher automatiquement les messages au dossier
//     (ex. via un préfixe d'objet [AFF-26-018] ou un rapprochement par adresse).
//   * Microsoft 365 / Outlook : API Microsoft Graph, même principe.
//   * WhatsApp : API WhatsApp Business (messages entrants/sortants -> dossier).
//   La table `communications` du schéma est déjà prévue pour accueillir ces flux.
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const router = express.Router();

// GET /api/communications?dossier_id=...
router.get("/", async (req, res) => {
  const { dossier_id } = req.query;
  const params = [];
  let where = "";
  if (dossier_id) { params.push(dossier_id); where = "WHERE c.dossier_id = $1"; }
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.type, c.sujet, c.resume, c.interlocuteur, c.date_comm,
              u.prenom || ' ' || u.nom AS auteur
       FROM communications c
       LEFT JOIN utilisateurs u ON u.id = c.utilisateur_id
       ${where}
       ORDER BY c.date_comm DESC
       LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/communications  { dossier_id, client_id, type, sujet, resume, interlocuteur }
router.post("/", requirePermission("communications.creer"), async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await pool.query(
      `INSERT INTO communications
         (dossier_id, client_id, type, sujet, resume, interlocuteur, utilisateur_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, type, sujet, date_comm`,
      [b.dossier_id, b.client_id, b.type, b.sujet, b.resume, b.interlocuteur, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
