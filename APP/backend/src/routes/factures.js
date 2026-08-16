// JURIA — Facturation & paiements
const express = require("express");
const { pool } = require("../db");
const router = express.Router();

// Recalcule et met à jour le statut d'une facture selon les paiements reçus.
async function majStatut(factureId) {
  const f = await pool.query("SELECT montant_ttc FROM factures WHERE id = $1", [factureId]);
  if (!f.rows[0]) return;
  const ttc = Number(f.rows[0].montant_ttc);
  const p = await pool.query("SELECT COALESCE(SUM(montant),0) AS regle FROM paiements WHERE facture_id = $1", [factureId]);
  const regle = Number(p.rows[0].regle);
  let statut = "emise";
  if (regle <= 0) statut = "emise";
  else if (regle < ttc) statut = "partielle";
  else statut = "payee";
  await pool.query("UPDATE factures SET statut = $1 WHERE id = $2", [statut, factureId]);
  return statut;
}

// GET /api/factures?statut=  |  GET /api/factures/impayees
router.get("/impayees", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.numero, f.montant_ttc, f.statut, f.date_echeance,
              COALESCE(c.denomination, c.prenom || ' ' || c.nom) AS client,
              f.montant_ttc - COALESCE((SELECT SUM(montant) FROM paiements p WHERE p.facture_id = f.id),0) AS reste
       FROM factures f JOIN clients c ON c.id = f.client_id
       WHERE f.statut IN ('emise','partielle','impayee')
       ORDER BY f.date_echeance NULLS LAST`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/", async (req, res) => {
  const { statut, dossier_id, client_id } = req.query;
  const params = [];
  const clauses = [];
  if (statut) { params.push(statut); clauses.push(`f.statut = $${params.length}::statut_facture`); }
  if (dossier_id) { params.push(dossier_id); clauses.push(`f.dossier_id = $${params.length}`); }
  if (client_id) { params.push(client_id); clauses.push(`f.client_id = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.numero, f.mode, f.montant_ht, f.montant_ttc, f.statut,
              f.date_emission, f.date_echeance,
              COALESCE(c.denomination, c.prenom || ' ' || c.nom) AS client,
              d.numero AS dossier_numero
       FROM factures f
       JOIN clients c ON c.id = f.client_id
       LEFT JOIN dossiers d ON d.id = f.dossier_id
       ${where}
       ORDER BY f.cree_le DESC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/factures  { dossier_id?, client_id?, mode, montant_ht, taux_tva?, provision?, date_echeance? }
router.post("/", async (req, res) => {
  const b = req.body || {};
  try {
    let clientId = b.client_id;
    if (!clientId && b.dossier_id) {
      const d = await pool.query("SELECT client_id FROM dossiers WHERE id = $1", [b.dossier_id]);
      clientId = d.rows[0] ? d.rows[0].client_id : null;
    }
    if (!clientId) return res.status(400).json({ error: "client_id ou dossier_id valide requis" });
    if (!b.mode) return res.status(400).json({ error: "mode d'honoraires requis" });

    const ht = Math.round(Number(b.montant_ht || 0));
    const tauxTva = b.taux_tva !== undefined ? Number(b.taux_tva) : 18;
    const tva = Math.round((ht * tauxTva) / 100);
    const ttc = ht + tva;

    // Numérotation automatique : F-AA-XXX
    const yy = new Date().getFullYear().toString().slice(2);
    const c = await pool.query("SELECT count(*) + 1 AS n FROM factures WHERE numero LIKE $1", [`F-${yy}-%`]);
    const numero = b.numero || `F-${yy}-${String(c.rows[0].n).padStart(3, "0")}`;

    const { rows } = await pool.query(
      `INSERT INTO factures
         (numero, client_id, dossier_id, mode, montant_ht, taux_tva, montant_tva, montant_ttc,
          provision, statut, date_emission, date_echeance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),'emise',current_date,$10)
       RETURNING id, numero, montant_ht, montant_ttc, statut`,
      [numero, clientId, b.dossier_id || null, b.mode, ht, tauxTva, tva, ttc, b.provision, b.date_echeance || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/factures/:id/paiements  { montant, mode, reference? }
router.post("/:id/paiements", async (req, res) => {
  const b = req.body || {};
  if (!b.montant || !b.mode) return res.status(400).json({ error: "montant et mode requis" });
  try {
    await pool.query(
      `INSERT INTO paiements (facture_id, montant, mode, reference)
       VALUES ($1,$2,$3,$4)`,
      [req.params.id, Math.round(Number(b.montant)), b.mode, b.reference || null]
    );
    const statut = await majStatut(req.params.id);
    res.status(201).json({ facture_id: req.params.id, statut });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
