// JURIA — Générateur de courriers : API de rédaction (lot 3, 05/11/2026). Montée AVANT le routeur du registre
// (mêmes préfixes /api/courriers) : les chemins non reconnus ici retombent sur le registre.
//
//   GET  /api/courriers/gabarits                         cases de saisie des gabarits            (courriers.creer)
//   POST /api/courriers/rediger                          crée le courrier : référence + registre + version 1   (courriers.creer)
//   GET  /api/courriers/:id/redaction                    contenu, options, état, versions         (courriers.consulter)
//   PUT  /api/courriers/:id/contenu                      nouvelle version du brouillon            (courriers.creer, auteur ou gestion)
//   GET  /api/courriers/:id/versions/:n/:format          fichier d'une version (pdf | docx)       (courriers.consulter)
//   POST /api/courriers/:id/soumettre-signature          brouillon → à signer                     (courriers.creer, auteur ou gestion)
//   POST /api/courriers/:id/retour-brouillon             à signer → brouillon                     (courriers.creer, auteur, signataire ou gestion)
const express = require("express");
const { requirePermission } = require("../permissions");
const { enteteContentDisposition } = require("../storage");
const { FichierIntrouvableError } = require("../storage");
const { listerGabarits } = require("../courrier/gabarits");
const { ErreurContenu } = require("../courrier/composer");
const R = require("../courrier/redaction");
const router = express.Router();

function erreur(res, e) {
  if (e instanceof ErreurContenu) return res.status(400).json({ error: e.message, erreurs: e.erreurs });
  if (e instanceof R.ErreurRedaction) return res.status(e.statut).json({ error: e.message });
  if (e instanceof FichierIntrouvableError) return res.status(404).json({ error: "Fichier introuvable dans le stockage." });
  console.error(e);
  return res.status(500).json({ error: "Erreur serveur" });
}

router.get("/gabarits", requirePermission("courriers.creer"), (req, res) => res.json(listerGabarits()));

router.post("/rediger", requirePermission("courriers.creer"), async (req, res) => {
  try { res.status(201).json(await R.creer(req.user, req.body || {})); } catch (e) { erreur(res, e); }
});

router.get("/:id/redaction", requirePermission("courriers.consulter"), async (req, res) => {
  try { res.json(await R.lire(req.params.id)); } catch (e) { erreur(res, e); }
});

router.put("/:id/contenu", requirePermission("courriers.creer"), async (req, res) => {
  try { res.json(await R.modifier(req.user, req.params.id, req.body || {})); } catch (e) { erreur(res, e); }
});

router.get("/:id/versions/:numero/:format", requirePermission("courriers.consulter"), async (req, res) => {
  try {
    const f = await R.fichierVersion(req.params.id, req.params.numero, req.params.format);
    res.setHeader("Content-Type", f.mime);
    res.setHeader("Content-Disposition", enteteContentDisposition(f.nom));
    res.send(f.buffer);
  } catch (e) { erreur(res, e); }
});

router.post("/:id/soumettre-signature", requirePermission("courriers.creer"), async (req, res) => {
  try { res.json(await R.soumettre(req.user, req.params.id)); } catch (e) { erreur(res, e); }
});

router.post("/:id/retour-brouillon", requirePermission("courriers.creer"), async (req, res) => {
  try { res.json(await R.retourBrouillon(req.user, req.params.id)); } catch (e) { erreur(res, e); }
});

module.exports = router;
