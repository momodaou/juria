// JURIA — Paramètres du cabinet : seuil de frais pro bono + quota mensuel,
// identité du cabinet (en-tête facture) et comptes bancaires (RIB imprimé
// sur la facture).
//
// Historique (18/08/2026) : cette route couvrait aussi un seuil d'honoraires
// minimum pour les dossiers classiques (honoraires_min_xof, 150 000 FCFA) —
// abandonné explicitement par l'utilisateur le même jour (colonne
// supprimée en base). Le volet pro bono, distinct, est conservé.
//
// Ajout 28/08/2026 (facture PDF enrichie) : parametres_cabinet.raison_
// sociale/adresse/telephone/email/nif/rccm/compte_carpa/mentions_legales
// existaient depuis le premier schéma (utilisés par actes.js et
// facturePdf.js) mais n'avaient AUCUNE route d'écriture — seule la valeur
// par défaut ('JFC AVOCATS MALI') était présente, le reste à NULL, faute
// de mécanisme pour les saisir autrement qu'un import SQL manuel. Même
// constat pour comptes_bancaires (aucune route POST/PUT nulle part dans
// l'appli — seul un SELECT existait, dans depenses.js).
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const router = express.Router();

// GET /api/parametres/honoraires — lecture ouverte à tout utilisateur
// authentifié : les seuils sont de toute façon visibles indirectement via
// le badge honoraires sur les dossiers pro bono.
router.get("/honoraires", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT frais_procedure_pro_bono_min_xof, quota_pro_bono_mensuel
       FROM parametres_cabinet WHERE id = 1`
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /api/parametres/honoraires  { frais_procedure_pro_bono_min_xof?, quota_pro_bono_mensuel? }
// Réservé par la matrice de permissions (parametres.honoraires.modifier),
// pas un requireRole en dur : contrairement à la matrice elle-même, il n'y
// a pas de risque d'auto-verrouillage à faire dépendre ce réglage de la
// matrice qu'il ne contrôle pas.
router.put("/honoraires", requirePermission("parametres.honoraires.modifier"), async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE parametres_cabinet SET
         frais_procedure_pro_bono_min_xof = COALESCE($1, frais_procedure_pro_bono_min_xof),
         quota_pro_bono_mensuel = COALESCE($2, quota_pro_bono_mensuel)
       WHERE id = 1
       RETURNING frais_procedure_pro_bono_min_xof, quota_pro_bono_mensuel`,
      [b.frais_procedure_pro_bono_min_xof ?? null, b.quota_pro_bono_mensuel ?? null]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

const CHAMPS_CABINET = [
  "raison_sociale", "forme", "adresse", "telephone", "email",
  "nif", "rccm", "compte_carpa", "mentions_legales",
];

// GET /api/parametres/cabinet — identité complète du cabinet (en-tête de
// facture/acte). Lecture ouverte comme /honoraires : rien de confidentiel
// (adresse, NIF, RCCM du cabinet lui-même — déjà imprimés sur chaque
// document sortant).
router.get("/cabinet", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${CHAMPS_CABINET.join(", ")} FROM parametres_cabinet WHERE id = 1`
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /api/parametres/cabinet — mêmes champs, tous optionnels (COALESCE).
router.put("/cabinet", requirePermission("parametres.cabinet.modifier"), async (req, res) => {
  const b = req.body || {};
  const sets = CHAMPS_CABINET.map((c, i) => `${c} = COALESCE($${i + 1}, ${c})`);
  const params = CHAMPS_CABINET.map((c) => (b[c] !== undefined ? b[c] : null));
  try {
    const { rows } = await pool.query(
      `UPDATE parametres_cabinet SET ${sets.join(", ")} WHERE id = 1 RETURNING ${CHAMPS_CABINET.join(", ")}`,
      params
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// GET /api/parametres/comptes-bancaires — liste complète (actifs et
// inactifs) pour la gestion, RIB inclus. À distinguer de
// GET /api/depenses/comptes (liste allégée, actifs seulement, sans RIB —
// utilisée par les sélecteurs de règlement, ouverte à tout rôle).
router.get("/comptes-bancaires", requirePermission("parametres.cabinet.modifier"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, intitule, type, banque, numero, operateur, actif,
              code_banque, code_guichet, cle_rib, iban, bic
       FROM comptes_bancaires ORDER BY actif DESC, intitule`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/parametres/comptes-bancaires
router.post("/comptes-bancaires", requirePermission("parametres.cabinet.modifier"), async (req, res) => {
  const b = req.body || {};
  if (!b.intitule || !b.type) return res.status(400).json({ error: "intitule et type requis" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO comptes_bancaires
         (intitule, type, banque, numero, operateur, code_banque, code_guichet, cle_rib, iban, bic)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [b.intitule, b.type, b.banque || null, b.numero || null, b.operateur || null,
       b.code_banque || null, b.code_guichet || null, b.cle_rib || null, b.iban || null, b.bic || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/parametres/comptes-bancaires/:id — tous champs optionnels,
// y compris actif (désactivation plutôt que suppression : un compte déjà
// référencé par des paiements/dépenses/factures ne doit pas disparaître).
router.put("/comptes-bancaires/:id", requirePermission("parametres.cabinet.modifier"), async (req, res) => {
  const b = req.body || {};
  const champs = ["intitule", "type", "banque", "numero", "operateur", "code_banque", "code_guichet", "cle_rib", "iban", "bic", "actif"];
  const sets = champs.map((c, i) => `${c} = COALESCE($${i + 1}, ${c})`);
  const params = champs.map((c) => (b[c] !== undefined ? b[c] : null));
  try {
    const { rows } = await pool.query(
      `UPDATE comptes_bancaires SET ${sets.join(", ")} WHERE id = $${champs.length + 1} RETURNING id`,
      [...params, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Compte introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
