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
const { estDocumentVisible, chargerContexteDossier } = require("../confidentialiteDocuments");
const {
  BALISES, A_COMPLETER, libelleStatutPartie, libelleDegre, fmtDate, ou, jointureEt,
  dateLongue, naissance, filiation, representant, identification, depuisClient, depuisPartie, CIVILITES,
} = require("../balisesActes");
const { selectChamps, CHAMPS_CLIENT, CHAMPS_PARTIE } = require("../identiteActes");
const router = express.Router();

// Audit du 03/10/2026 : GET /:id/pdf, PUT /:id et POST /:id/statut
// chargeaient jusqu'ici un `documents` par id brut sans jamais appliquer
// documents.confidentialite (mécanisme posé le 28/09/2026 pour /api/
// documents/:id/download) — n'importe quel titulaire de actes.consulter/
// actes.generer (permissions très largement accordées) pouvait donc lire,
// modifier ou changer le statut de n'importe quel document texte brut de
// la GED, y compris un .txt téléversé en confidentialite='restreint'.
// Factorisé ici plutôt que dupliqué 3 fois.
async function verifierAccesDocument(dossierId, confidentialite, user) {
  const contexte = await chargerContexteDossier(pool, dossierId);
  return estDocumentVisible(confidentialite, contexte, user, false);
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

// GET /api/actes/balises — catalogue des balises {{cle}} utilisables dans un
// modèle (aide de l'écran de gestion ; source unique : balisesActes.js).
router.get("/balises", requirePermission("actes.consulter"), (req, res) => {
  res.json(BALISES);
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

async function construireContexte(dossierId, avocatNom, avocatFiche) {
  const d = await pool.query(
    `SELECT d.*, COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client_nom,
            c.type AS c_type, c.denomination AS c_denomination, c.forme_juridique AS c_forme_juridique,
            c.rccm AS c_rccm, c.nif AS c_nif, c.prenom AS c_prenom, c.nom AS c_nom,
            c.nationalite AS c_nationalite, c.adresse AS c_adresse, c.ville AS c_ville, c.pays AS c_pays,
            c.email AS c_email, c.telephone AS c_telephone,
            ${selectChamps(CHAMPS_CLIENT, "c", "c_")},
            COALESCE(r.prenom || ' ' || r.nom, '') AS responsable_nom
     FROM dossiers d
     JOIN clients c ON c.id = d.client_id
     LEFT JOIN utilisateurs r ON r.id = d.responsable_id
     WHERE d.id = $1`,
    [dossierId]
  );
  if (!d.rows[0]) return null;
  const dossier = d.rows[0];
  const parties = await pool.query(
    `SELECT denomination, conseil, ${selectChamps(CHAMPS_PARTIE)} FROM dossier_parties WHERE dossier_id = $1 AND role = 'adverse' ORDER BY cree_le, id`,
    [dossierId]
  );
  const cab = await pool.query("SELECT * FROM parametres_cabinet WHERE id = 1");
  // Instance la plus récente : même tri que instanceActuelle.js (fiche dossier, Rôle d'audience).
  const inst = await pool.query(
    `SELECT degre, juridiction, numero_role, date_debut, statut_partie, statut_partie_precision
     FROM instances WHERE dossier_id = $1 ORDER BY date_debut DESC NULLS LAST, cree_le DESC LIMIT 1`,
    [dossierId]
  );
  const aud = await pool.query(
    `SELECT date_audience, juridiction FROM audiences
     WHERE dossier_id = $1 AND resultat IS NULL AND date_audience >= current_date
     ORDER BY date_audience LIMIT 1`,
    [dossierId]
  );
  return {
    date: fmtDate(new Date()),
    client: dossier.client_nom,
    partieAdverse: parties.rows[0]?.denomination || null,
    partiesAdverses: parties.rows.map((p) => p.denomination),
    partiesAdversesFiches: parties.rows.map(depuisPartie),
    conseilAdverse: parties.rows[0]?.conseil || null,
    conseilAdverseAdresse: parties.rows[0]?.conseil_adresse || null,
    clientFiche: depuisClient({
      type: dossier.c_type, denomination: dossier.c_denomination, forme_juridique: dossier.c_forme_juridique,
      rccm: dossier.c_rccm, nif: dossier.c_nif, prenom: dossier.c_prenom, nom: dossier.c_nom,
      nationalite: dossier.c_nationalite, adresse: dossier.c_adresse, ville: dossier.c_ville, pays: dossier.c_pays,
      email: dossier.c_email, telephone: dossier.c_telephone,
      ...Object.fromEntries(CHAMPS_CLIENT.map(([col]) => [col, dossier[`c_${col}`]])),
    }),
    instance: inst.rows[0] || null,
    prochaineAudience: aud.rows[0] || null,
    responsable: dossier.responsable_nom || "",
    dossier,
    cabinet: cab.rows[0] || {},
    avocat: avocatNom,
    avocatFiche: avocatFiche || { titre: null, code: null },
  };
}

// Aplatit le contexte imbriqué (dossier.*, cabinet.*) en un dictionnaire à
// plat de placeholders {{...}} pour les modèles stockés en base — les
// replis (ex. « à convenir », « Avocat au Barreau du Mali ») reproduisent
// ceux des anciens modèles codés en dur, simplifiés en un seul repli par
// champ (ces modèles sont désormais éditables par le cabinet lui-même,
// pas besoin d'une fidélité byte à byte à l'ancien code).
// Enrichi le 27/10/2026 : client complet, parties adverses, instance en cours,
// prochaine audience (catalogue : balisesActes.js).
function applatirContexte(ctx) {
  const d = ctx.dossier || {};
  const cab = ctx.cabinet || {};
  const c = ctx.clientFiche || null;
  const inst = ctx.instance || null;
  const aud = ctx.prochaineAudience || null;
  const adverses = ctx.partiesAdverses || (ctx.partieAdverse ? [ctx.partieAdverse] : []);
  const fiches = ctx.partiesAdversesFiches || adverses.map((denomination) => depuisPartie({ denomination }));
  const av = ctx.avocatFiche || {};
  return {
    date: ctx.date,
    client: ctx.client || "",
    client_type: c ? (c.type === "morale" ? "personne morale" : "personne physique") : A_COMPLETER,
    client_forme_juridique: ou(c && c.forme_juridique),
    client_rccm: ou(c && c.rccm),
    client_nif: ou(c && c.nif),
    client_adresse: ou(c && c.adresse),
    client_ville: ou(c && c.ville),
    client_pays: ou(c && c.pays),
    client_nationalite: ou(c && c.nationalite),
    client_email: ou(c && c.email),
    client_telephone: ou(c && c.telephone),
    client_civilite: ou(c && CIVILITES[c.civilite]),
    client_date_naissance: c && c.date_naissance ? dateLongue(c.date_naissance) : A_COMPLETER,
    client_lieu_naissance: ou(c && c.lieu_naissance),
    client_naissance: (c && naissance(c)) || A_COMPLETER,
    client_filiation: (c && filiation(c)) || A_COMPLETER,
    client_profession: ou(c && c.profession),
    client_capital_social: ou(c && c.capital_social),
    client_representant: (c && representant(c)) || A_COMPLETER,
    client_boite_postale: ou(c && c.boite_postale),
    client_droit_applicable: ou(c && c.droit_applicable),
    client_identification: identification(c) || ctx.client || A_COMPLETER,
    partie_adverse: ctx.partieAdverse || "—",
    partie_adverse_identification: fiches[0] ? identification(fiches[0]) : "—",
    parties_adverses_identification: fiches.length ? fiches.map(identification).join("\n") : "—",
    conseil_adverse_adresse: ctx.conseilAdverseAdresse || "—",
    parties_adverses: jointureEt(adverses) || "—",
    conseil_adverse: ctx.conseilAdverse || "—",
    destinataire: ctx.partieAdverse || ctx.client || "",
    instance_degre: inst ? libelleDegre(inst.degre) : A_COMPLETER,
    instance_juridiction: ou((inst && inst.juridiction) || d.juridiction),
    instance_numero_role: ou((inst && inst.numero_role) || d.numero_role),
    instance_date_debut: inst && inst.date_debut ? fmtDate(inst.date_debut) : A_COMPLETER,
    client_qualite: inst && inst.statut_partie
      ? libelleStatutPartie(inst.statut_partie, inst.degre, inst.statut_partie_precision)
      : A_COMPLETER,
    audience_prochaine_date: aud ? fmtDate(aud.date_audience) : A_COMPLETER,
    audience_prochaine_juridiction: ou(aud && (aud.juridiction || (inst && inst.juridiction) || d.juridiction)),
    dossier_numero: d.numero || "",
    dossier_intitule: d.intitule || "",
    dossier_objet: d.objet || "",
    dossier_objet_ou_intitule: d.objet || d.intitule || "",
    dossier_juridiction: d.juridiction || "—",
    dossier_pole: d.pole === "conseil" ? "conseil" : d.pole === "contentieux" ? "contentieux" : "",
    dossier_montant_litige: d.montant_litige ? `${Number(d.montant_litige).toLocaleString("fr-FR")} FCFA` : A_COMPLETER,
    dossier_date_ouverture: d.date_ouverture_origine || d.date_ouverture ? fmtDate(d.date_ouverture_origine || d.date_ouverture) : A_COMPLETER,
    dossier_responsable: ctx.responsable || A_COMPLETER,
    dossier_mode_honoraires: d.mode_honoraires || "à convenir",
    dossier_montant_convenu: d.montant_convenu_xof ? `${Number(d.montant_convenu_xof).toLocaleString("fr-FR")} FCFA` : "à convenir",
    avocat: ctx.avocat || "",
    avocat_titre: av.titre || "Avocat au Barreau du Mali",
    avocat_initiales: av.code ? String(av.code).toUpperCase() : A_COMPLETER,
    avocat_identification: [ctx.avocat, av.titre || "Avocat au Barreau du Mali"].filter(Boolean).join(", "),
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
    const avocat = await pool.query("SELECT prenom || ' ' || nom AS nom, titre_avocat AS titre, code FROM utilisateurs WHERE id = $1", [req.user.sub]);
    const ctx = await construireContexte(b.dossier_id, avocat.rows[0]?.nom || "", avocat.rows[0]);
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
    if (!(await verifierAccesDocument(doc.dossier_id, doc.confidentialite, req.user))) {
      return res.status(403).json({ error: "Accès refusé (document à confidentialité restreinte)" });
    }
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
    const { rows: [doc] } = await pool.query(
      "SELECT dossier_id, confidentialite, type_mime FROM documents WHERE id = $1",
      [req.params.id]
    );
    if (!doc) return res.status(404).json({ error: "Acte introuvable" });
    if (!(await verifierAccesDocument(doc.dossier_id, doc.confidentialite, req.user))) {
      return res.status(403).json({ error: "Accès refusé (document à confidentialité restreinte)" });
    }
    if (doc.type_mime !== "text/plain") return res.status(404).json({ error: "Acte introuvable" });
    const { rows } = await pool.query(
      `UPDATE documents SET statut = $1::statut_document
       WHERE id = $2 AND type_mime = 'text/plain'
       RETURNING id, nom, statut`,
      [statut, req.params.id]
    );
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
    const { rows: [doc] } = await pool.query(
      "SELECT dossier_id, confidentialite FROM documents WHERE id = $1",
      [req.params.id]
    );
    if (!doc) return res.status(404).json({ error: "Acte introuvable" });
    if (!(await verifierAccesDocument(doc.dossier_id, doc.confidentialite, req.user))) {
      return res.status(403).json({ error: "Accès refusé (document à confidentialité restreinte)" });
    }
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
module.exports.construireContexte = construireContexte;
