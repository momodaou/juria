// JURIA — Rétrocessions d'honoraires : calcul par qualité du bénéficiaire
// (associé 30 %, collaborateur avocat/stagiaire/Of Counsel 25 %,
// collaborateur non-avocat 10 %), règle « tout ou rien » (décaissable
// seulement une fois la facture liée intégralement encaissée), et suivi
// du quota Pro Bono (2 dossiers/mois/associé, non reportables).
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const router = express.Router();

const TAUX_DEFAUT = { associe: 30, collaborateur: 25, non_avocat: 10 };
const QUOTA_PRO_BONO_MENSUEL = 2;

// GET /api/retrocessions/qualites
router.get("/qualites", (req, res) => {
  res.json([
    { code: "associe", libelle: "Associé", taux: 30 },
    { code: "collaborateur", libelle: "Collab. avocat / stagiaire / Of Counsel", taux: 25 },
    { code: "non_avocat", libelle: "Collab. non-avocat", taux: 10 },
  ]);
});

// GET /api/retrocessions?beneficiaire_id=&statut=
// Chacun voit toujours SES PROPRES rétrocessions (beneficiaire_id = soi-même)
// sans permission particulière ; voir celles de quelqu'un d'autre — ou la
// liste complète sans filtre — exige retrocessions.consulter (rémunération
// individuelle, donnée sensible). Le paramètre n'est plus une simple
// commodité d'affichage : c'est la frontière de sécurité elle-même.
router.get("/", async (req, res) => {
  const { beneficiaire_id, statut } = req.query;
  const consulteSesPropres = beneficiaire_id && beneficiaire_id === req.user.sub;
  if (!consulteSesPropres) {
    const { rows } = await pool.query(
      "SELECT autorise FROM permissions_role WHERE role = $1 AND action_code = 'retrocessions.consulter'",
      [req.user.role]
    );
    if (!rows[0] || !rows[0].autorise) {
      return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
    }
  }
  const params = [];
  const clauses = [];
  if (beneficiaire_id) { params.push(beneficiaire_id); clauses.push(`r.beneficiaire_id = $${params.length}`); }
  if (statut) { params.push(statut); clauses.push(`r.statut = $${params.length}::statut_retro`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.qualite, r.taux, r.base_ht, r.montant, r.statut, r.decaisse_le,
              u.prenom || ' ' || u.nom AS beneficiaire,
              d.numero AS dossier_numero, f.numero AS facture_numero,
              f.montant_ttc, COALESCE(pv.encaisse, 0) AS encaisse,
              (f.id IS NULL OR COALESCE(pv.encaisse, 0) >= f.montant_ttc) AS honoraires_encaisses
       FROM retrocessions r
       JOIN utilisateurs u ON u.id = r.beneficiaire_id
       LEFT JOIN dossiers d ON d.id = r.dossier_id
       LEFT JOIN factures f ON f.id = r.facture_id
       LEFT JOIN (SELECT facture_id, SUM(montant) AS encaisse FROM paiements GROUP BY facture_id) pv
              ON pv.facture_id = f.id
       ${where}
       ORDER BY r.cree_le DESC LIMIT 300`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/retrocessions
// { beneficiaire_id, qualite, base_ht, taux?, dossier_id?, facture_id? }
router.post("/", requirePermission("retrocessions.creer"), async (req, res) => {
  const b = req.body || {};
  if (!b.beneficiaire_id || !b.qualite || b.base_ht == null) {
    return res.status(400).json({ error: "beneficiaire_id, qualite et base_ht requis" });
  }
  const taux = b.taux != null ? Number(b.taux) : TAUX_DEFAUT[b.qualite];
  if (taux == null) return res.status(400).json({ error: "qualite invalide" });
  const montant = Math.round((Number(b.base_ht) * taux) / 100);
  try {
    const { rows } = await pool.query(
      `INSERT INTO retrocessions (beneficiaire_id, qualite, taux, base_ht, montant, dossier_id, facture_id, cree_par)
       VALUES ($1,$2::qualite_retro,$3,$4,$5,$6,$7,$8)
       RETURNING id, qualite, taux, base_ht, montant, statut`,
      [b.beneficiaire_id, b.qualite, taux, b.base_ht, montant, b.dossier_id || null, b.facture_id || null, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/retrocessions/:id/decaisser  (associé/admin/comptable)
// Règle « tout ou rien » : refusé si une facture est liée et n'est pas intégralement encaissée.
router.post("/:id/decaisser", requirePermission("retrocessions.decaisser"), async (req, res) => {
  try {
    const chk = await pool.query(
      `SELECT r.id, r.statut, f.id AS facture_id, f.montant_ttc,
              COALESCE((SELECT SUM(montant) FROM paiements WHERE facture_id = f.id), 0) AS encaisse
       FROM retrocessions r LEFT JOIN factures f ON f.id = r.facture_id
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (!chk.rows[0]) return res.status(404).json({ error: "Rétrocession introuvable" });
    const r = chk.rows[0];
    if (r.facture_id && Number(r.encaisse) < Number(r.montant_ttc)) {
      return res.status(400).json({ error: "Facture liée non intégralement encaissée (règle tout ou rien)." });
    }
    // Garde contre le double décaissement (double clic, ou deux personnes en
    // même temps) : la deuxième tentative concurrente ne trouve plus de ligne
    // à statut != 'decaissee' et reçoit un message explicite plutôt que
    // d'écraser silencieusement decaisse_par/decaisse_le.
    const { rows } = await pool.query(
      `UPDATE retrocessions SET statut = 'decaissee', decaisse_par = $1, decaisse_le = now()
       WHERE id = $2 AND statut <> 'decaissee' RETURNING id, statut, decaisse_le`,
      [req.user.sub, req.params.id]
    );
    if (!rows[0]) return res.status(409).json({ error: "Rétrocession déjà décaissée (par quelqu'un d'autre entre-temps ?)" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/retrocessions/pro-bono?mois=YYYY-MM-01&associe_id=
// Suivi du quota (2 dossiers pro bono / mois / associé, non reportable).
router.get("/pro-bono", async (req, res) => {
  const mois = req.query.mois || new Date().toISOString().slice(0, 8) + "01";
  try {
    const { rows } = await pool.query(
      `SELECT u.id AS associe_id, u.prenom || ' ' || u.nom AS associe,
              COUNT(d.id) FILTER (WHERE d.pro_bono AND date_trunc('month', d.date_ouverture) = $1::date) AS utilises
       FROM utilisateurs u
       LEFT JOIN dossiers d ON d.responsable_id = u.id
       WHERE u.role = 'associe' AND u.actif = TRUE
       GROUP BY u.id, u.prenom, u.nom
       ORDER BY u.prenom`,
      [mois]
    );
    res.json(rows.map((r) => ({
      ...r,
      quota: QUOTA_PRO_BONO_MENSUEL,
      restants: Math.max(0, QUOTA_PRO_BONO_MENSUEL - Number(r.utilises)),
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
