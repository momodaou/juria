// JURIA — Atelier d'actes : génération d'un acte à partir d'un modèle
// (fusion avec les données du dossier/client et l'en-tête du cabinet) ou
// d'un brouillon IA. Le résultat est enregistré dans la GED (table
// documents, statut « brouillon »).
//
// Réécrit le 13/09/2026 (demande explicite de l'utilisateur, suite à une
// analyse des pratiques du secteur — voir HISTORY.md) : jusqu'ici la
// génération s'arrêtait net (texte figé, non modifiable, pas de vrai
// rendu imprimable), et les modèles étaient codés en dur dans un objet JS
// (`MODELES`), aucun moyen d'en ajouter sans toucher au code. Remplacé
// par : une table `modeles_actes` (voir schema.sql), un cycle
// brouillon→édition→validation sur l'acte généré, et un vrai PDF
// (actePdf.js, même patron que facturePdf.js).
const express = require("express");
const { pool } = require("../db");
const { saveObject } = require("../storage");
const { generer } = require("../ia");
const { requirePermission } = require("../permissions");
const { envoyerActePdf } = require("../actePdf");
const router = express.Router();

function fmtDate(d) {
  return new Date(d).toLocaleDateString("fr-FR");
}

// GET /api/actes/modeles — modèles actifs, pour le sélecteur de génération.
router.get("/modeles", requirePermission("actes.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT code, nom, categorie FROM modeles_actes WHERE actif = TRUE ORDER BY categorie, nom"
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/actes/modeles/tous — y compris désactivés, pour l'écran de
// gestion des modèles (distinct de la liste ci-dessus, réservée à un
// public plus large via actes.consulter).
router.get("/modeles/tous", requirePermission("actes.modeles.gerer"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, code, nom, categorie, corps, actif, cree_le, modifie_le FROM modeles_actes ORDER BY categorie, nom"
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/actes/modeles  { code, nom, categorie, corps }
router.post("/modeles", requirePermission("actes.modeles.gerer"), async (req, res) => {
  const b = req.body || {};
  if (!b.code || !b.nom || !b.corps) return res.status(400).json({ error: "code, nom et corps requis" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO modeles_actes (code, nom, categorie, corps, cree_par)
       VALUES ($1,$2,COALESCE($3::categorie_document,'autre'),$4,$5)
       RETURNING id, code, nom, categorie, corps, actif`,
      [b.code, b.nom, b.categorie || null, b.corps, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Ce code de modèle existe déjà" });
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/actes/modeles/:id  { nom?, categorie?, corps?, actif? }
router.put("/modeles/:id", requirePermission("actes.modeles.gerer"), async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE modeles_actes
       SET nom = COALESCE($1, nom), categorie = COALESCE($2::categorie_document, categorie),
           corps = COALESCE($3, corps), actif = COALESCE($4, actif), modifie_le = now()
       WHERE id = $5
       RETURNING id, code, nom, categorie, corps, actif`,
      [b.nom ?? null, b.categorie ?? null, b.corps ?? null, b.actif ?? null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Modèle introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/actes/modeles/:id — désactivation (actif=FALSE), jamais de
// suppression définitive : un modèle déjà utilisé reste identifiable dans
// l'historique (documents.nom le cite en texte, pas de FK).
router.delete("/modeles/:id", requirePermission("actes.modeles.gerer"), async (req, res) => {
  try {
    const { rowCount } = await pool.query("UPDATE modeles_actes SET actif = FALSE, modifie_le = now() WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Modèle introuvable" });
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

async function construireContexte(dossierId, avocatNom) {
  const d = await pool.query(
    `SELECT d.*, COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client_nom
     FROM dossiers d JOIN clients c ON c.id = d.client_id WHERE d.id = $1`,
    [dossierId]
  );
  if (!d.rows[0]) return null;
  const dossier = d.rows[0];
  const partie = await pool.query(
    `SELECT denomination FROM dossier_parties WHERE dossier_id = $1 AND role = 'adverse' LIMIT 1`,
    [dossierId]
  );
  const cab = await pool.query("SELECT * FROM parametres_cabinet WHERE id = 1");
  return {
    date: fmtDate(new Date()),
    client: dossier.client_nom,
    partieAdverse: partie.rows[0]?.denomination || null,
    dossier,
    cabinet: cab.rows[0] || {},
    avocat: avocatNom,
  };
}

// Aplatit le contexte imbriqué (dossier.*, cabinet.*) en un dictionnaire à
// plat de placeholders {{...}} pour les modèles stockés en base — les
// replis (ex. « à convenir », « Avocat au Barreau du Mali ») reproduisent
// ceux des anciens modèles codés en dur, simplifiés en un seul repli par
// champ (ces modèles sont désormais éditables par le cabinet lui-même,
// pas besoin d'une fidélité byte à byte à l'ancien code).
function applatirContexte(ctx) {
  const d = ctx.dossier || {};
  const cab = ctx.cabinet || {};
  return {
    date: ctx.date,
    client: ctx.client || "",
    partie_adverse: ctx.partieAdverse || "—",
    destinataire: ctx.partieAdverse || ctx.client || "",
    dossier_numero: d.numero || "",
    dossier_intitule: d.intitule || "",
    dossier_objet: d.objet || "",
    dossier_objet_ou_intitule: d.objet || d.intitule || "",
    dossier_juridiction: d.juridiction || "—",
    dossier_mode_honoraires: d.mode_honoraires || "à convenir",
    avocat: ctx.avocat || "",
    cabinet_raison_sociale: cab.raison_sociale || "",
    cabinet_forme: cab.forme || "Avocat au Barreau du Mali",
    cabinet_adresse: cab.adresse || "",
    cabinet_telephone: cab.telephone || "",
    cabinet_email: cab.email || "",
    cabinet_rccm: cab.rccm || "—",
    cabinet_nif: cab.nif || "—",
    cabinet_compte_carpa: cab.compte_carpa || "—",
  };
}

// Substitution simple {{cle}} -> valeur — pas de moteur de template
// externe (cohérent avec le reste du projet, aucune nouvelle dépendance).
// Un placeholder inconnu est laissé tel quel plutôt que silencieusement
// vidé, pour rester visible et corrigible par l'auteur du modèle.
function fusionner(corps, plat) {
  return corps.replace(/\{\{(\w+)\}\}/g, (m, cle) => (cle in plat ? String(plat[cle]) : m));
}

// POST /api/actes/generer
// { dossier_id, mode: 'modele'|'ia', modele_code?, instructions_ia? }
router.post("/generer", requirePermission("actes.generer"), async (req, res) => {
  const b = req.body || {};
  if (!b.dossier_id) return res.status(400).json({ error: "dossier_id requis" });
  try {
    const avocat = await pool.query("SELECT prenom || ' ' || nom AS nom FROM utilisateurs WHERE id = $1", [req.user.sub]);
    const ctx = await construireContexte(b.dossier_id, avocat.rows[0]?.nom || "");
    if (!ctx) return res.status(404).json({ error: "Dossier introuvable" });

    let texte, nom, categorie;
    if (b.mode === "ia") {
      if (!b.instructions_ia) return res.status(400).json({ error: "instructions_ia requis en mode IA" });
      const instruction =
        "Tu es un assistant juridique pour un cabinet d'avocats au Mali (droit national et OHADA). " +
        "Rédige un projet d'acte en français, professionnel et sobre, sur la base des instructions et du contexte " +
        "du dossier fournis. N'invente aucun fait non mentionné. Termine impérativement par la mention : " +
        "« Projet à valider par l'avocat. »";
      const contexte =
        `Cabinet : ${ctx.cabinet.raison_sociale || ""}\n` +
        `Dossier : ${ctx.dossier.numero} — ${ctx.dossier.intitule}\nObjet : ${ctx.dossier.objet || "—"}\n` +
        `Client : ${ctx.client}\nPartie adverse : ${ctx.partieAdverse || "—"}\n\nInstructions : ${b.instructions_ia}`;
      texte = await generer(instruction, contexte);
      nom = `IA — ${b.instructions_ia.slice(0, 60)}`;
      categorie = "note_interne";
    } else {
      const { rows: [modele] } = await pool.query(
        "SELECT nom, categorie, corps FROM modeles_actes WHERE code = $1 AND actif = TRUE",
        [b.modele_code]
      );
      if (!modele) return res.status(400).json({ error: "Modèle inconnu ou désactivé" });
      texte = fusionner(modele.corps, applatirContexte(ctx));
      nom = `${modele.nom} — ${ctx.dossier.numero}`;
      categorie = modele.categorie;
    }

    const dest = `${b.dossier_id}/${Date.now()}_${nom}.txt`.replace(/\s+/g, "_");
    const chemin = await saveObject(Buffer.from(texte, "utf-8"), dest, "text/plain");
    const ins = await pool.query(
      `INSERT INTO documents (dossier_id, nom, categorie, statut, chemin_storage, type_mime, taille_octets, auteur_id, ocr_texte)
       VALUES ($1,$2,$3,'brouillon',$4,'text/plain',$5,$6,$7)
       RETURNING id, nom, categorie, statut, version, cree_le`,
      [b.dossier_id, nom, categorie, chemin, Buffer.byteLength(texte, "utf-8"), req.user.sub, texte]
    );
    res.status(201).json({ ...ins.rows[0], texte });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/actes/:id  { texte } — édition du brouillon (13/09/2026, gap
// comblé : jusqu'ici rien ne modifiait jamais un document après création).
// Réservée aux actes texte générés par ce module (type_mime='text/plain')
// — pas aux pièces déposées/scannées, où « éditer le texte » n'aurait pas
// de sens (le fichier physique n'est pas un texte à réécrire).
router.put("/:id", requirePermission("actes.generer"), async (req, res) => {
  const texte = req.body?.texte;
  if (typeof texte !== "string" || !texte.trim()) return res.status(400).json({ error: "texte requis" });
  try {
    const { rows: [doc] } = await pool.query("SELECT * FROM documents WHERE id = $1", [req.params.id]);
    if (!doc) return res.status(404).json({ error: "Acte introuvable" });
    if (doc.type_mime !== "text/plain") {
      return res.status(400).json({ error: "Cette action ne s'applique qu'aux actes texte générés par l'Atelier d'actes." });
    }
    const dest = `${doc.dossier_id}/${Date.now()}_v${doc.version + 1}_${doc.nom}.txt`.replace(/\s+/g, "_");
    const chemin = await saveObject(Buffer.from(texte, "utf-8"), dest, "text/plain");
    const { rows } = await pool.query(
      `UPDATE documents
       SET ocr_texte = $1, chemin_storage = $2, taille_octets = $3, version = version + 1,
           modifie_le = now(), modifie_par = $4
       WHERE id = $5
       RETURNING id, nom, categorie, statut, version, modifie_le`,
      [texte, chemin, Buffer.byteLength(texte, "utf-8"), req.user.sub, req.params.id]
    );
    res.json({ ...rows[0], texte });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/actes/:id/statut  { statut: 'brouillon'|'valide' }
router.post("/:id/statut", requirePermission("actes.generer"), async (req, res) => {
  const statut = req.body?.statut;
  if (!["brouillon", "valide"].includes(statut)) return res.status(400).json({ error: "statut invalide" });
  try {
    const { rows } = await pool.query(
      `UPDATE documents SET statut = $1::statut_document
       WHERE id = $2 AND type_mime = 'text/plain'
       RETURNING id, nom, statut`,
      [statut, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Acte introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/actes/:id/pdf — rendu imprimable du texte courant (jamais
// persisté, régénéré à chaque téléchargement — voir actePdf.js).
router.get("/:id/pdf", requirePermission("actes.consulter"), async (req, res) => {
  try {
    const trouve = await envoyerActePdf(pool, req.params.id, res);
    if (!trouve) res.status(404).json({ error: "Acte introuvable" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
module.exports.applatirContexte = applatirContexte;
module.exports.fusionner = fusionner;
