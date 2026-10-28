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
const { saveObject, enteteContentDisposition } = require("../storage");
const { generer } = require("../ia");
const { requirePermission } = require("../permissions");
const { logAudit } = require("../audit");
const { envoyerActePdf } = require("../actePdf");
const { envoyerActeDocx } = require("../acteDocx");
const { estDocumentVisible, chargerContexteDossier } = require("../confidentialiteDocuments");
const {
  BALISES, A_COMPLETER, libelleStatutPartie, libelleDegre, fmtDate, ou, jointureEt,
  dateLongue, naissance, filiation, representant, identification, depuisClient, depuisPartie, CIVILITES,
} = require("../balisesActes");
const { selectChamps, CHAMPS_CLIENT, CHAMPS_PARTIE } = require("../identiteActes");
const { rendre, analyser } = require("../moteurModele");
const { validerDefinition, traiterReponses } = require("../questionnaireActes");
const { genererReference } = require("../referenceCourrier");
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

// GET /api/actes/modeles — modèles actifs ET validés, pour le sélecteur de génération (un modèle
// non validé par un avocat n'est jamais proposé ; il reste visible dans la gestion des modèles).
router.get("/modeles", requirePermission("actes.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT code, nom, categorie, famille, matiere, champs, courrier_depart
       FROM modeles_actes WHERE actif = TRUE AND statut_validation = 'valide' ORDER BY categorie, nom`
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
      `SELECT m.id, m.code, m.nom, m.categorie, m.corps, m.actif, m.cree_le, m.modifie_le, m.famille, m.matiere, m.champs,
              m.courrier_depart, m.statut_validation, m.valide_le, m.textes_cites,
              v.prenom || ' ' || v.nom AS valide_par_nom
       FROM modeles_actes m LEFT JOIN utilisateurs v ON v.id = m.valide_par
       ORDER BY m.categorie, m.nom`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Contrôle commun à la création et à la modification d'un modèle : syntaxe des blocs du corps,
// définition du questionnaire (clés, types) et textes cités.
function verifierModele(b) {
  if (b.corps !== undefined && b.corps !== null) analyser(b.corps);
  if (b.champs !== undefined && b.champs !== null) validerDefinition(b.champs);
  if (b.textes_cites !== undefined && b.textes_cites !== null) {
    if (!Array.isArray(b.textes_cites) || b.textes_cites.some((t) => !t || typeof t.texte !== "string")) {
      const e = new Error("textes_cites : liste de { texte, verifie_le }");
      e.status = 400;
      throw e;
    }
  }
}

const COLONNES_MODELE = "id, code, nom, categorie, corps, actif, famille, matiere, champs, courrier_depart, statut_validation, textes_cites";

// POST /api/actes/modeles  { code, nom, categorie, corps, famille?, matiere?, champs?, courrier_depart?, textes_cites? }
// Un modèle créé ou modifié n'est pas utilisable tant qu'un avocat ne l'a pas validé (POST /modeles/:id/valider).
router.post("/modeles", requirePermission("actes.modeles.gerer"), async (req, res) => {
  const b = req.body || {};
  if (!b.code || !b.nom || !b.corps) return res.status(400).json({ error: "code, nom et corps requis" });
  try {
    verifierModele(b);
    const { rows } = await pool.query(
      `INSERT INTO modeles_actes (code, nom, categorie, corps, cree_par, famille, matiere, champs, courrier_depart, textes_cites, statut_validation)
       VALUES ($1,$2,COALESCE($3::categorie_document,'autre'),$4,$5,$6,$7,COALESCE($8::jsonb,'[]'::jsonb),COALESCE($9::boolean,FALSE),COALESCE($10::jsonb,'[]'::jsonb),'a_valider')
       RETURNING ${COLONNES_MODELE}`,
      [b.code, b.nom, b.categorie || null, b.corps, req.user.sub, b.famille || null, b.matiere || null,
       b.champs ? JSON.stringify(b.champs) : null, b.courrier_depart ?? null, b.textes_cites ? JSON.stringify(b.textes_cites) : null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Ce code de modèle existe déjà" });
    console.error(e);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// PUT /api/actes/modeles/:id  { nom?, categorie?, corps?, actif?, famille?, matiere?, champs?, courrier_depart?, textes_cites? }
// Modifier le texte ou le questionnaire d'un modèle le repasse « à valider » (validation par un avocat à refaire).
router.put("/modeles/:id", requirePermission("actes.modeles.gerer"), async (req, res) => {
  const b = req.body || {};
  try {
    verifierModele(b);
    const contenuModifie = (b.corps !== undefined && b.corps !== null) || (b.champs !== undefined && b.champs !== null);
    const { rows } = await pool.query(
      `UPDATE modeles_actes
       SET nom = COALESCE($1, nom), categorie = COALESCE($2::categorie_document, categorie),
           corps = COALESCE($3, corps), actif = COALESCE($4, actif),
           famille = COALESCE($6, famille), matiere = COALESCE($7, matiere),
           champs = COALESCE($8::jsonb, champs), courrier_depart = COALESCE($9::boolean, courrier_depart),
           textes_cites = COALESCE($10::jsonb, textes_cites),
           statut_validation = CASE WHEN $11::boolean THEN 'a_valider' ELSE statut_validation END,
           valide_par = CASE WHEN $11::boolean THEN NULL ELSE valide_par END,
           valide_le = CASE WHEN $11::boolean THEN NULL ELSE valide_le END,
           modifie_le = now()
       WHERE id = $5
       RETURNING ${COLONNES_MODELE}`,
      [b.nom ?? null, b.categorie ?? null, b.corps ?? null, b.actif ?? null, req.params.id, b.famille ?? null, b.matiere ?? null,
       b.champs ? JSON.stringify(b.champs) : null, b.courrier_depart ?? null, b.textes_cites ? JSON.stringify(b.textes_cites) : null, contenuModifie]
    );
    if (!rows[0]) return res.status(404).json({ error: "Modèle introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// POST /api/actes/modeles/:id/valider — un avocat valide le modèle (nom, date et auteur conservés).
router.post("/modeles/:id/valider", requirePermission("actes.modeles.gerer"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE modeles_actes SET statut_validation = 'valide', valide_par = $1, valide_le = now()
       WHERE id = $2 RETURNING ${COLONNES_MODELE}, valide_le`,
      [req.user.sub, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Modèle introuvable" });
    await logAudit({ utilisateurId: req.user.sub, action: "valider_modele_acte", entite: "modeles_actes", entiteId: req.params.id, details: { code: rows[0].code }, ip: req.ip });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
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

async function construireContexte(dossierId, avocatNom, avocatFiche, pieces) {
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
  // Co-demandeurs (ex. les deux époux d'une requête conjointe), clients additionnels (co-requérants) et
  // avocats du dossier (responsable + intervenants avocats) — balises ajoutées le 28/10/2026.
  const coDemandeurs = await pool.query(
    `SELECT denomination, ${selectChamps(CHAMPS_PARTIE)} FROM dossier_parties WHERE dossier_id = $1 AND role = 'co_demandeur' ORDER BY cree_le, id`,
    [dossierId]
  );
  const clientsAdd = await pool.query(
    `SELECT c.type, c.denomination, c.forme_juridique, c.rccm, c.nif, c.prenom, c.nom, c.nationalite, c.adresse, c.ville,
            ${selectChamps(CHAMPS_CLIENT, "c")}
     FROM dossier_clients_additionnels a JOIN clients c ON c.id = a.client_id
     WHERE a.dossier_id = $1 ORDER BY a.cree_le`,
    [dossierId]
  );
  const avocats = await pool.query(
    `SELECT prenom || ' ' || nom AS nom FROM (
       SELECT u.prenom, u.nom, 0 AS rang FROM dossiers d JOIN utilisateurs u ON u.id = d.responsable_id
        WHERE d.id = $1 AND u.role IN ('associe','associe_fondateur','of_counsel','avocat_stagiaire','collaborateur')
       UNION
       SELECT u.prenom, u.nom, 1 FROM dossier_intervenants i JOIN utilisateurs u ON u.id = i.utilisateur_id
        WHERE i.dossier_id = $1 AND u.role IN ('associe','associe_fondateur','of_counsel','avocat_stagiaire','collaborateur')
     ) x ORDER BY rang, nom`,
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
    coDemandeursFiches: coDemandeurs.rows.map(depuisPartie),
    clientsAdditionnelsFiches: clientsAdd.rows.map(depuisClient),
    avocatsDossier: avocats.rows.map((r) => r.nom),
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
    pieces: pieces || [],
    nRef: null,
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
  const pieces = ctx.pieces || [];
  const coDem = ctx.coDemandeursFiches || [];
  const clientsAdd = ctx.clientsAdditionnelsFiches || [];
  const avocatsDossier = ctx.avocatsDossier || [];
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
    co_demandeur_nom: coDem.length && coDem[0].denomination ? coDem[0].denomination : A_COMPLETER,
    co_demandeurs_identification: coDem.length ? coDem.map(identification).join("\n") : A_COMPLETER,
    clients_nombre: String([c, ...clientsAdd].filter(Boolean).length),
    clients_identification: [c, ...clientsAdd].filter(Boolean).map((p) => identification(p) || A_COMPLETER).join("\n") || A_COMPLETER,
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
    n_ref: ctx.nRef || A_COMPLETER,
    avocats_dossier: avocatsDossier.length
      ? `${avocatsDossier.length > 1 ? "Maîtres" : "Maître"} ${avocatsDossier.length > 1 ? `${avocatsDossier.slice(0, -1).join(", ")} et ${avocatsDossier[avocatsDossier.length - 1]}` : avocatsDossier[0]}`
      : A_COMPLETER,
    pieces_nombre: String(pieces.length),
    pieces_liste: pieces.length ? pieces.map((p, i) => `Pièce n° ${i + 1} : ${p}`).join("\n") : A_COMPLETER,
    bordereau_pieces: pieces.length ? `BORDEREAU DES PIÈCES\n${pieces.map((p, i) => `${i + 1}. ${p}`).join("\n")}` : A_COMPLETER,
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

// Fusion d'un corps de modèle avec ses valeurs : substitution {{cle}} et blocs {{#si}} / {{#chaque}}
// (moteurModele.js). Une balise inconnue reste visible plutôt que silencieusement vidée.
function fusionner(corps, plat) {
  return rendre(corps, plat);
}

// POST /api/actes/generer
// { dossier_id, mode: 'modele'|'ia', modele_code?, instructions_ia?, pieces?, reponses?, numeroter? }
//  - reponses : réponses au questionnaire du modèle (questionnaireActes.js) ;
//  - pieces : pièces supplémentaires, numérotées à la suite de celles du questionnaire ;
//  - numeroter : pour un modèle « courrier départ », false = ne pas réserver de numéro au registre du courrier.
router.post("/generer", requirePermission("actes.generer"), async (req, res) => {
  const b = req.body || {};
  if (!b.dossier_id) return res.status(400).json({ error: "dossier_id requis" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const avocat = await pool.query("SELECT prenom || ' ' || nom AS nom, titre_avocat AS titre, code FROM utilisateurs WHERE id = $1", [req.user.sub]);
    // Pièces à citer (28/10/2026) : liste saisie une seule fois, reprise dans l'exposé et le bordereau.
    let piecesLibres = [];
    if (b.pieces !== undefined) {
      if (!Array.isArray(b.pieces) || b.pieces.length > 100 || b.pieces.some((p) => typeof p !== "string" || p.length > 300)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "pieces : liste de 100 intitulés au plus (300 caractères chacun)" });
      }
      piecesLibres = b.pieces.map((p) => p.trim()).filter(Boolean);
    }
    const ctx = await construireContexte(b.dossier_id, avocat.rows[0]?.nom || "", avocat.rows[0], piecesLibres);
    if (!ctx) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Dossier introuvable" });
    }

    let texte, nom, categorie, courrierRef = null, courrierMeta = null, memoireAEnregistrer = {}, memoireAOublier = [];
    if (b.mode === "ia") {
      if (!b.instructions_ia) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "instructions_ia requis en mode IA" });
      }
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
        "SELECT nom, categorie, corps, champs, courrier_depart, statut_validation FROM modeles_actes WHERE code = $1 AND actif = TRUE",
        [b.modele_code]
      );
      if (!modele) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Modèle inconnu ou désactivé" });
      }
      if (modele.statut_validation !== "valide") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Ce modèle n'a pas encore été validé par un avocat : il n'est pas utilisable." });
      }
      // 1. Questionnaire : valeurs par défaut tirées des balises du dossier, pièces rattachées aux éléments.
      const champs = Array.isArray(modele.champs) ? modele.champs : [];
      let juridictions = null;
      if (champs.some((c) => c.type === "juridiction")) {
        const { rows } = await pool.query("SELECT code, libelle FROM listes_valeurs WHERE domaine = 'juridiction' AND actif = TRUE");
        juridictions = Object.fromEntries(rows.map((r) => [r.code, r.libelle]));
      }
      const { valeurs, pieces: piecesQuestionnaire, memoire, oubli } = traiterReponses(champs, b.reponses, applatirContexte(ctx), juridictions);
      memoireAEnregistrer = memoire;
      memoireAOublier = oubli;
      ctx.pieces = [...piecesQuestionnaire, ...piecesLibres];
      // 2. N/Réf : un modèle « courrier départ » réserve son numéro dans le registre du courrier (même transaction).
      if (modele.courrier_depart && b.numeroter !== false) {
        courrierRef = await genererReference(client, "depart", new Date());
        ctx.nRef = courrierRef;
        courrierMeta = {
          correspondant: valeurs.juridiction_autre || valeurs.juridiction_destinataire_libelle || null,
          objet: valeurs.objet || modele.nom,
        };
      }
      texte = fusionner(modele.corps, { ...applatirContexte(ctx), ...valeurs });
      nom = `${modele.nom} — ${ctx.dossier.numero}`;
      categorie = modele.categorie;
    }

    const dest = `${b.dossier_id}/${Date.now()}_${nom}.txt`.replace(/\s+/g, "_");
    const chemin = await saveObject(Buffer.from(texte, "utf-8"), dest, "text/plain");
    const ins = await client.query(
      `INSERT INTO documents (dossier_id, nom, categorie, statut, chemin_storage, type_mime, taille_octets, auteur_id, ocr_texte)
       VALUES ($1,$2,$3,'brouillon',$4,'text/plain',$5,$6,$7)
       RETURNING id, nom, categorie, statut, version, cree_le`,
      [b.dossier_id, nom, categorie, chemin, Buffer.byteLength(texte, "utf-8"), req.user.sub, texte]
    );
    if (courrierRef) {
      await client.query(
        `INSERT INTO courriers (reference, sens, type, date_courrier, acteur_type, correspondant, objet, dossier_id, support,
                                statut, cree_par, recu_par, document_id)
         VALUES ($1,'depart','lettre',current_date,'juridiction',$2,$3,$4,'numerique','recu',$5,$5,$6)`,
        [courrierRef, courrierMeta.correspondant, String(courrierMeta.objet).slice(0, 300), b.dossier_id, req.user.sub, ins.rows[0].id]
      );
    }
    // Mémoire des réponses du dossier (champs « memoriser ») : conservée avec l'acte, dans la même transaction.
    for (const [cle, valeur] of Object.entries(memoireAEnregistrer)) {
      await client.query(
        `INSERT INTO actes_reponses (dossier_id, cle, valeur, modifie_par) VALUES ($1,$2,$3::jsonb,$4)
         ON CONFLICT (dossier_id, cle) DO UPDATE SET valeur = EXCLUDED.valeur, modifie_par = EXCLUDED.modifie_par, modifie_le = now()`,
        [b.dossier_id, cle, JSON.stringify(valeur), req.user.sub]
      );
    }
    if (memoireAOublier.length) {
      await client.query("DELETE FROM actes_reponses WHERE dossier_id = $1 AND cle = ANY($2::text[])", [b.dossier_id, memoireAOublier]);
    }
    await client.query("COMMIT");
    res.status(201).json({ ...ins.rows[0], texte, courrier_reference: courrierRef });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(e.status || 400).json({ error: e.message });
  } finally {
    client.release();
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

// GET /api/actes/memoire/:dossierId — réponses mémorisées du dossier (clé -> valeur), pour pré-remplir le
// questionnaire d'un nouvel acte. Réservé à qui peut générer un acte.
router.get("/memoire/:dossierId", requirePermission("actes.generer"), async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT cle, valeur FROM actes_reponses WHERE dossier_id = $1", [req.params.dossierId]);
    res.json(Object.fromEntries(rows.map((r) => [r.cle, r.valeur])));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: "Dossier invalide" });
  }
});

// DELETE /api/actes/memoire/:dossierId — oublie les réponses mémorisées du dossier.
router.delete("/memoire/:dossierId", requirePermission("actes.generer"), async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM actes_reponses WHERE dossier_id = $1", [req.params.dossierId]);
    await logAudit({ utilisateurId: req.user.sub, action: "oublier_memoire_actes", entite: "dossiers", entiteId: req.params.dossierId, details: { lignes: rowCount }, ip: req.ip });
    res.json({ oubliees: rowCount });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: "Dossier invalide" });
  }
});

// GET /api/actes/:id/docx — version Word du texte courant (28/10/2026), jamais
// persistée, régénérée à chaque téléchargement (voir acteDocx.js). Réservée aux
// actes texte générés par l'Atelier : une pièce déposée n'a pas de texte à mettre en forme.
router.get("/:id/docx", requirePermission("actes.consulter"), async (req, res) => {
  try {
    const { rows: [doc] } = await pool.query(
      "SELECT dossier_id, confidentialite, type_mime FROM documents WHERE id = $1",
      [req.params.id]
    );
    if (!doc || doc.type_mime !== "text/plain") return res.status(404).json({ error: "Acte introuvable" });
    if (!(await verifierAccesDocument(doc.dossier_id, doc.confidentialite, req.user))) {
      return res.status(403).json({ error: "Accès refusé (document à confidentialité restreinte)" });
    }
    const trouve = await envoyerActeDocx(pool, req.params.id, res, enteteContentDisposition);
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
