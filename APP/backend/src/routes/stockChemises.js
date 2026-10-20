// JURIA — stock de chemises à rabat (20/10/2026) : initialisation, entrées,
// ajustements, seuils, journal et régularisation unique des dossiers existants.
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const { logAudit } = require("../audit");
const { COULEURS, couleurStock, etatStock } = require("../stockChemises");
const router = express.Router();

const entier = (v) => (Number.isInteger(Number(v)) ? Number(v) : NaN);

// GET /api/stock-chemises
router.get("/", requirePermission("stock.chemises.consulter"), async (req, res) => {
  try {
    const init = await pool.query("SELECT 1 FROM stock_chemises_mouvements WHERE type = 'initial' LIMIT 1");
    res.json({ initialise: init.rowCount > 0, stock: await etatStock(pool) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// GET /api/stock-chemises/mouvements
router.get("/mouvements", requirePermission("stock.chemises.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.couleur, m.quantite, m.type, m.motif, m.cree_le, m.dossier_id,
              d.numero AS dossier_numero, u.prenom || ' ' || u.nom AS auteur
       FROM stock_chemises_mouvements m
       LEFT JOIN dossiers d ON d.id = m.dossier_id
       LEFT JOIN utilisateurs u ON u.id = m.cree_par
       ORDER BY m.cree_le DESC LIMIT 200`
    );
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/stock-chemises/initialiser { quantites: { bleu, dore, rouge, vert, violet } } — une seule fois.
router.post("/initialiser", requirePermission("stock.chemises.gerer"), async (req, res) => {
  const q = (req.body || {}).quantites || {};
  for (const c of COULEURS) {
    const n = entier(q[c]);
    if (!Number.isInteger(n) || n < 0) return res.status(400).json({ error: `Quantité invalide pour ${c}` });
  }
  try {
    // Garde-fou : un comptage à 0 partout laisserait le stock « non initialisé ».
    if (COULEURS.every((c) => Number(q[c]) === 0)) return res.status(400).json({ error: "Renseignez au moins une quantité." });
    const deja = await pool.query("SELECT 1 FROM stock_chemises_mouvements WHERE type = 'initial' LIMIT 1");
    if (deja.rowCount) return res.status(409).json({ error: "Le stock a déjà été initialisé : utilisez une entrée ou un ajustement." });
    for (const c of COULEURS) {
      if (Number(q[c]) > 0) {
        await pool.query(
          "INSERT INTO stock_chemises_mouvements (couleur, quantite, type, motif, cree_par) VALUES ($1,$2,'initial','Comptage physique initial',$3)",
          [c, Number(q[c]), req.user.sub]
        );
      }
    }
    await logAudit({ utilisateurId: req.user.sub, action: "initialiser_stock_chemises", entite: "stock_chemises", details: { quantites: q }, ip: req.ip });
    res.status(201).json({ initialise: true, stock: await etatStock(pool) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/stock-chemises/mouvement { couleur, type: 'entree'|'ajustement', quantite, motif }
// entrée : quantité > 0 ; ajustement : quantité signée, motif obligatoire.
router.post("/mouvement", requirePermission("stock.chemises.gerer"), async (req, res) => {
  const b = req.body || {};
  const n = entier(b.quantite);
  if (!COULEURS.includes(b.couleur)) return res.status(400).json({ error: "Couleur invalide" });
  if (!["entree", "ajustement"].includes(b.type)) return res.status(400).json({ error: "Type invalide" });
  if (!Number.isInteger(n) || n === 0) return res.status(400).json({ error: "Quantité invalide" });
  if (b.type === "entree" && n < 0) return res.status(400).json({ error: "Une entrée doit être positive" });
  if (b.type === "ajustement" && !String(b.motif || "").trim()) return res.status(400).json({ error: "Motif obligatoire pour un ajustement" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO stock_chemises_mouvements (couleur, quantite, type, motif, cree_par)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [b.couleur, n, b.type, (b.motif || (b.type === "entree" ? "Réapprovisionnement" : null)), req.user.sub]
    );
    await logAudit({ utilisateurId: req.user.sub, action: "mouvement_stock_chemises", entite: "stock_chemises", entiteId: rows[0].id,
      details: { couleur: b.couleur, type: b.type, quantite: n, motif: b.motif || null }, ip: req.ip });
    res.status(201).json({ stock: await etatStock(pool) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// PUT /api/stock-chemises/seuils { bleu: 50, dore: 50, … }
router.put("/seuils", requirePermission("stock.chemises.gerer"), async (req, res) => {
  const b = req.body || {};
  for (const c of COULEURS) {
    if (b[c] === undefined) continue;
    const n = entier(b[c]);
    if (!Number.isInteger(n) || n < 0) return res.status(400).json({ error: `Seuil invalide pour ${c}` });
  }
  try {
    for (const c of COULEURS) {
      if (b[c] !== undefined) await pool.query("UPDATE stock_chemises_seuils SET seuil = $2 WHERE couleur = $1", [c, Number(b[c])]);
    }
    res.json({ stock: await etatStock(pool) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Dossiers existants sans mouvement de chemise, pour la régularisation.
async function dossiersARegulariser() {
  const { rows } = await pool.query(
    `SELECT d.id, d.numero, d.intitule, d.statut, d.couleur_chemise, d.date_ouverture
     FROM dossiers d
     WHERE NOT EXISTS (SELECT 1 FROM stock_chemises_mouvements m WHERE m.dossier_id = d.id AND m.type IN ('dossier','regularisation'))
     ORDER BY d.date_ouverture, d.numero`
  );
  return rows.map((r) => ({ ...r, couleur: couleurStock(r.couleur_chemise) })).filter((r) => r.couleur);
}

// GET /api/stock-chemises/regularisation — aperçu avant application.
router.get("/regularisation", requirePermission("stock.chemises.gerer"), async (req, res) => {
  try {
    const dossiers = await dossiersARegulariser();
    const stock = await etatStock(pool);
    const resume = stock.map((s) => {
      const n = dossiers.filter((d) => d.couleur === s.couleur).length;
      return { couleur: s.couleur, stock_actuel: s.quantite, dossiers: n, stock_apres: s.quantite - n };
    });
    res.json({ resume, dossiers });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/stock-chemises/regularisation { exclure: [dossier_id…] } — une sortie par dossier (stock initialisé requis).
router.post("/regularisation", requirePermission("stock.chemises.gerer"), async (req, res) => {
  const exclure = new Set(Array.isArray((req.body || {}).exclure) ? req.body.exclure : []);
  try {
    const init = await pool.query("SELECT 1 FROM stock_chemises_mouvements WHERE type = 'initial' LIMIT 1");
    if (!init.rowCount) return res.status(409).json({ error: "Initialisez d'abord le stock avec le comptage physique." });
    const dossiers = (await dossiersARegulariser()).filter((d) => !exclure.has(d.id));
    let n = 0;
    for (const d of dossiers) {
      const r = await pool.query(
        `INSERT INTO stock_chemises_mouvements (couleur, quantite, type, dossier_id, motif, cree_par)
         VALUES ($1,-1,'regularisation',$2,'Chemise d''un dossier existant (régularisation)',$3)
         ON CONFLICT (dossier_id) WHERE type IN ('dossier','regularisation') AND dossier_id IS NOT NULL DO NOTHING`,
        [d.couleur, d.id, req.user.sub]
      );
      n += r.rowCount;
    }
    await logAudit({ utilisateurId: req.user.sub, action: "regulariser_stock_chemises", entite: "stock_chemises", details: { dossiers: n, exclus: exclure.size }, ip: req.ip });
    res.json({ appliques: n, stock: await etatStock(pool) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

module.exports = router;
