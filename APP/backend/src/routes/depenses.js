// JURIA — Dépenses & caisse : charges fixes/ponctuelles avec circuit de
// validation (soumise → validée/rejetée → décaissée), petite caisse,
// comptes du cabinet, vignettes de plaidoirie (stock).
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const router = express.Router();

// GET /api/depenses?type=&statut=&dossier_id=&petite_caisse=
router.get("/", async (req, res) => {
  const { type, statut, dossier_id, petite_caisse } = req.query;
  const params = [];
  const clauses = [];
  if (type) { params.push(type); clauses.push(`d.type = $${params.length}::type_depense`); }
  if (statut) { params.push(statut); clauses.push(`d.statut = $${params.length}::statut_depense`); }
  if (dossier_id) { params.push(dossier_id); clauses.push(`d.dossier_id = $${params.length}`); }
  if (petite_caisse !== undefined) { params.push(petite_caisse === "true"); clauses.push(`d.petite_caisse = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.type, d.categorie, d.libelle, d.montant, d.date_depense, d.mode_paiement,
              d.petite_caisse, d.justificatif, d.refacturable_client, d.statut, d.recurrente,
              c.intitule AS compte, dos.numero AS dossier_numero,
              u.prenom || ' ' || u.nom AS soumis_par
       FROM depenses d
       LEFT JOIN comptes_bancaires c ON c.id = d.compte_id
       LEFT JOIN dossiers dos ON dos.id = d.dossier_id
       LEFT JOIN utilisateurs u ON u.id = d.soumis_par
       ${where}
       ORDER BY d.date_depense DESC, d.cree_le DESC LIMIT 300`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/depenses
// { type, categorie, libelle, montant, date_depense?, mode_paiement?, compte_id?,
//   petite_caisse?, justificatif?, refacturable_client?, dossier_id?, recurrente? }
router.post("/", requirePermission("depenses.creer"), async (req, res) => {
  const b = req.body || {};
  if (!b.type || !b.libelle || b.montant == null) return res.status(400).json({ error: "type, libelle et montant requis" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO depenses
         (type, categorie, libelle, montant, date_depense, mode_paiement, compte_id,
          petite_caisse, justificatif, refacturable_client, dossier_id, recurrente,
          soumis_par, cree_par)
       VALUES ($1::type_depense,COALESCE($2::categorie_depense,'autre'),$3,$4,COALESCE($5,current_date),
               $6,$7,COALESCE($8,false),COALESCE($9,false),COALESCE($10,false),$11,COALESCE($12,false),$13,$13)
       RETURNING id, type, categorie, libelle, montant, statut`,
      [b.type, b.categorie, b.libelle, b.montant, b.date_depense || null, b.mode_paiement || null,
       b.compte_id || null, b.petite_caisse, b.justificatif, b.refacturable_client,
       b.dossier_id || null, b.recurrente, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/depenses/:id/decision  { statut: 'validee'|'rejetee', motif_rejet? }  (gérant : associé/admin)
router.post("/:id/decision", requirePermission("depenses.decision"), async (req, res) => {
  const { statut, motif_rejet } = req.body || {};
  if (!["validee", "rejetee"].includes(statut)) return res.status(400).json({ error: "Statut invalide" });
  try {
    const { rows } = await pool.query(
      `UPDATE depenses SET statut = $1::statut_depense, motif_rejet = $2, valide_par = $3, valide_le = now()
       WHERE id = $4 AND statut = 'soumise' RETURNING id, statut`,
      [statut, motif_rejet || null, req.user.sub, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Dépense introuvable ou déjà traitée" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/depenses/:id/decaisser  (comptabilité : comptable/associe/admin)
router.post("/:id/decaisser", requirePermission("depenses.decaisser"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE depenses SET statut = 'decaissee', decaisse_par = $1, decaisse_le = now()
       WHERE id = $2 AND statut = 'validee' RETURNING id, statut`,
      [req.user.sub, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "La dépense doit être validée avant décaissement" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/depenses/comptes
router.get("/comptes", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, intitule, type, banque, operateur FROM comptes_bancaires WHERE actif = TRUE ORDER BY intitule");
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/depenses/petite-caisse?mois=YYYY-MM-01
router.get("/petite-caisse", async (req, res) => {
  const mois = req.query.mois || new Date().toISOString().slice(0, 8) + "01";
  try {
    const dotation = await pool.query("SELECT * FROM dotations_petite_caisse WHERE mois = $1", [mois]);
    const depense = await pool.query(
      `SELECT COALESCE(SUM(montant),0) AS total FROM depenses
       WHERE petite_caisse = TRUE AND date_trunc('month', date_depense) = $1::date`,
      [mois]
    );
    res.json({
      mois,
      dotation: dotation.rows[0]?.montant_alloue ?? 0,
      depense: Number(depense.rows[0].total),
      solde: Number(dotation.rows[0]?.montant_alloue ?? 0) - Number(depense.rows[0].total),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/depenses/petite-caisse  { mois, montant_alloue }  (administrateur)
router.post("/petite-caisse", requirePermission("depenses.petite_caisse.doter"), async (req, res) => {
  const { mois, montant_alloue } = req.body || {};
  if (!mois || montant_alloue == null) return res.status(400).json({ error: "mois et montant_alloue requis" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO dotations_petite_caisse (mois, montant_alloue, administrateur_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (mois) DO UPDATE SET montant_alloue = EXCLUDED.montant_alloue
       RETURNING mois, montant_alloue`,
      [mois, montant_alloue, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// GET /api/depenses/vignettes/stock
router.get("/vignettes/stock", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT stock FROM v_stock_vignettes");
    res.json({ stock: rows[0]?.stock ?? 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/depenses/vignettes  { mouvement: 'achat'|'utilisation', quantite, dossier_id?, refacturee? }
router.post("/vignettes", requirePermission("depenses.vignettes.mouvement"), async (req, res) => {
  const b = req.body || {};
  if (!["achat", "utilisation"].includes(b.mouvement) || !b.quantite) {
    return res.status(400).json({ error: "mouvement (achat|utilisation) et quantite requis" });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO vignettes_plaidoirie (mouvement, quantite, dossier_id, refacturee, cree_par)
       VALUES ($1,$2,$3,COALESCE($4,false),$5)
       RETURNING id, mouvement, quantite, date_mouvement`,
      [b.mouvement, b.quantite, b.dossier_id || null, b.refacturee, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
