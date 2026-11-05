// JURIA — Générateur de courriers (lot 1, 05/11/2026) : réglages du cabinet, cachet et signatures des signataires.
//
// Lecture : titulaires de courriers.creer (les rédacteurs ont besoin des réglages) ou de parametres.cabinet.modifier.
// Écriture : parametres.cabinet.modifier. Les images (cachet, signatures) ne sont JAMAIS renvoyées par l'API :
// on ne publie que leur présence et leur date ; seul le serveur les relit (lot 5, apposition).
const express = require("express");
const multer = require("multer");
const { pool } = require("../db");
const { requirePermission, estAutorise } = require("../permissions");
const { logAudit } = require("../audit");
const R = require("../courrier/reglages");
const router = express.Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: R.MAX_OCTETS } });
const envoiFichier = (req, res, next) => upload.single("fichier")(req, res, (e) => {
  if (e) return res.status(400).json({ error: e.code === "LIMIT_FILE_SIZE" ? "Fichier trop lourd (2 Mo au maximum)." : "Fichier illisible." });
  next();
});

async function peutLire(req, res, next) {
  const ok = (await estAutorise(req.user.role, "courriers.creer", req.user.sub))
    || (await estAutorise(req.user.role, "parametres.cabinet.modifier", req.user.sub));
  if (!ok) return res.status(403).json({ error: "Droit insuffisant" });
  next();
}

// GET / : réglages + liste des signataires (sans aucune image)
router.get("/", peutLire, async (req, res) => {
  try {
    const reglages = await R.lireReglages();
    const { rows } = await pool.query(
      "SELECT id, prenom || ' ' || nom AS nom, role, qualite_signature, nom_signature, " +
      "signature_chemin IS NOT NULL AS signature_presente, signature_maj_le " +
      "FROM utilisateurs " +
      "WHERE actif = TRUE AND (role IN ('associe','associe_fondateur') OR signature_chemin IS NOT NULL OR qualite_signature IS NOT NULL OR nom_signature IS NOT NULL) " +
      "ORDER BY nom");
    res.json({
      ...reglages,
      signataires: rows.map((r) => ({
        id: r.id, nom: r.nom, role: r.role, qualite_signature: r.qualite_signature, nom_signature: r.nom_signature,
        signature: { presente: r.signature_presente, maj_le: r.signature_maj_le },
      })),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// PUT / : réglages du papier, du logo et du cachet (largeur)
router.put("/", requirePermission("parametres.cabinet.modifier"), async (req, res) => {
  const { valeurs, erreur } = R.validerReglages(req.body || {});
  if (erreur) return res.status(400).json({ error: erreur });
  const cols = Object.keys(valeurs);
  if (!cols.length) return res.status(400).json({ error: "Aucun réglage à enregistrer." });
  try {
    const sets = cols.map((c, i) => c + " = $" + (i + 1)).join(", ");
    await pool.query("UPDATE parametres_cabinet SET " + sets + " WHERE id = 1", cols.map((c) => valeurs[c]));
    await logAudit({ utilisateurId: req.user.sub, action: "courrier_reglages_modifies", entite: "parametres_cabinet", entiteId: "1", details: valeurs, ip: req.ip });
    res.json(await R.lireReglages());
  } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
});

// POST /cachet · DELETE /cachet
router.post("/cachet", requirePermission("parametres.cabinet.modifier"), envoiFichier, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Fichier manquant." });
  const v = R.validerPng(req.file.buffer);
  if (v.erreur) return res.status(400).json({ error: v.erreur });
  try {
    await R.deposerCachet(req.file.buffer);
    await logAudit({ utilisateurId: req.user.sub, action: "courrier_cachet_depose", entite: "parametres_cabinet", entiteId: "1", details: { largeur: v.largeur, hauteur: v.hauteur }, ip: req.ip });
    res.status(201).json((await R.lireReglages()).cachet);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});
router.delete("/cachet", requirePermission("parametres.cabinet.modifier"), async (req, res) => {
  try {
    await pool.query("UPDATE parametres_cabinet SET courrier_cachet_chemin = NULL, courrier_cachet_maj_le = NULL WHERE id = 1");
    await logAudit({ utilisateurId: req.user.sub, action: "courrier_cachet_retire", entite: "parametres_cabinet", entiteId: "1", ip: req.ip });
    res.json({ present: false });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Signataires
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function signataire(req, res) {
  if (!UUID.test(req.params.id)) { res.status(400).json({ error: "Identifiant invalide." }); return null; }
  const { rows: [u] } = await pool.query("SELECT id, actif FROM utilisateurs WHERE id = $1::uuid", [req.params.id]);
  if (!u || !u.actif) { res.status(404).json({ error: "Utilisateur introuvable ou inactif." }); return null; }
  return u;
}
router.put("/signataires/:id", requirePermission("parametres.cabinet.modifier"), async (req, res) => {
  try {
    if (!(await signataire(req, res))) return;
    const b = req.body || {};
    const texte = (v) => String(v || "").trim().slice(0, 160) || null;
    const sets = [], vals = [];
    if (b.qualite_signature !== undefined) { vals.push(texte(b.qualite_signature)); sets.push("qualite_signature = $" + vals.length); }
    if (b.nom_signature !== undefined) { vals.push(texte(b.nom_signature)); sets.push("nom_signature = $" + vals.length); }
    if (!sets.length) return res.status(400).json({ error: "Rien à enregistrer." });
    vals.push(req.params.id);
    await pool.query("UPDATE utilisateurs SET " + sets.join(", ") + " WHERE id = $" + vals.length + "::uuid", vals);
    await logAudit({ utilisateurId: req.user.sub, action: "courrier_signataire_modifie", entite: "utilisateurs", entiteId: req.params.id,
      details: { qualite_signature: b.qualite_signature, nom_signature: b.nom_signature }, ip: req.ip });
    const { rows: [r] } = await pool.query("SELECT id, qualite_signature, nom_signature FROM utilisateurs WHERE id = $1::uuid", [req.params.id]);
    res.json(r);
  } catch (e) { console.error(e); res.status(400).json({ error: "Identifiant invalide." }); }
});
router.post("/signataires/:id/signature", requirePermission("parametres.cabinet.modifier"), envoiFichier, async (req, res) => {
  try {
    if (!(await signataire(req, res))) return;
    if (!req.file) return res.status(400).json({ error: "Fichier manquant." });
    const v = R.validerPng(req.file.buffer);
    if (v.erreur) return res.status(400).json({ error: v.erreur });
    await R.deposerSignature(req.params.id, req.file.buffer);
    await logAudit({ utilisateurId: req.user.sub, action: "courrier_signature_deposee", entite: "utilisateurs", entiteId: req.params.id, details: { largeur: v.largeur, hauteur: v.hauteur }, ip: req.ip });
    res.status(201).json({ presente: true });
  } catch (e) { console.error(e); res.status(400).json({ error: "Identifiant invalide." }); }
});
router.delete("/signataires/:id/signature", requirePermission("parametres.cabinet.modifier"), async (req, res) => {
  try {
    if (!(await signataire(req, res))) return;
    await pool.query("UPDATE utilisateurs SET signature_chemin = NULL, signature_maj_le = NULL WHERE id = $1::uuid", [req.params.id]);
    await logAudit({ utilisateurId: req.user.sub, action: "courrier_signature_retiree", entite: "utilisateurs", entiteId: req.params.id, ip: req.ip });
    res.json({ presente: false });
  } catch (e) { console.error(e); res.status(400).json({ error: "Identifiant invalide." }); }
});

module.exports = router;
