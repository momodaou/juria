// JURIA — Registre du courrier (arrivée/départ), référencement automatique,
// et déclenchement d'événements/diligences/tâches à partir de la nature du courrier.
const express = require("express");
const multer = require("multer");
const { pool } = require("../db");
const { saveObject, readObject, deleteObject, FichierIntrouvableError, enteteContentDisposition } = require("../storage");
const { filtreTypeFichier } = require("../uploadFilter");
const { requirePermission } = require("../permissions");
const { logAudit } = require("../audit");
const router = express.Router();

// 15/10/2026 — même liste que ROLES_AVOCAT dans dossiers.js (dupliquée
// ici, convention déjà suivie dans ce projet pour ce genre de petite
// constante plutôt qu'un module partagé) : seul un avocat peut "viser"
// un courrier (voir POST /:id/viser).
const { genererReference } = require("../referenceCourrier");
const ROLES_AVOCAT = ["associe", "associe_fondateur", "of_counsel", "avocat_stagiaire", "collaborateur"];

// 17/10/2026 — parcours « acte reçu sans dossier » : l'assistante enregistre avec
// le DESTINATAIRE avocat (jamais d'imputation à ce stade) ; le destinataire ou
// un associé ORIENTE (dossier existant / créé / sans suite) puis IMPUTE à un
// collaborateur, avec instructions. Les collaborateurs imputables sont ceux
// désignés par l'utilisateur (juristes, avocats stagiaires, stagiaires).
const ROLES_ASSOCIE = ["associe", "associe_fondateur"];
const ROLES_IMPUTABLES = ["avocat_stagiaire", "juriste", "stagiaire"];
const TYPES_SENSIBLES = ["assignation", "requete"];

// Fragment SQL de visibilité : tant qu'un acte sensible reçu n'est pas
// orienté, il n'est visible que de son destinataire, de celui qui l'a
// enregistré et des associés (jamais des autres profils).
function filtreVisibilite(user, params) {
  if (ROLES_ASSOCIE.includes(user.role)) return null;
  params.push(user.sub);
  const n = params.length;
  return `(NOT (c.sens = 'arrivee' AND c.orientation = 'a_orienter' AND c.type::text = ANY(ARRAY['assignation','requete']))
           OR c.recu_par = $${n}::uuid OR c.destinataire_id = $${n}::uuid)`;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 Mo, même limite que documents.js
  fileFilter: filtreTypeFichier,
});

// Classe un fichier dans la GED d'un dossier (categorie "correspondance") —
// extrait le 14/10/2026 du corps de POST /:id/document pour être réutilisé
// à la fois au dépôt direct (courrier déjà rattaché à un dossier) et à la
// migration automatique d'un fichier déposé avant que le dossier n'existe
// (voir PUT /:id plus bas). Retourne l'id du document créé.
async function classerDansGed(poolOuClient, dossierId, nom, buffer, mimetype, taille, auteurId) {
  const v = await poolOuClient.query(
    "SELECT COALESCE(MAX(version), 0) + 1 AS v FROM documents WHERE dossier_id = $1 AND nom = $2",
    [dossierId, nom]
  );
  const dest = `${dossierId}/${Date.now()}_${nom}`.replace(/\s+/g, "_");
  const chemin = await saveObject(buffer, dest, mimetype);
  const doc = await poolOuClient.query(
    `INSERT INTO documents
       (dossier_id, nom, categorie, version, statut, confidentialite, chemin_storage, type_mime, taille_octets, auteur_id)
     VALUES ($1,$2,'correspondance',$3,'brouillon','dossier',$4,$5,$6,$7)
     RETURNING id`,
    [dossierId, nom, v.rows[0].v, chemin, mimetype, taille, auteurId]
  );
  return doc.rows[0].id;
}

// Applique les déclencheurs configurés (type_courrier -> événement/diligence/tâche suggéré).
async function appliquerDeclencheurs(client, courrier, utilisateurId) {
  if (!courrier.dossier_id) return null;
  const { rows } = await client.query(
    `SELECT * FROM declencheurs WHERE source_domaine = 'type_courrier' AND source_code = $1 AND actif = TRUE`,
    [courrier.type]
  );
  if (!rows[0]) return null;
  const decl = rows[0];
  const responsable = courrier.imputation_id || courrier.destinataire_id || utilisateurId;

  if (decl.type_evenement === "diligence") {
    const dateDiligence = decl.delai_jours
      ? new Date(new Date(courrier.date_courrier).getTime() + decl.delai_jours * 86400000)
      : new Date(courrier.date_courrier);
    const ins = await client.query(
      `INSERT INTO diligences (type_diligence, dossier_id, membre_id, date_diligence, objet, courrier_id, cree_par)
       VALUES ('diligence',$1,$2,$3,$4,$5,$6) RETURNING id, objet, date_diligence`,
      [courrier.dossier_id, responsable, dateDiligence.toISOString().slice(0, 10), decl.libelle_suggere, courrier.id, utilisateurId]
    );
    return { type: "diligence", ...ins.rows[0] };
  }

  if (decl.delai_jours) {
    const typeMap = { audience: "audience", delai: "delai_procedure", echeance: "echeance_contractuelle" };
    const dateEcheance = new Date(new Date(courrier.date_courrier).getTime() + decl.delai_jours * 86400000);
    const ins = await client.query(
      `INSERT INTO evenements (dossier_id, type, titre, date_echeance, responsable_id, courrier_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, titre, date_echeance`,
      [courrier.dossier_id, typeMap[decl.type_evenement] || "depot", decl.libelle_suggere, dateEcheance, responsable, courrier.id]
    );
    return { type: "evenement", ...ins.rows[0] };
  }

  // Pas de délai calculable (ex. audience à date non fixée) -> tâche de suivi.
  const ins = await client.query(
    `INSERT INTO taches (dossier_id, titre, responsable_id, echeance, cree_par, courrier_id, courrier_etape)
     VALUES ($1,$2,$3,$4,$5,$6,'declencheur') RETURNING id, titre, echeance`,
    [courrier.dossier_id, decl.libelle_suggere, responsable, courrier.date_courrier, utilisateurId, courrier.id]
  );
  return { type: "tache", ...ins.rows[0] };
}

// Déclencheurs rattrapés au RATTACHEMENT d'un dossier (17/10/2026) : un acte
// reçu avant que le dossier n'existe n'avait jamais ses rappels (assignation →
// audience, acte d'huissier → délai…), ceux-ci ne s'appliquant qu'à
// l'enregistrement. Idempotent : rien n'est recréé si un déclencheur a déjà
// produit un événement, une diligence ou une tâche pour ce courrier.
async function declencherSiAbsent(client, courrier, utilisateurId) {
  if (!courrier.dossier_id) return null;
  const deja = await client.query(
    `SELECT (SELECT count(*) FROM evenements WHERE courrier_id = $1)
          + (SELECT count(*) FROM diligences WHERE courrier_id = $1)
          + (SELECT count(*) FROM taches WHERE courrier_id = $1 AND courrier_etape = 'declencheur') AS n`, [courrier.id]);
  if (Number(deja.rows[0].n) > 0) return null;
  const c = { ...courrier, imputation_id: courrier.imputation_id || courrier.destinataire_id };
  return appliquerDeclencheurs(client, c, utilisateurId);
}

// Après rattachement d'un dossier : l'orientation « à orienter » devient
// « rattaché », la tâche de rappel « orienter » est clôturée et les
// déclencheurs sont rattrapés.
async function apresRattachement(client, courrier, utilisateurId, orientation = "rattache") {
  if (courrier.orientation === "a_orienter") {
    await client.query(
      `UPDATE courriers SET orientation = $1, oriente_par = $2, oriente_le = now() WHERE id = $3`,
      [orientation, utilisateurId, courrier.id]);
    await client.query(
      `UPDATE taches SET statut = 'termine' WHERE courrier_id = $1 AND courrier_etape = 'orienter' AND statut NOT IN ('termine','annule')`,
      [courrier.id]);
  }
  return declencherSiAbsent(client, courrier, utilisateurId);
}

// GET /api/courriers?sens=&type=&dossier_id=&statut=&q=&en_attente_numerisation=true
router.get("/", requirePermission("courriers.consulter"), async (req, res) => {
  const { sens, type, dossier_id, statut, q, en_attente_numerisation, mes, orientation } = req.query;
  const params = [];
  const clauses = [];
  const vis = filtreVisibilite(req.user, params);
  if (vis) clauses.push(vis);
  if (orientation) { params.push(orientation); clauses.push(`c.orientation = $${params.length}`); }
  // « Mes courriers » : ceux dont je suis le destinataire ou l'imputé.
  if (mes === "true") { params.push(req.user.sub); clauses.push(`(c.destinataire_id = $${params.length}::uuid OR c.imputation_id = $${params.length}::uuid)`); }
  if (sens) { params.push(sens); clauses.push(`c.sens = $${params.length}`); }
  // 24/09/2026 — gap signalé par l'utilisateur : aucun filtre par type de
  // courrier, seulement par sens + recherche libre.
  if (type) { params.push(type); clauses.push(`c.type = $${params.length}`); }
  if (dossier_id) { params.push(dossier_id); clauses.push(`c.dossier_id = $${params.length}`); }
  if (statut) { params.push(statut); clauses.push(`c.statut = $${params.length}`); }
  if (q) { params.push(`%${q}%`); clauses.push(`(c.correspondant ILIKE $${params.length} OR c.objet ILIKE $${params.length} OR c.reference ILIKE $${params.length})`); }
  // 15/10/2026 — Q3 : file de travail "papier reçu, pas encore numérisé"
  // pour l'accueil (a_numeriser posé à la création, numerise désormais
  // mis à jour réellement — voir POST /:id/document et PUT /:id).
  if (en_attente_numerisation === "true") { clauses.push(`c.a_numeriser = TRUE AND c.numerise = FALSE`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.reference, c.sens, c.type, c.type_precision, c.date_courrier, c.correspondant, c.objet,
              c.support, c.statut, c.a_numeriser, c.numerise, c.dossier_id, c.document_id,
              c.fichier_brut_nom, c.imputation_id, c.transmis_par, c.transmis_le, c.vise_par, c.vise_le,
              c.expedie_par, c.expedie_le, c.destinataire_id, c.orientation, c.orientation_motif, c.instructions_imputation, c.recu_par,
              dest.prenom || ' ' || dest.nom AS destinataire_nom,
              d.numero AS dossier_numero, u.prenom || ' ' || u.nom AS impute_a,
              t.prenom || ' ' || t.nom AS transmis_par_nom, v.prenom || ' ' || v.nom AS vise_par_nom
       FROM courriers c
       LEFT JOIN dossiers d ON d.id = c.dossier_id
       LEFT JOIN utilisateurs u ON u.id = c.imputation_id
       LEFT JOIN utilisateurs t ON t.id = c.transmis_par
       LEFT JOIN utilisateurs v ON v.id = c.vise_par
       LEFT JOIN utilisateurs dest ON dest.id = c.destinataire_id
       ${where}
       ORDER BY c.date_courrier DESC, c.cree_le DESC LIMIT 300`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/courriers/:id
// 28/09/2026 — audit menu par menu (suite de l'audit systématique des
// routes GET) : cette route n'avait AUCUNE garde, contournant
// `courriers.consulter` (marquée restreinte) posée sur `GET /` — n'importe
// quel utilisateur authentifié pouvait lire n'importe quel courrier par id
// direct. Alignée sur la même permission que la liste.
router.get("/:id", requirePermission("courriers.consulter"), async (req, res) => {
  try {
    const params = [req.params.id];
    const vis = filtreVisibilite(req.user, params);
    const { rows } = await pool.query(
      `SELECT c.*, d.numero AS dossier_numero, u.prenom || ' ' || u.nom AS impute_a,
              t.prenom || ' ' || t.nom AS transmis_par_nom, v.prenom || ' ' || v.nom AS vise_par_nom
       FROM courriers c
       LEFT JOIN dossiers d ON d.id = c.dossier_id
       LEFT JOIN utilisateurs u ON u.id = c.imputation_id
       LEFT JOIN utilisateurs t ON t.id = c.transmis_par
       LEFT JOIN utilisateurs v ON v.id = c.vise_par
       WHERE c.id = $1${vis ? " AND " + vis : ""}`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: "Courrier introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/courriers
// body : { sens, type, type_precision?, date_courrier?, acteur_type?, correspondant, objet?, dossier_id?, support?, imputation_id? }
router.post("/", requirePermission("courriers.creer"), async (req, res) => {
  const b = req.body || {};
  if (!b.sens || !b.type) return res.status(400).json({ error: "sens et type requis" });
  // Acte reçu SANS dossier : le destinataire (avocat) est obligatoire — c'est
  // lui qui orientera. Le dossier reste facultatif à l'enregistrement.
  const sansDossierArrivee = b.sens === "arrivee" && !b.dossier_id;
  if (sansDossierArrivee && !b.destinataire_id) {
    return res.status(400).json({ error: "Un courrier reçu sans dossier doit indiquer l'avocat destinataire (c'est lui qui l'orientera)." });
  }
  if (b.destinataire_id) {
    const d = await pool.query("SELECT role, actif FROM utilisateurs WHERE id = $1", [b.destinataire_id]);
    if (!d.rows[0] || !d.rows[0].actif || !ROLES_AVOCAT.includes(d.rows[0].role)) {
      return res.status(400).json({ error: "Le destinataire doit être un avocat actif." });
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const dateCourrier = b.date_courrier || new Date().toISOString().slice(0, 10);
    const reference = await genererReference(client, b.sens, dateCourrier);
    const ins = await client.query(
      `INSERT INTO courriers
         (reference, sens, type, type_precision, date_courrier, acteur_type, correspondant, objet,
          dossier_id, support, imputation_id, recu_par, cree_par,
          statut, a_numeriser, destinataire_id, orientation, transmis_par, transmis_le)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::support_courrier,'papier'),$11::uuid,$12,$12,
               (CASE WHEN $13::uuid IS NOT NULL THEN 'impute' ELSE 'recu' END)::statut_courrier, $14,
               $15::uuid, $16, (CASE WHEN $15::uuid IS NOT NULL THEN $12::uuid END),
               (CASE WHEN $15::uuid IS NOT NULL THEN now() END))
       RETURNING *`,
      [reference, b.sens, b.type, b.type_precision || null, dateCourrier, b.acteur_type || null, b.correspondant || null,
       b.objet || null, b.dossier_id || null, b.support, b.imputation_id || null, req.user.sub,
       b.imputation_id || null, b.support === "papier" || !b.support,
       b.destinataire_id || null, sansDossierArrivee ? "a_orienter" : null]
    );
    const courrier = ins.rows[0];
    const declenchement = await appliquerDeclencheurs(client, courrier, req.user.sub);
    // Rappel immédiat pour l'avocat destinataire : « orienter » l'acte reçu sans dossier.
    let rappel = null;
    if (courrier.orientation === "a_orienter") {
      const sensible = TYPES_SENSIBLES.includes(courrier.type);
      const delai = sensible ? 2 : 3;
      const t = await client.query(
        `INSERT INTO taches (dossier_id, titre, description, responsable_id, echeance, priorite, cree_par, courrier_id, courrier_etape)
         VALUES (NULL,$1,$2,$3,(current_date + $4::int),$5::priorite_tache,$6,$7,'orienter') RETURNING id, titre, echeance`,
        [`Orienter le courrier ${courrier.reference}${courrier.objet ? " — " + String(courrier.objet).slice(0, 80) : ""}`,
         "Acte reçu sans dossier : le rattacher à un dossier existant, créer le dossier, ou le classer sans suite.",
         courrier.destinataire_id, delai, sensible ? "haute" : "normale", req.user.sub, courrier.id]
      );
      rappel = t.rows[0];
    }
    await client.query("COMMIT");
    res.status(201).json({ ...courrier, declenchement, rappel });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// POST /api/courriers/:id/document  (multipart/form-data, champ "fichier")
// Joint le scan du courrier. Gap comblé le 11/09/2026 (document_id jamais
// renseigné), puis le 14/10/2026 (gap signalé par l'utilisateur : un
// courrier arrivé/sorti AVANT l'ouverture d'un dossier — le cas le plus
// courant pour une demande initiale — ne pouvait jamais être scanné, la
// GED exigeant un dossier dès le départ, documents.dossier_id NOT NULL).
// Un dossier déjà rattaché → classement direct dans la GED (comportement
// historique, via classerDansGed()). Pas encore de dossier → dépôt
// TEMPORAIRE sur le courrier lui-même (fichier_brut_*), migré
// automatiquement dans la GED dès qu'un dossier est rattaché (PUT /:id).
router.post("/:id/document", requirePermission("courriers.creer"), upload.single("fichier"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Fichier manquant" });
  try {
    const { rows } = await pool.query(
      "SELECT dossier_id, document_id, fichier_brut_chemin FROM courriers WHERE id = $1",
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Courrier introuvable" });
    if (rows[0].document_id || rows[0].fichier_brut_chemin) {
      return res.status(409).json({ error: "Une pièce est déjà jointe à ce courrier." });
    }
    const dossierId = rows[0].dossier_id;
    const nom = req.file.originalname;
    if (dossierId) {
      const docId = await classerDansGed(pool, dossierId, nom, req.file.buffer, req.file.mimetype, req.file.size, req.user.sub);
      // 15/10/2026 — Q3 : numerise reflète désormais la réalité ("rattaché
      // à la GED") plutôt que de rester une colonne morte jamais mise à
      // jour, sans action supplémentaire côté utilisateur.
      await pool.query("UPDATE courriers SET document_id = $1, numerise = TRUE WHERE id = $2", [docId, req.params.id]);
      return res.status(201).json({ document_id: docId, nom });
    }
    const dest = `courriers/${req.params.id}/${Date.now()}_${nom}`.replace(/\s+/g, "_");
    const chemin = await saveObject(req.file.buffer, dest, req.file.mimetype);
    await pool.query(
      `UPDATE courriers SET fichier_brut_chemin = $1, fichier_brut_nom = $2,
         fichier_brut_type_mime = $3, fichier_brut_taille = $4 WHERE id = $5`,
      [chemin, nom, req.file.mimetype, req.file.size, req.params.id]
    );
    res.status(201).json({ fichier_brut_nom: nom });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// GET /api/courriers/:id/fichier-brut — télécharge le fichier déposé AVANT
// qu'un dossier n'existe (voir POST /:id/document ci-dessus). Une fois un
// dossier rattaché, la pièce est migrée dans la GED (PUT /:id) et devient
// accessible comme tout document via GET /api/documents/:id/download —
// cette route-ci ne sert donc que pour la fenêtre "courrier sans dossier
// encore". Gardée par courriers.consulter (comme la liste elle-même) plutôt
// que par une confidentialité documentaire : pas encore un vrai document GED.
router.get("/:id/fichier-brut", requirePermission("courriers.consulter"), async (req, res) => {
  try {
    const fbParams = [req.params.id];
    const fbVis = filtreVisibilite(req.user, fbParams);
    const { rows } = await pool.query(
      `SELECT c.fichier_brut_nom, c.fichier_brut_type_mime, c.fichier_brut_chemin FROM courriers c WHERE c.id = $1${fbVis ? " AND " + fbVis : ""}`,
      fbParams
    );
    if (!rows[0] || !rows[0].fichier_brut_chemin) return res.status(404).json({ error: "Aucune pièce jointe pour ce courrier" });
    const buf = await readObject(rows[0].fichier_brut_chemin);
    res.setHeader("Content-Type", rows[0].fichier_brut_type_mime || "application/octet-stream");
    res.setHeader("Content-Disposition", enteteContentDisposition(rows[0].fichier_brut_nom));
    res.send(buf);
  } catch (e) {
    if (e instanceof FichierIntrouvableError) {
      return res.status(404).json({ error: "Fichier introuvable dans le stockage." });
    }
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /api/courriers/:id — corriger les champs de base d'un courrier déjà
// enregistré (28/09/2026, gap comblé — jusqu'ici seul le statut/imputation
// pouvaient évoluer, aucune route ne permettait de corriger une faute de
// frappe sur le correspondant/l'objet/le type/la date, ni de rattacher le
// courrier à un dossier après coup). Réutilise la même permission que
// l'évolution du statut (courriers.statut.modifier) plutôt qu'une nouvelle
// action dédiée : le même cercle (registre + direction/IT) qui fait
// avancer le cycle de vie d'un courrier peut aussi en corriger une erreur
// de saisie — cohérent avec l'économie de permissions déjà pratiquée
// ailleurs dans JURIA plutôt que de multiplier les actions cataloguées.
// La référence elle-même (générée, unique) n'est jamais modifiable ici.
// `imputation_id` accepté ici aussi (simple correction de donnée, sans
// toucher transmis_par/transmis_le — ces 2 colonnes de traçabilité restent
// l'exclusivité de la transition de statut ci-dessous, PUT /:id/statut).
// 14/10/2026 — si un dossier est (ou était déjà) rattaché ET qu'une pièce
// attend encore dans fichier_brut_* (déposée avant qu'aucun dossier
// n'existe, voir POST /:id/document), elle est migrée ici automatiquement
// dans la GED du dossier — jamais besoin de la retéléverser à la main.
router.put("/:id", requirePermission("courriers.statut.modifier"), async (req, res) => {
  const b = req.body || {};
  const client = await pool.connect();
  let ancienCheminBrut = null;
  try {
    await client.query("BEGIN");
    const avant = (await client.query("SELECT dossier_id, orientation FROM courriers WHERE id = $1 FOR UPDATE", [req.params.id])).rows[0] || {};
    const { rows } = await client.query(
      `UPDATE courriers SET
         correspondant = COALESCE($1, correspondant),
         objet = COALESCE($2, objet),
         type = COALESCE($3, type),
         date_courrier = COALESCE($4, date_courrier),
         acteur_type = COALESCE($5, acteur_type),
         dossier_id = COALESCE($6::uuid, dossier_id),
         imputation_id = COALESCE($7::uuid, imputation_id),
         type_precision = COALESCE($9, type_precision)
       WHERE id = $8
       RETURNING id, reference, correspondant, objet, type, type_precision, date_courrier, acteur_type,
                 dossier_id, imputation_id, document_id, fichier_brut_chemin, fichier_brut_nom,
                 fichier_brut_type_mime, fichier_brut_taille`,
      [b.correspondant || null, b.objet || null, b.type || null, b.date_courrier || null,
       b.acteur_type || null, b.dossier_id || null, b.imputation_id || null, req.params.id,
       b.type_precision || null]
    );
    if (!rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Courrier introuvable" }); }
    const c = rows[0];
    // Rattachement d'un dossier APRÈS COUP : orientation + déclencheurs rattrapés.
    if (!avant.dossier_id && c.dossier_id) {
      const full = (await client.query("SELECT * FROM courriers WHERE id = $1", [req.params.id])).rows[0];
      await apresRattachement(client, { ...full, orientation: avant.orientation }, req.user.sub);
    }
    if (c.dossier_id && c.fichier_brut_chemin && !c.document_id) {
      const buf = await readObject(c.fichier_brut_chemin);
      const docId = await classerDansGed(
        client, c.dossier_id, c.fichier_brut_nom, buf, c.fichier_brut_type_mime, c.fichier_brut_taille, req.user.sub
      );
      await client.query(
        `UPDATE courriers SET document_id = $1, numerise = TRUE, fichier_brut_chemin = NULL, fichier_brut_nom = NULL,
           fichier_brut_type_mime = NULL, fichier_brut_taille = NULL WHERE id = $2`,
        [docId, req.params.id]
      );
      ancienCheminBrut = c.fichier_brut_chemin;
      c.document_id = docId;
      c.fichier_brut_chemin = null; c.fichier_brut_nom = null; c.fichier_brut_type_mime = null; c.fichier_brut_taille = null;
    }
    await client.query("COMMIT");
    if (ancienCheminBrut) await deleteObject(ancienCheminBrut);
    res.json(c);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// PUT /api/courriers/:id/statut  { statut, imputation_id? }
router.put("/:id/statut", requirePermission("courriers.statut.modifier"), async (req, res) => {
  const { statut, imputation_id } = req.body || {};
  const permis = ["recu", "impute", "en_traitement", "traite", "expedie"];
  if (!permis.includes(statut)) return res.status(400).json({ error: "Statut invalide" });
  const estImpute = statut === "impute";
  // 15/10/2026 — Q4 (confirmé) : trace symétrique de l'envoi effectif
  // côté départ, même mécanisme que transmis_par/transmis_le côté arrivée.
  const estExpedie = statut === "expedie";
  try {
    const { rows } = await pool.query(
      `UPDATE courriers SET
         statut = $1::statut_courrier,
         imputation_id = COALESCE($2, imputation_id),
         transmis_par = CASE WHEN $5 THEN $3 ELSE transmis_par END,
         transmis_le = CASE WHEN $5 THEN now() ELSE transmis_le END,
         expedie_par = CASE WHEN $6 THEN $3 ELSE expedie_par END,
         expedie_le = CASE WHEN $6 THEN now() ELSE expedie_le END
       WHERE id = $4
       RETURNING id, statut, imputation_id`,
      [statut, imputation_id || null, req.user.sub, req.params.id, estImpute, estExpedie]
    );
    if (!rows[0]) return res.status(404).json({ error: "Courrier introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/courriers/:id/orienter  { decision: 'rattache'|'cree'|'sans_suite', dossier_id?, motif? }
// L'avocat destinataire (ou n'importe quel associé) décide du sort d'un acte
// reçu sans dossier : le rattacher à un dossier existant, indiquer le dossier
// qu'il vient de créer, ou le classer sans suite (motif obligatoire).
router.post("/:id/orienter", requirePermission("courriers.consulter"), async (req, res) => {
  const { decision, dossier_id, motif } = req.body || {};
  if (!["rattache", "cree", "sans_suite"].includes(decision)) return res.status(400).json({ error: "decision : rattache, cree ou sans_suite" });
  if (decision !== "sans_suite" && !dossier_id) return res.status(400).json({ error: "dossier_id requis" });
  if (decision === "sans_suite" && !String(motif || "").trim()) return res.status(400).json({ error: "Un motif est requis pour classer sans suite." });
  const client = await pool.connect();
  let ancienCheminBrut = null;
  try {
    await client.query("BEGIN");
    const { rows: [c] } = await client.query("SELECT * FROM courriers WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!c) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Courrier introuvable" }); }
    if (!ROLES_ASSOCIE.includes(req.user.role) && c.destinataire_id !== req.user.sub) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Seul l'avocat destinataire ou un associé peut orienter ce courrier." });
    }
    if (c.orientation !== "a_orienter") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Ce courrier n'est pas à orienter (déjà orienté ou rattaché à un dossier)." }); }
    let declenchement = null;
    if (decision === "sans_suite") {
      await client.query(
        `UPDATE courriers SET orientation = 'sans_suite', orientation_motif = $1, oriente_par = $2, oriente_le = now(), statut = 'traite'::statut_courrier WHERE id = $3`,
        [String(motif).trim(), req.user.sub, c.id]);
      await client.query(`UPDATE taches SET statut = 'termine' WHERE courrier_id = $1 AND courrier_etape = 'orienter' AND statut NOT IN ('termine','annule')`, [c.id]);
    } else {
      const d = await client.query("SELECT id FROM dossiers WHERE id = $1", [dossier_id]);
      if (!d.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Dossier introuvable" }); }
      await client.query("UPDATE courriers SET dossier_id = $1 WHERE id = $2", [dossier_id, c.id]);
      const maj = (await client.query("SELECT * FROM courriers WHERE id = $1", [c.id])).rows[0];
      if (maj.fichier_brut_chemin && !maj.document_id) {
        const buf = await readObject(maj.fichier_brut_chemin);
        const docId = await classerDansGed(client, dossier_id, maj.fichier_brut_nom, buf, maj.fichier_brut_type_mime, maj.fichier_brut_taille, req.user.sub);
        await client.query(
          `UPDATE courriers SET document_id = $1, numerise = TRUE, fichier_brut_chemin = NULL, fichier_brut_nom = NULL,
             fichier_brut_type_mime = NULL, fichier_brut_taille = NULL WHERE id = $2`, [docId, c.id]);
        ancienCheminBrut = maj.fichier_brut_chemin;
      }
      declenchement = await apresRattachement(client, { ...maj, orientation: "a_orienter" }, req.user.sub, decision);
    }
    await client.query("COMMIT");
    if (ancienCheminBrut) await deleteObject(ancienCheminBrut);
    await logAudit({ utilisateurId: req.user.sub, action: "orienter_courrier", entite: "courriers", entiteId: c.id,
      details: { decision, dossier_id: dossier_id || null, motif: motif || null }, ip: req.ip });
    res.json({ id: c.id, orientation: decision, declenchement });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// POST /api/courriers/:id/imputer  { imputation_id, instructions, echeance? }
// Impute le travail technique à un collaborateur (juriste, avocat stagiaire,
// stagiaire) avec des INSTRUCTIONS : crée une tâche liée au courrier et au
// dossier — le collaborateur la retrouve dans « Mes tâches ». Réservé à
// l'avocat destinataire et aux associés. Le courrier passe à « traité » quand
// la tâche est terminée.
router.post("/:id/imputer", requirePermission("courriers.consulter"), async (req, res) => {
  const b = req.body || {};
  if (!b.imputation_id) return res.status(400).json({ error: "imputation_id requis" });
  if (!String(b.instructions || "").trim()) return res.status(400).json({ error: "Des instructions sont requises pour imputer le travail." });
  try {
    const { rows: [c] } = await pool.query("SELECT * FROM courriers WHERE id = $1", [req.params.id]);
    if (!c) return res.status(404).json({ error: "Courrier introuvable" });
    if (!ROLES_ASSOCIE.includes(req.user.role) && c.destinataire_id !== req.user.sub) {
      return res.status(403).json({ error: "Seul l'avocat destinataire ou un associé peut imputer ce courrier." });
    }
    if (c.orientation === "a_orienter") return res.status(409).json({ error: "Orientez d'abord ce courrier (dossier à rattacher ou à créer)." });
    if (c.orientation === "sans_suite") return res.status(409).json({ error: "Ce courrier a été classé sans suite." });
    if (!c.dossier_id) return res.status(409).json({ error: "Rattachez d'abord un dossier à ce courrier." });
    const cible = await pool.query("SELECT role, actif FROM utilisateurs WHERE id = $1", [b.imputation_id]);
    if (!cible.rows[0] || !cible.rows[0].actif || !ROLES_IMPUTABLES.includes(cible.rows[0].role)) {
      return res.status(400).json({ error: "Le travail technique ne peut être imputé qu'à un juriste, un avocat stagiaire ou un stagiaire." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Réimputation : l'ancienne tâche encore ouverte est annulée.
      await client.query(`UPDATE taches SET statut = 'annule' WHERE courrier_id = $1 AND courrier_etape = 'imputation' AND statut NOT IN ('termine','annule')`, [c.id]);
      const t = await client.query(
        `INSERT INTO taches (dossier_id, titre, description, responsable_id, echeance, cree_par, courrier_id, courrier_etape)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'imputation') RETURNING id, titre, echeance`,
        [c.dossier_id, `Courrier ${c.reference} — ${String(c.objet || c.type).slice(0, 120)}`, String(b.instructions).trim(),
         b.imputation_id, b.echeance || null, req.user.sub, c.id]
      );
      await client.query(
        `UPDATE courriers SET imputation_id = $1, statut = 'impute'::statut_courrier, instructions_imputation = $2, imputee_par = $3, imputee_le = now() WHERE id = $4`,
        [b.imputation_id, String(b.instructions).trim(), req.user.sub, c.id]
      );
      await client.query("COMMIT");
      await logAudit({ utilisateurId: req.user.sub, action: "imputer_courrier", entite: "courriers", entiteId: c.id,
        details: { imputation_id: b.imputation_id, tache_id: t.rows[0].id, echeance: b.echeance || null }, ip: req.ip });
      res.status(201).json({ courrier_id: c.id, tache: t.rows[0] });
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/courriers/:id/viser — 15/10/2026, réponse à Q1 de la réflexion
// "Registre courrier" : marque qu'un avocat du dossier a pris connaissance
// et validé le traitement du courrier, distinct de l'imputation (qui dit
// seulement "à qui c'est confié"). Réservé à un avocat (ROLES_AVOCAT) qui
// est responsable OU intervenant du dossier rattaché — jamais quelqu'un
// d'extérieur au dossier. Idempotent : re-viser met juste à jour qui/quand,
// ce n'est pas une transition d'état irréversible (pas de garde 409).
router.post("/:id/viser", requirePermission("courriers.viser"), async (req, res) => {
  if (!ROLES_AVOCAT.includes(req.user.role)) {
    return res.status(403).json({ error: "Seul un avocat peut viser un courrier." });
  }
  try {
    const { rows } = await pool.query("SELECT dossier_id FROM courriers WHERE id = $1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Courrier introuvable" });
    const dossierId = rows[0].dossier_id;
    if (!dossierId) {
      return res.status(400).json({ error: "Un dossier doit être rattaché avant de pouvoir viser ce courrier." });
    }
    const { rows: affRows } = await pool.query(
      `SELECT 1 FROM dossiers WHERE id = $1 AND responsable_id = $2
       UNION
       SELECT 1 FROM dossier_intervenants WHERE dossier_id = $1 AND utilisateur_id = $2`,
      [dossierId, req.user.sub]
    );
    if (!affRows[0]) {
      return res.status(403).json({ error: "Seul un avocat affecté à ce dossier (responsable ou intervenant) peut le viser." });
    }
    const upd = await pool.query(
      `UPDATE courriers SET vise_par = $1, vise_le = now() WHERE id = $2
       RETURNING id, vise_par, vise_le`,
      [req.user.sub, req.params.id]
    );
    res.json(upd.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
