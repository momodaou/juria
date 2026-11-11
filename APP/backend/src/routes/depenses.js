// JURIA — Dépenses & caisse : charges fixes/ponctuelles avec circuit de
// validation (soumise → validée/rejetée → décaissée), petite caisse,
// comptes du cabinet, vignettes de plaidoirie (stock).
const express = require("express");
const { pool } = require("../db");
const multer = require("multer");
const { parserNumeros } = require("../vignettesNumeros");
const { saveObject, readObject, deleteObject, FichierIntrouvableError, enteteContentDisposition } = require("../storage");
const { filtreTypeFichier } = require("../uploadFilter");
const { logAudit } = require("../audit");
const notif = require("../notifications");
const { DECAISSEMENT, DECAISSEMENT_PAR_CODE, comptesEligibles, preparerDecaissement } = require("../moyensPaiement");
const { requirePermission, requireAnyPermission, estAutorise } = require("../permissions");
const { CATEGORIES_DEBOURS, estDebours } = require("../categoriesDepense");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 }, fileFilter: filtreTypeFichier });
const router = express.Router();

// Nature d'une dépense (16/10/2026) : « dossier » (charge liée à une
// procédure — dossier obligatoire) ou « cabinet » (fonctionnement propre du
// cabinet — jamais de dossier). Déduite du dossier_id si non fournie, pour
// rester compatible avec les appelants antérieurs.
function resoudreNature(b, existant) {
  const nature = b.nature || (b.dossier_id ? "dossier" : existant ? existant.nature : "cabinet");
  if (!["dossier", "cabinet"].includes(nature)) return { erreur: "nature invalide (dossier ou cabinet)." };
  const dossierId = nature === "cabinet" ? null : (b.dossier_id || (existant && existant.dossier_id) || null);
  if (nature === "dossier" && !dossierId) return { erreur: "Une charge liée à un dossier doit préciser le dossier." };
  return { nature, dossierId };
}

// ---------------------------------------------------------------------
// Ordre de paiement / exécution (11/11/2026, projet « Dépenses & caisses », lot A).
// Les associés (depenses.decision) ORDONNENT : moyen + compte à débiter, à la validation ou après. L'administration
// générale et le comptable (depenses.decaisser sans decision) EXÉCUTENT : ils ne voient le moyen et l'intitulé du compte
// qu'une fois l'ordre donné, et ne saisissent que les références de l'opération. Les autres ne voient rien.
// ---------------------------------------------------------------------
async function profilReglement(req) {
  const decideur = await estAutorise(req.user.role, "depenses.decision", req.user.sub);
  const executant = decideur || (await estAutorise(req.user.role, "depenses.decaisser", req.user.sub));
  return { decideur, executant };
}

// Valide un ordre de paiement : moyen valide, compte compatible ET obligatoire (sauf espèces, sans compte).
async function verifierOrdre(b) {
  if (!b.mode_paiement) return { erreur: "Précisez le moyen de paiement." };
  const r = await preparerDecaissement(pool, { mode_paiement: b.mode_paiement, compte_id: b.compte_id || null, references: b.references }, { exigerReferences: false });
  if (r.erreur) return r;
  const moyen = DECAISSEMENT_PAR_CODE[r.valeurs.mode_paiement];
  if (moyen.comptes !== "aucun" && !r.valeurs.compte_id) return { erreur: "Précisez le compte à débiter pour ce moyen de paiement." };
  return r;
}

// ---------------------------------------------------------------------
// Petite caisse encadrée (11/11/2026, projet « Dépenses & caisses », lot B) : natures autorisées (liste réglée par les
// associés), bénéficiaire obligatoire, et plafond appliqué au CUMUL sur une fenêtre glissante de 7 jours (même catégorie,
// même bénéficiaire, même dossier) : une prestation découpée en deux dépenses ne passe plus sous le plafond.
// ---------------------------------------------------------------------
const FENETRE_JOURS = 6; // 7 jours calendaires : le jour même + les 6 autres

// Deux caisses sur le même moteur (lot D, 11/11/2026) : la petite caisse et la caisse « frais de justice & débours »
// (dossier obligatoire, débours refacturable). Les noms de colonnes viennent de cette table fixe (jamais de l'utilisateur).
const CAISSES = {
  petite_caisse: { code: "petite_caisse", nom: "la petite caisse", flag: "petite_caisse", plafond: "petite_caisse_plafond_depense", categories: "petite_caisse_categories", dossierObligatoire: false },
  procedure: { code: "procedure", nom: "la caisse frais de justice & débours", flag: "caisse_procedure", plafond: "caisse_procedure_plafond_depense", categories: "caisse_procedure_categories", dossierObligatoire: true },
};
const caisseDe = (v) => (v === "procedure" ? CAISSES.procedure : CAISSES.petite_caisse);
const maj = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const caisseDeLigne = (d) => (d && d.caisse_procedure ? CAISSES.procedure : CAISSES.petite_caisse);
async function plafondCaisse(c, db = pool) {
  const { rows: [r] } = await db.query(`SELECT ${c.plafond} AS plafond FROM parametres_cabinet WHERE id = 1`);
  return r ? r.plafond : null;
}
async function categoriesCaisse(c, db = pool) {
  const { rows: [r] } = await db.query(`SELECT ${c.categories} AS c FROM parametres_cabinet WHERE id = 1`);
  const liste = (r && r.c) || [];
  // Les débours et frais de procédure sont des frais de justice : jamais acceptés sur la petite caisse, quoi que contienne la liste.
  return c.code === "petite_caisse" ? liste.filter((x) => !estDebours(x)) : liste;
}
const categoriesPetiteCaisse = (db = pool) => categoriesCaisse(CAISSES.petite_caisse, db);
const msgCategorie = (c) => `Cette nature de dépense n'est pas autorisée sur ${c.nom} (Accès & permissions → Seuils). Soumettez-la au circuit normal de validation.`;
const MSG_CATEGORIE = msgCategorie(CAISSES.petite_caisse);
const MSG_DEBOURS = "Les débours et frais de procédure sont des frais de justice : ils s'engagent sur la caisse « frais de justice & débours » (ou par le circuit normal de validation), pas sur la petite caisse.";

// Renvoie un message d'erreur, ou null si l'engagement est acceptable.
async function controlerCaisse(c, { categorie, beneficiaire, dossierId, montant, date, plafond, exclureId = null }) {
  if (!categorie) return `Choisissez la catégorie de la dépense : ${c.nom} n'accepte que certaines natures de dépenses.`;
  if (c.code === "petite_caisse" && estDebours(categorie)) return MSG_DEBOURS;
  if (!(await categoriesCaisse(c)).includes(categorie)) return msgCategorie(c);
  if (c.dossierObligatoire && !dossierId) return `Une dépense sur ${c.nom} doit être rattachée à un dossier.`;
  if (!beneficiaire) return `Le bénéficiaire est obligatoire sur ${c.nom} (la personne ou l'organisme payé).`;
  if (plafond != null) {
    const { rows: [r] } = await pool.query(
      `SELECT COALESCE(SUM(montant) FILTER (WHERE date_depense BETWEEN d.j - ${FENETRE_JOURS} AND d.j), 0) AS avant,
              COALESCE(SUM(montant) FILTER (WHERE date_depense BETWEEN d.j AND d.j + ${FENETRE_JOURS}), 0) AS apres
         FROM depenses, (SELECT COALESCE($4::date, current_date) AS j) d
        WHERE ${c.flag} = TRUE AND statut <> 'rejetee' AND categorie = $1::categorie_depense
          AND lower(btrim(COALESCE(beneficiaire, ''))) = lower(btrim($2::text))
          AND dossier_id IS NOT DISTINCT FROM $3::uuid
          AND ($5::uuid IS NULL OR id <> $5::uuid)`,
      [categorie, beneficiaire, dossierId || null, date || null, exclureId]);
    const cumul = Math.max(Number(r.avant), Number(r.apres));
    if (cumul > 0 && cumul + montant > Number(plafond)) {
      return `Cette dépense, ajoutée à celles déjà engagées pour le même bénéficiaire, la même nature et le même dossier sur 7 jours (${cumul.toLocaleString("fr-FR")} FCFA), `
        + `atteindrait ${(cumul + montant).toLocaleString("fr-FR")} FCFA, au-delà du plafond de ${c.nom} (${Number(plafond).toLocaleString("fr-FR")}). Soumettez-la au circuit normal de validation.`;
    }
  }
  return null;
}

// Alerte aux associés : le même engageur a engagé d'autres petites dépenses rapprochées (même bénéficiaire ou même dossier).
async function signalerFractionnement(c, id, engageurId, beneficiaire, dossierId, date) {
  const { rows: [r] } = await pool.query(
    `SELECT count(*)::int AS n FROM depenses
      WHERE ${c.flag} = TRUE AND statut <> 'rejetee' AND id <> $1::uuid AND engagee_par = $2::uuid
        AND date_depense BETWEEN COALESCE($5::date, current_date) - ${FENETRE_JOURS} AND COALESCE($5::date, current_date) + ${FENETRE_JOURS}
        AND (lower(btrim(COALESCE(beneficiaire, ''))) = lower(btrim($3::text)) OR (dossier_id IS NOT NULL AND dossier_id = $4::uuid))`,
    [id, engageurId, beneficiaire, dossierId || null, date || null]);
  if (r.n > 0) {
    await notif.notifier({ type: "caisse_fractionnement", destinataires: await notif.titulairesPermission("depenses.decision"),
      auteurId: engageurId, ref: id, cle: "fractionnement:" + c.code, charge: { caisse: c.code } });
  }
}

// GET /api/depenses/:id/voisines — dépenses de petite caisse rapprochées d'une dépense engagée (validation après coup).
router.get("/:id/voisines", requirePermission("depenses.decision"), async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: "Identifiant invalide" });
  try {
    const { rows: [d] } = await pool.query(
      "SELECT id, montant, categorie, beneficiaire, dossier_id, engagee_par, date_depense, caisse_procedure FROM depenses WHERE id = $1", [req.params.id]);
    if (!d) return res.status(404).json({ error: "Dépense introuvable" });
    const c = caisseDeLigne(d);
    const { rows } = await pool.query(
      `SELECT v.id, v.libelle, v.montant, v.date_depense, v.categorie, v.beneficiaire, v.apres_coup_statut, u.prenom || ' ' || u.nom AS engageur,
              (lower(btrim(COALESCE(v.beneficiaire, ''))) = lower(btrim(COALESCE($3::text, ''))) AND COALESCE($3::text, '') <> '') AS meme_beneficiaire,
              (v.dossier_id IS NOT NULL AND v.dossier_id = $4::uuid) AS meme_dossier
         FROM depenses v LEFT JOIN utilisateurs u ON u.id = v.engagee_par
        WHERE v.${c.flag} = TRUE AND v.statut <> 'rejetee' AND v.id <> $1::uuid
          AND v.date_depense BETWEEN $2::date - ${FENETRE_JOURS} AND $2::date + ${FENETRE_JOURS}
          AND ((COALESCE($3::text, '') <> '' AND lower(btrim(COALESCE(v.beneficiaire, ''))) = lower(btrim($3::text)))
               OR (v.dossier_id IS NOT NULL AND v.dossier_id = $4::uuid)
               OR (v.engagee_par = $5::uuid AND v.categorie = $6::categorie_depense))
        ORDER BY v.date_depense DESC, v.cree_le DESC LIMIT 20`,
      [d.id, d.date_depense, d.beneficiaire, d.dossier_id, d.engagee_par, d.categorie]);
    const par = { plafond: await plafondCaisse(c) };
    const cumul = rows.filter((v) => v.categorie === d.categorie && v.meme_beneficiaire).reduce((s, v) => s + Number(v.montant), Number(d.montant));
    res.json({ voisines: rows, cumul_meme_nature_beneficiaire: cumul, plafond: par && par.plafond != null ? Number(par.plafond) : null, fenetre_jours: FENETRE_JOURS + 1 });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// GET /api/depenses/synthese — compteurs des onglets de l'écran (lot E, 11/11/2026) : « cabinet » (hors petite caisse) et
// « petite_caisse ». À décider, ordre de paiement à donner (réservé aux associés), à décaisser (ordre donné), décaissé ce
// mois ; à valider après coup. Dépenses annulées et rejetées exclues.
router.get("/synthese", requirePermission("depenses.consulter"), async (req, res) => {
  try {
    const profil = await profilReglement(req);
    const regles = {
      decider: "statut = 'soumise'",
      ordonner: "statut = 'validee' AND ordre_paiement_le IS NULL",
      decaisser: "statut = 'validee' AND ordre_paiement_le IS NOT NULL",
      decaisse_mois: "statut = 'decaissee' AND date_trunc('month', decaisse_le) = date_trunc('month', now())",
      apres_coup: "apres_coup_statut = 'a_valider'",
    };
    const colonnes = [];
    for (const [grp, filtre] of [["cab", "NOT petite_caisse AND NOT caisse_procedure"], ["pc", "petite_caisse"], ["pr", "caisse_procedure"]]) {
      for (const [cle, sql] of Object.entries(regles)) {
        colonnes.push(`count(*) FILTER (WHERE ${filtre} AND ${sql})::int AS ${grp}_${cle}_nb`);
        colonnes.push(`COALESCE(sum(montant) FILTER (WHERE ${filtre} AND ${sql}), 0)::bigint AS ${grp}_${cle}_total`);
      }
    }
    const { rows: [r] } = await pool.query(`SELECT ${colonnes.join(", ")} FROM depenses WHERE annulee_le IS NULL`);
    const bloc = (grp) => {
      const o = {};
      for (const cle of Object.keys(regles)) o[cle] = { nb: r[`${grp}_${cle}_nb`], total: Number(r[`${grp}_${cle}_total`]) };
      // Réservé aux associés : ce qui reste à décider, à ordonner ou à valider après coup ne regarde pas les exécutants.
      if (!profil.decideur) for (const k of ["decider", "ordonner", "apres_coup"]) o[k] = { nb: 0, total: 0 };
      return o;
    };
    res.json({ cabinet: bloc("cab"), petite_caisse: bloc("pc"), procedure: bloc("pr") });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// GET /api/depenses?type=&statut=&dossier_id=&petite_caisse=&a_refacturer=
// Liste des dépenses du cabinet — donnée financière, pas juste une commodité
// de suivi personnel (contrairement aux rétrocessions/bulletins, une dépense
// n'a pas de « propriétaire » au sens rémunération) : gardée entièrement
// derrière depenses.consulter, sans exception pour ses propres soumissions
// — y compris pour le filtre a_refacturer (alimente le panneau « Facturer
// les temps / débours » de l'écran Facturation, réservé aux mêmes profils).
// a_refacturer=true : ne renvoie que les dépenses réellement décaissées,
// marquées refacturables au client, pas encore rattachées à une facture
// (diagnostic Facturation, 25/08/2026 — d.facture_id, prévu au schéma sous
// une autre forme (avance_pour_client/refacture) mais jamais câblé, cf.
// HISTORY.md).
router.get("/", requirePermission("depenses.consulter"), async (req, res) => {
  const { type, statut, dossier_id, petite_caisse, a_refacturer, nature, categorie, q, du, au, masquer_annulees, apres_coup } = req.query;
  const params = [];
  const clauses = [];
  if (type) { params.push(type); clauses.push(`d.type = $${params.length}::type_depense`); }
  // « annulee » : dépenses annulées après validation / décaissement ; « rejetee » : refusées avant paiement (sans les annulées,
  // qui passent aussi par le statut « rejetee » en base).
  if (statut === "annulee") clauses.push("d.annulee_le IS NOT NULL");
  else if (statut === "rejetee") clauses.push("d.statut = 'rejetee'::statut_depense", "d.annulee_le IS NULL");
  else if (statut) { params.push(statut); clauses.push(`d.statut = $${params.length}::statut_depense`); }
  if (masquer_annulees === "true") clauses.push("d.annulee_le IS NULL");
  if (apres_coup === "a_valider") clauses.push("d.apres_coup_statut = 'a_valider'");
  // Ordre de paiement (lot E) : « sans_ordre » = validée en attente d'ordre ; « donne » = ordre donné.
  if (req.query.ordre === "sans_ordre") clauses.push("d.ordre_paiement_le IS NULL");
  else if (req.query.ordre === "donne") clauses.push("d.ordre_paiement_le IS NOT NULL");
  if (categorie) { params.push(categorie); clauses.push(`d.categorie = $${params.length}::categorie_depense`); }
  if (q && String(q).trim()) { params.push(`%${String(q).trim()}%`); clauses.push(`(d.libelle ILIKE $${params.length} OR d.beneficiaire ILIKE $${params.length})`); }
  if (du && /^\d{4}-\d{2}-\d{2}$/.test(du)) { params.push(du); clauses.push(`d.date_depense >= $${params.length}::date`); }
  if (au && /^\d{4}-\d{2}-\d{2}$/.test(au)) { params.push(au); clauses.push(`d.date_depense <= $${params.length}::date`); }
  if (dossier_id) { params.push(dossier_id); clauses.push(`d.dossier_id = $${params.length}`); }
  if (nature) { params.push(nature); clauses.push(`d.nature = $${params.length}`); }
  if (petite_caisse !== undefined) { params.push(petite_caisse === "true"); clauses.push(`d.petite_caisse = $${params.length}`); }
  // Caisse (lot D) : « cabinet » = hors petite caisse et hors caisse frais de justice ; « petite_caisse » ; « procedure ».
  // Les vignettes se paient hors des caisses (stock acheté) : leur dépense reste avec les dépenses du cabinet.
  if (req.query.caisse === "cabinet") clauses.push("d.petite_caisse = FALSE AND d.caisse_procedure = FALSE");
  else if (req.query.caisse === "petite_caisse") clauses.push("d.petite_caisse = TRUE");
  else if (req.query.caisse === "procedure") clauses.push("d.caisse_procedure = TRUE");
  if (a_refacturer === "true") {
    clauses.push("d.refacturable_client = TRUE", "d.statut = 'decaissee'", "d.facture_id IS NULL");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.type, d.categorie, d.libelle, d.montant, d.date_depense, d.mode_paiement, d.references_paiement,
              d.petite_caisse, d.caisse_procedure, d.justificatif, d.refacturable_client, d.statut, d.recurrente,
              d.facture_id, d.dossier_id, d.nature, d.beneficiaire, c.intitule AS compte, d.compte_id,
              d.ordre_paiement_le, d.blocage_motif, d.blocage_le, (d.mode_paiement IS NOT NULL) AS moyen_defini,
              (SELECT COUNT(*) FROM depense_pieces p WHERE p.depense_id = d.id)::int AS nb_pieces,
              (SELECT COUNT(*) FROM depense_pieces p WHERE p.depense_id = d.id AND p.type = 'devis')::int AS nb_devis,
              EXISTS (SELECT 1 FROM depense_pieces p WHERE p.depense_id = d.id AND p.retenu) AS devis_retenu, dos.numero AS dossier_numero,
              d.soumis_par AS soumis_par_id, u.prenom || ' ' || u.nom AS soumis_par,
              d.engagee_par AS engagee_par_id, d.apres_coup_statut, d.apres_coup_motif,
              d.annulee_le, d.annulation_motif, d.statut_avant_annulation, d.motif_rejet,
              ua.prenom || ' ' || ua.nom AS annulee_par_nom,
              (SELECT e.mois::text FROM etats_charges_lignes l JOIN etats_charges e ON e.id = l.etat_id WHERE l.depense_id = d.id LIMIT 1) AS etat_mois
       FROM depenses d
       LEFT JOIN utilisateurs ua ON ua.id = d.annulee_par
       LEFT JOIN comptes_bancaires c ON c.id = d.compte_id
       LEFT JOIN dossiers dos ON dos.id = d.dossier_id
       LEFT JOIN utilisateurs u ON u.id = d.soumis_par
       ${where}
       ORDER BY d.date_depense DESC, d.cree_le DESC LIMIT 300`,
      params
    );
    // Masquage du règlement (moyen, compte, références) : voir le bloc « Ordre de paiement » ci-dessus.
    const profil = await profilReglement(req);
    if (!profil.decideur) {
      for (const d of rows) {
        const visible = profil.executant && d.ordre_paiement_le && ["validee", "decaissee"].includes(d.statut);
        if (!visible) { d.mode_paiement = null; d.compte = null; d.compte_id = null; d.references_paiement = {}; }
        else if (d.statut !== "decaissee") d.references_paiement = {};
        if (!profil.executant) { d.blocage_motif = null; d.blocage_le = null; }
      }
    }
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/depenses/verifier-doublon?libelle=&montant=&date_depense=&dossier_id=
// (26/09/2026, audit doublons) — signale, sans jamais bloquer, une dépense
// déjà soumise avec le même libellé/montant/date (2 dépenses réellement
// identiques le même jour restent possibles — l'utilisateur décide).
router.get("/verifier-doublon", requirePermission("depenses.creer"), async (req, res) => {
  const { libelle, montant, date_depense, dossier_id } = req.query;
  if (!libelle || montant == null) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.libelle, d.montant, d.date_depense, d.statut
       FROM depenses d
       WHERE d.libelle ILIKE $1 AND d.montant = $2 AND d.date_depense = COALESCE($3, current_date)
         AND ($4::uuid IS NULL OR d.dossier_id = $4)`,
      [libelle, montant, date_depense || null, dossier_id || null]
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
  const b = { ...(req.body || {}) };
  // Le moyen et le compte relèvent de l'ordre de paiement des associés : ignorés pour les autres déposants.
  if (!(await profilReglement(req)).decideur) { delete b.mode_paiement; delete b.compte_id; delete b.references; }
  if (b.petite_caisse && estDebours(b.categorie)) return res.status(409).json({ error: MSG_DEBOURS });
  if (b.petite_caisse && !(await categoriesPetiteCaisse()).includes(b.categorie || "autre")) return res.status(409).json({ error: MSG_CATEGORIE });
  if (!b.type || !b.libelle || b.montant == null) return res.status(400).json({ error: "type, libelle et montant requis" });
  const n = resoudreNature(b, null);
  if (n.erreur) return res.status(400).json({ error: n.erreur });
  // Moyen, compte compatible et références (non exigées avant le paiement effectif).
  let regl = { valeurs: { mode_paiement: null, compte_id: b.compte_id || null, references: {} } };
  if (b.mode_paiement) {
    regl = await preparerDecaissement(pool, b, { exigerReferences: false });
    if (regl.erreur) return res.status(400).json({ error: regl.erreur });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO depenses
         (nature, type, categorie, libelle, montant, date_depense, mode_paiement, compte_id,
          petite_caisse, justificatif, refacturable_client, dossier_id, recurrente,
          soumis_par, cree_par, references_paiement, beneficiaire)
       VALUES ($14,$1::type_depense,COALESCE($2::categorie_depense,'autre'),$3,$4,COALESCE($5,current_date),
               $6,$7,COALESCE($8,false),COALESCE($9,false),COALESCE($10,false),$11,COALESCE($12,false),$13,$13,$15::jsonb,$16)
       RETURNING id, nature, type, categorie, libelle, montant, statut`,
      [b.type, b.categorie, b.libelle, b.montant, b.date_depense || null, regl.valeurs.mode_paiement,
       regl.valeurs.compte_id, b.petite_caisse, b.justificatif, n.nature === "dossier" ? b.refacturable_client : false,
       n.dossierId, b.recurrente, req.user.sub, n.nature, JSON.stringify(regl.valeurs.references),
       String(b.beneficiaire || '').trim().slice(0, 160) || null]
    );
    // Centre de notifications (lot 2) : les décideurs sont prévenus (jamais l'auteur) ; pas de montant dans le texte.
    if (rows[0].statut === "soumise") {
      await notif.notifier({ type: "depense_soumise", destinataires: await notif.titulairesPermission("depenses.decision"),
        auteurId: req.user.sub, ref: rows[0].id, aTraiter: true });
    }
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------
// Petite caisse renforcée (17/10/2026) : engagement d'une petite dépense
// SANS validation préalable, validée APRÈS COUP par un associé AUTRE que
// l'engageur. Garde-fous : plafond par dépense (paramétré), solde du mois
// (dotation − dépenses) jamais dépassé, moyen de paiement obligatoire,
// tout est tracé. Au-delà du plafond : circuit normal (soumise → validée).
// ---------------------------------------------------------------------
router.post("/engager", requirePermission("depenses.engager"), async (req, res) => {
  const b = req.body || {};
  const c = caisseDe(b.caisse);
  const montant = Math.round(Number(b.montant));
  if (!b.libelle || !(montant > 0)) return res.status(400).json({ error: "libelle et montant positif requis" });
  if (!b.mode_paiement) return res.status(400).json({ error: "Moyen de paiement requis (mobile money recommandé)." });
  // Caisse frais de justice & débours : toujours liée à un dossier.
  const n = resoudreNature(c.dossierObligatoire ? { ...b, nature: "dossier" } : b, null);
  if (n.erreur) return res.status(400).json({ error: n.erreur });
  // Bénéficiaire saisi une seule fois (29/10/2026) : repris dans les références du moyen, et inversement.
  const refs = b.references && typeof b.references === "object" ? { ...b.references } : {};
  const beneficiaire = String(b.beneficiaire || refs.beneficiaire || "").trim().slice(0, 160) || null;
  if (beneficiaire && !refs.beneficiaire) refs.beneficiaire = beneficiaire;
  // L'argent sort tout de suite : les références du moyen sont exigées.
  const regl = await preparerDecaissement(pool, { ...b, references: refs }, { exigerReferences: true });
  if (regl.erreur) return res.status(400).json({ error: regl.erreur });
  try {
    const plafond = await plafondCaisse(c);
    if (plafond == null) {
      return res.status(409).json({ error: `Le plafond par dépense de ${c.nom} n'est pas encore défini (Accès & permissions → Seuils). Passez par le circuit normal de validation.` });
    }
    if (montant > Number(plafond)) {
      return res.status(409).json({ error: `Montant supérieur au plafond de ${c.nom} (${Number(plafond)}). Soumettez la dépense au circuit normal de validation.` });
    }
    const refus = await controlerCaisse(c, { categorie: b.categorie, beneficiaire, dossierId: n.dossierId, montant, date: b.date_depense, plafond });
    if (refus) return res.status(409).json({ error: refus });
    const mois = premierDuMois(b.date_depense ? new Date(b.date_depense) : new Date());
    const caisse = await soldePetiteCaisse(mois, c);
    if (!caisse.dotee) {
      return res.status(409).json({ error: `${maj(c.nom)} n'est pas dotée pour ce mois.` });
    }
    if (montant > caisse.solde) {
      return res.status(409).json({ error: `Solde de la petite caisse insuffisant (reste ${caisse.solde}).`, solde: caisse.solde });
    }
    const { rows } = await pool.query(
      `INSERT INTO depenses
         (nature, type, categorie, libelle, montant, date_depense, mode_paiement, compte_id,
          petite_caisse, justificatif, refacturable_client, dossier_id,
          statut, soumis_par, cree_par, engagee_par, engagee_le, decaisse_par, decaisse_le, apres_coup_statut, references_paiement, beneficiaire,
          ordre_paiement_le, ordre_paiement_par, caisse_procedure)
       VALUES ($1,'ponctuelle',COALESCE($2::categorie_depense,'autre'),$3,$4,COALESCE($5::date,current_date),$6::mode_paiement,$7,
               $14::boolean,COALESCE($8,false),$9,$10,
               'decaissee',$11,$11,$11,now(),$11,now(),'a_valider',$12::jsonb,$13,
               now(),$11,$15::boolean)
       RETURNING id, nature, libelle, montant, statut, apres_coup_statut`,
      [n.nature, b.categorie || null, b.libelle, montant, b.date_depense || null, regl.valeurs.mode_paiement, regl.valeurs.compte_id,
       b.justificatif, n.nature === "dossier" ? (c.code === "procedure" ? b.refacturable_client !== false : !!b.refacturable_client) : false, n.dossierId, req.user.sub,
       JSON.stringify(regl.valeurs.references), beneficiaire, c.code === "petite_caisse", c.code === "procedure"]
    );
    await logAudit({ utilisateurId: req.user.sub, action: "engager_depense", entite: "depenses", entiteId: rows[0].id,
      details: { montant, libelle: b.libelle, mode_paiement: b.mode_paiement, solde_avant: caisse.solde, caisse: c.code }, ip: req.ip });
    // Centre de notifications (lot 2) : un autre associé doit valider après coup (jamais l'engageur) ; solde bas (20 %).
    await notif.notifier({ type: "depense_apres_coup", destinataires: await notif.titulairesPermission("depenses.decision"),
      auteurId: req.user.sub, ref: rows[0].id, aTraiter: true, charge: { caisse: c.code } });
    await signalerFractionnement(c, rows[0].id, req.user.sub, beneficiaire, n.dossierId, b.date_depense);
    const refMois = (c.code === "procedure" ? "solde_bas_proc:" : "solde_bas:") + mois.slice(0, 7);
    if (caisse.dotation > 0 && caisse.solde - montant <= caisse.dotation * 0.2 && !(await notif.dejaNotifie("caisse_alerte", refMois))) {
      await notif.notifier({ type: "caisse_alerte", destinataires: await notif.titulairesPermissions(["depenses.petite_caisse.doter", "depenses.decision"]),
        auteurId: req.user.sub, ref: refMois, charge: { sujet: "solde_bas", caisse: c.code } });
    }
    res.status(201).json({ ...rows[0], solde_restant: caisse.solde - montant });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// Validation (ou contestation) APRÈS COUP d'une dépense engagée — associés
// (depenses.decision), jamais l'engageur lui-même.
router.post("/:id/valider-apres-coup", requirePermission("depenses.decision"), async (req, res) => {
  const { decision, motif } = req.body || {};
  if (!["validee", "contestee"].includes(decision)) return res.status(400).json({ error: "decision : validee ou contestee" });
  if (decision === "contestee" && !motif) return res.status(400).json({ error: "Un motif est requis pour contester une dépense." });
  try {
    const { rows: [d] } = await pool.query("SELECT engagee_par, apres_coup_statut FROM depenses WHERE id = $1", [req.params.id]);
    if (!d) return res.status(404).json({ error: "Dépense introuvable" });
    if (d.apres_coup_statut !== "a_valider") return res.status(409).json({ error: "Cette dépense n'est pas en attente de validation après coup." });
    if (d.engagee_par === req.user.sub) {
      return res.status(403).json({ error: "Vous ne pouvez pas valider une dépense que vous avez vous-même engagée : un autre associé doit le faire." });
    }
    const { rowCount: aCorrige } = await pool.query(
      "SELECT 1 FROM journal_audit WHERE action = 'corriger_depense_engagee' AND entite = 'depenses' AND entite_id = $1 AND utilisateur_id = $2 LIMIT 1", [req.params.id, req.user.sub]);
    if (aCorrige) return res.status(403).json({ error: "Vous avez corrigé cette dépense : un autre associé doit la valider." });
    const { rows } = await pool.query(
      `UPDATE depenses SET apres_coup_statut = $1::varchar, apres_coup_par = $2::uuid, apres_coup_le = now(), apres_coup_motif = $3,
              valide_par = CASE WHEN $1::varchar = 'validee' THEN $2::uuid ELSE valide_par END,
              valide_le = CASE WHEN $1::varchar = 'validee' THEN now() ELSE valide_le END
       WHERE id = $4 AND apres_coup_statut = 'a_valider' RETURNING id, apres_coup_statut`,
      [decision, req.user.sub, motif || null, req.params.id]
    );
    if (!rows[0]) return res.status(409).json({ error: "Déjà traitée entre-temps." });
    await notif.traiter("depense_apres_coup", req.params.id);
    await notif.notifier({ type: "depense_apres_coup_traitee", destinataires: [d.engagee_par], auteurId: req.user.sub, ref: req.params.id,
      niveau: decision === "contestee" ? "action" : "information", charge: { decision, motif: motif || undefined } });
    if (decision === "contestee") {
      await notif.notifier({ type: "depense_contestee", destinataires: await notif.titulairesPermission("depenses.decision"),
        auteurId: req.user.sub, ref: req.params.id });
    }
    await logAudit({ utilisateurId: req.user.sub, action: decision === "validee" ? "valider_apres_coup" : "contester_depense", entite: "depenses", entiteId: req.params.id, details: { motif: motif || null }, ip: req.ip });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Correction d'une dépense ENGAGÉE sur la petite caisse (06/11/2026).
// Qui : l'engageur lui-même (depenses.engager) ou un décideur (depenses.decision, les associés) —
// les erreurs de saisie de l'administration générale sont fréquentes et un associé doit pouvoir les
// corriger. Quand : tant que la dépense est « à valider » ou « contestée » (une correction la remet « à valider ») ;
// une dépense déjà validée après coup n'accepte que les corrections de forme, par un décideur (libellé,
// catégorie, bénéficiaire, moyen et références, justificatif) : ni montant, ni date, ni nature. Une dépense
// annulée est verrouillée. Garde-fous de l'engagement rejoués si montant ou date changent. Tout est tracé
// (avant/après). Indépendance : celui qui a corrigé une dépense ne peut pas ensuite la valider
// (voir /valider-apres-coup) ; « engageur ≠ valideur » est inchangé.
router.put("/:id/engagee", async (req, res) => {
  const b = req.body || {};
  try {
    const { rows: [d] } = await pool.query(
      `SELECT id, nature, dossier_id, libelle, montant, categorie, mode_paiement, compte_id, references_paiement, beneficiaire,
              justificatif, engagee_par, apres_coup_statut, annulee_le, petite_caisse, caisse_procedure,
              to_char(date_depense, 'YYYY-MM-DD') AS date_depense
         FROM depenses WHERE id = $1`, [req.params.id]);
    if (!d) return res.status(404).json({ error: "Dépense introuvable" });
    if ((!d.petite_caisse && !d.caisse_procedure) || !d.engagee_par) return res.status(409).json({ error: "Cette dépense n'a pas été engagée sur une caisse." });
    const c = caisseDeLigne(d);
    const decideur = await estAutorise(req.user.role, "depenses.decision", req.user.sub);
    const engageur = d.engagee_par === req.user.sub && await estAutorise(req.user.role, "depenses.engager", req.user.sub);
    if (!decideur && !engageur) return res.status(403).json({ error: "Seul l'engageur de la dépense ou un associé peut la corriger." });
    if (d.annulee_le) return res.status(409).json({ error: "Dépense annulée — non modifiable." });
    const validee = d.apres_coup_statut === "validee";
    if (!["a_valider", "contestee", "validee"].includes(d.apres_coup_statut)) return res.status(409).json({ error: "Dépense non modifiable." });
    if (validee && !decideur) return res.status(403).json({ error: "Dépense déjà validée : seul un associé peut en corriger la forme." });

    const libelle = b.libelle !== undefined ? String(b.libelle).trim() : d.libelle;
    const montant = b.montant !== undefined && b.montant !== null && b.montant !== "" ? Math.round(Number(b.montant)) : Number(d.montant);
    if (!libelle || !(montant > 0)) return res.status(400).json({ error: "libelle et montant positif requis" });
    const dateDepense = b.date_depense || d.date_depense;
    const monnaieChange = montant !== Number(d.montant) || dateDepense !== d.date_depense;
    if (validee && monnaieChange) return res.status(409).json({ error: "Dépense déjà validée : montant et date ne sont plus modifiables (annulez-la puis ressaisissez-la si nécessaire)." });
    const n = resoudreNature(b, d);
    if (n.erreur) return res.status(400).json({ error: n.erreur });
    if (validee && (n.nature !== d.nature || (n.dossierId || null) !== (d.dossier_id || null))) {
      return res.status(409).json({ error: "Dépense déjà validée : la nature et le dossier ne sont plus modifiables." });
    }
    const refs = b.references && typeof b.references === "object" ? { ...b.references } : (d.references_paiement || {});
    const beneficiaire = b.beneficiaire !== undefined ? (String(b.beneficiaire || refs.beneficiaire || "").trim().slice(0, 160) || null) : d.beneficiaire;
    if (beneficiaire && !refs.beneficiaire) refs.beneficiaire = beneficiaire;
    const regl = await preparerDecaissement(pool, { mode_paiement: b.mode_paiement || d.mode_paiement, compte_id: b.compte_id !== undefined ? b.compte_id : d.compte_id, references: refs }, { exigerReferences: true });
    if (regl.erreur) return res.status(400).json({ error: regl.erreur });

    if (!validee) {
      const refus = await controlerCaisse(c, { categorie: b.categorie || d.categorie, beneficiaire, dossierId: n.dossierId, montant, date: dateDepense,
        plafond: await plafondCaisse(c), exclureId: d.id });
      if (refus) return res.status(409).json({ error: refus });
    }
    if (monnaieChange) {
      const plafond = await plafondCaisse(c);
      if (plafond != null && montant > Number(plafond)) {
        return res.status(409).json({ error: `Montant supérieur au plafond de ${c.nom} (${Number(plafond)}).` });
      }
      const moisNouveau = premierDuMois(new Date(dateDepense));
      const moisAncien = premierDuMois(new Date(d.date_depense));
      const caisse = await soldePetiteCaisse(moisNouveau, c);
      if (!caisse.dotee) return res.status(409).json({ error: `${maj(c.nom)} n'est pas dotée pour ce mois.` });
      const disponible = caisse.solde + (moisNouveau === moisAncien ? Number(d.montant) : 0);
      if (montant > disponible) return res.status(409).json({ error: `Solde de la petite caisse insuffisant (reste ${disponible}).`, solde: disponible });
    }

    const { rows } = await pool.query(
      `UPDATE depenses SET libelle = $1, montant = $2, date_depense = $3::date,
              categorie = COALESCE($4::categorie_depense, categorie), mode_paiement = $5::mode_paiement, compte_id = $6,
              references_paiement = $7::jsonb, beneficiaire = $8, justificatif = COALESCE($9, justificatif),
              nature = $10, dossier_id = $11,
              apres_coup_statut = CASE WHEN apres_coup_statut = 'contestee' THEN 'a_valider' ELSE apres_coup_statut END,
              apres_coup_par = CASE WHEN apres_coup_statut = 'contestee' THEN NULL ELSE apres_coup_par END,
              apres_coup_le = CASE WHEN apres_coup_statut = 'contestee' THEN NULL ELSE apres_coup_le END
        WHERE id = $12 AND apres_coup_statut = $13 AND annulee_le IS NULL
        RETURNING id, libelle, montant, statut, apres_coup_statut`,
      [libelle, montant, dateDepense, b.categorie || null, regl.valeurs.mode_paiement, regl.valeurs.compte_id,
       JSON.stringify(regl.valeurs.references), beneficiaire, b.justificatif ?? null, n.nature, n.dossierId, req.params.id, d.apres_coup_statut]);
    if (!rows[0]) return res.status(409).json({ error: "Dépense traitée entre-temps — non modifiable." });
    if (d.apres_coup_statut === "contestee") {
      await notif.notifier({ type: "depense_apres_coup", destinataires: await notif.titulairesPermission("depenses.decision"),
        auteurId: req.user.sub, ref: req.params.id, aTraiter: true, charge: { caisse: c.code } });
    }
    await logAudit({ utilisateurId: req.user.sub, action: "corriger_depense_engagee", entite: "depenses", entiteId: req.params.id,
      details: { par_engageur: d.engagee_par === req.user.sub, statut_apres_coup_avant: d.apres_coup_statut,
                 avant: { libelle: d.libelle, montant: Number(d.montant), date_depense: d.date_depense, mode_paiement: d.mode_paiement, beneficiaire: d.beneficiaire },
                 apres: { libelle, montant, date_depense: dateDepense, mode_paiement: regl.valeurs.mode_paiement, beneficiaire } }, ip: req.ip });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// Rapprochement mensuel : le solde réel du porte-monnaie (relevé de
// l'opérateur ou comptage des espèces) est comparé au solde calculé par JURIA.
router.post("/petite-caisse/rapprochement", requirePermission("depenses.petite_caisse.doter"), async (req, res) => {
  const b = req.body || {};
  if (b.solde_reel == null || isNaN(Number(b.solde_reel))) return res.status(400).json({ error: "solde_reel requis" });
  try {
    const c = caisseDe(b.caisse);
    const mois = (b.mois && moisNormalise(b.mois)) || premierDuMois();
    const { solde } = await soldePetiteCaisse(mois, c);
    const reel = Math.round(Number(b.solde_reel));
    const { rows } = await pool.query(
      `INSERT INTO rapprochements_petite_caisse (mois, solde_calcule, solde_reel, ecart, note, fait_par, caisse)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, mois, solde_calcule, solde_reel, ecart, note, fait_le`,
      [mois, solde, reel, reel - solde, b.note || null, req.user.sub, c.code]
    );
    await logAudit({ utilisateurId: req.user.sub, action: "rapprochement_petite_caisse", entite: "depenses", entiteId: rows[0].id, details: { mois, ecart: rows[0].ecart, caisse: c.code }, ip: req.ip });
    if (Number(rows[0].ecart) !== 0) {
      await notif.notifier({ type: "caisse_alerte", destinataires: await notif.titulairesPermissions(["depenses.petite_caisse.doter", "depenses.decision"]),
        auteurId: req.user.sub, ref: "ecart:" + rows[0].id, charge: { sujet: "ecart", caisse: c.code } });
    }
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
});

router.get("/petite-caisse/rapprochements", requirePermission("depenses.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.mois, r.solde_calcule, r.solde_reel, r.ecart, r.note, r.fait_le, u.prenom || ' ' || u.nom AS fait_par
       FROM rapprochements_petite_caisse r LEFT JOIN utilisateurs u ON u.id = r.fait_par
       WHERE r.caisse = $1
       ORDER BY r.fait_le DESC LIMIT 24`, [caisseDe(req.query.caisse).code]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Annulation d'une dépense VALIDÉE ou DÉCAISSÉE, avec motif (associés,
// depenses.decision) — 17/10/2026. Jamais de suppression : la ligne reste,
// barrée et tracée. Passe en statut « rejetee » pour être exclue d'elle-même
// de toutes les sommes. Refusée si la dépense est déjà refacturée sur une
// facture, liée à une vignette de plaidoirie ou à une échéance administrative
// (il faudrait d'abord défaire ces liens).
router.post("/:id/annuler", requirePermission("depenses.decision"), async (req, res) => {
  const motif = ((req.body || {}).motif || "").trim();
  if (!motif) return res.status(400).json({ error: "Un motif est requis pour annuler une dépense." });
  try {
    const { rows: [d] } = await pool.query("SELECT statut, facture_id FROM depenses WHERE id = $1", [req.params.id]);
    if (!d) return res.status(404).json({ error: "Dépense introuvable" });
    if (!["validee", "decaissee"].includes(d.statut)) {
      return res.status(409).json({ error: "Seule une dépense validée ou décaissée peut être annulée (une dépense soumise se rejette ou se retire)." });
    }
    if (d.facture_id) return res.status(409).json({ error: "Dépense déjà refacturée sur une facture : retirez-la de la facture (ou annulez la facture) avant de l'annuler." });
    const lie = await pool.query(
      `SELECT (SELECT count(*) FROM vignettes_plaidoirie WHERE depense_id = $1) AS vignettes,
              (SELECT count(*) FROM echeances_administratives WHERE depense_id = $1) AS echeances`, [req.params.id]);
    if (Number(lie.rows[0].vignettes) > 0) return res.status(409).json({ error: "Dépense liée à une vignette de plaidoirie : non annulable ici." });
    if (Number(lie.rows[0].echeances) > 0) return res.status(409).json({ error: "Dépense liée à une échéance administrative : non annulable ici." });
    const { rows } = await pool.query(
      `UPDATE depenses SET statut_avant_annulation = statut, statut = 'rejetee'::statut_depense,
              annulee_le = now(), annulee_par = $1::uuid, annulation_motif = $2, motif_rejet = $2
       WHERE id = $3 AND statut IN ('validee','decaissee') AND facture_id IS NULL
       RETURNING id, statut, statut_avant_annulation`,
      [req.user.sub, motif, req.params.id]
    );
    if (!rows[0]) return res.status(409).json({ error: "Déjà traitée entre-temps." });
    await logAudit({ utilisateurId: req.user.sub, action: "annuler_depense", entite: "depenses", entiteId: req.params.id, details: { motif, statut_avant: rows[0].statut_avant_annulation }, ip: req.ip });
    await notif.traiter("depense_a_decaisser", req.params.id);
    const { rows: [so] } = await pool.query("SELECT soumis_par FROM depenses WHERE id = $1", [req.params.id]);
    const aPrevenir = [so && so.soumis_par, ...(await notif.titulairesPermission("depenses.decision"))];
    await notif.notifier({ type: "depense_annulee", destinataires: aPrevenir, auteurId: req.user.sub, ref: req.params.id, charge: { motif } });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Historique des dotations mensuelles de la petite caisse.
router.get("/petite-caisse/dotations", requirePermission("depenses.petite_caisse.doter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.mois, d.montant_alloue, d.cree_le, u.prenom || ' ' || u.nom AS par
       FROM dotations_petite_caisse d LEFT JOIN utilisateurs u ON u.id = d.administrateur_id
       WHERE d.caisse = $1
       ORDER BY d.mois DESC LIMIT 24`, [caisseDe(req.query.caisse).code]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Achats de vignettes (approvisionnements) — consultation et suppression d'un
// achat saisi par erreur, tant qu'aucun de ses numéros n'a servi.
router.get("/vignettes/achats", requirePermission("depenses.vignettes.mouvement"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT v.id, v.quantite, v.numero_debut, v.numero_fin, v.date_mouvement, u.prenom || ' ' || u.nom AS par,
              (SELECT count(*) FROM vignettes_numeros_stock n WHERE n.achat_id = v.id)::int AS nb_numeros,
              (SELECT count(*) FROM vignettes_numeros_stock n WHERE n.achat_id = v.id AND NOT n.disponible)::int AS nb_utilises
       FROM vignettes_plaidoirie v LEFT JOIN utilisateurs u ON u.id = v.cree_par
       WHERE v.mouvement = 'achat' ORDER BY v.date_mouvement DESC, v.id LIMIT 50`);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

router.delete("/vignettes/achats/:id", requirePermission("depenses.vignettes.mouvement"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [a] } = await client.query("SELECT quantite FROM vignettes_plaidoirie WHERE id = $1 AND mouvement = 'achat' FOR UPDATE", [req.params.id]);
    if (!a) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Achat introuvable" }); }
    const utilises = await client.query("SELECT count(*) AS n FROM vignettes_numeros_stock WHERE achat_id = $1 AND NOT disponible", [req.params.id]);
    if (Number(utilises.rows[0].n) > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Des vignettes de cet achat ont déjà été utilisées : suppression impossible." });
    }
    const stock = await client.query("SELECT stock FROM v_stock_vignettes");
    if (Number(stock.rows[0].stock) - Number(a.quantite) < 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Supprimer cet achat rendrait le stock négatif (des vignettes ont déjà été utilisées)." });
    }
    await client.query("DELETE FROM vignettes_numeros_stock WHERE achat_id = $1", [req.params.id]);
    await client.query("DELETE FROM vignettes_plaidoirie WHERE id = $1", [req.params.id]);
    await client.query("COMMIT");
    await logAudit({ utilisateurId: req.user.sub, action: "supprimer_achat_vignettes", entite: "vignettes_plaidoirie", entiteId: req.params.id, details: { quantite: a.quantite }, ip: req.ip });
    res.status(204).end();
  } catch (e) { await client.query("ROLLBACK"); console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
  finally { client.release(); }
});

// Vignettes utilisées (28/10/2026) — liste et annulation d'une utilisation (saisie de test ou d'erreur,
// y compris une vignette « orpheline » dont l'instance a été retirée du dossier). Le numéro redevient
// disponible dans le stock et la dépense « Vignette de plaidoirie n°… » créée à l'utilisation est supprimée.
router.get("/vignettes/utilisations", requirePermission("depenses.vignettes.mouvement"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT v.id, v.numero_vignette, v.date_mouvement, v.refacturee, v.instance_id,
              d.numero AS dossier_numero, d.intitule AS dossier_intitule, u.prenom || ' ' || u.nom AS par
       FROM vignettes_plaidoirie v
       LEFT JOIN dossiers d ON d.id = v.dossier_id
       LEFT JOIN utilisateurs u ON u.id = v.cree_par
       WHERE v.mouvement = 'utilisation' ORDER BY v.date_mouvement DESC, v.cree_le DESC LIMIT 100`);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

router.delete("/vignettes/utilisations/:id", requirePermission("depenses.vignettes.mouvement"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [u] } = await client.query(
      "SELECT id, numero_vignette, dossier_id, depense_id FROM vignettes_plaidoirie WHERE id = $1 AND mouvement = 'utilisation' FOR UPDATE", [req.params.id]);
    if (!u) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Utilisation introuvable" }); }
    await client.query("UPDATE vignettes_numeros_stock SET disponible = TRUE, utilisation_id = NULL WHERE utilisation_id = $1", [u.id]);
    await client.query("DELETE FROM vignettes_plaidoirie WHERE id = $1", [u.id]);
    if (u.depense_id) await client.query("DELETE FROM depenses WHERE id = $1 AND categorie = 'vignette_plaidoirie'", [u.depense_id]);
    await client.query("COMMIT");
    await logAudit({ utilisateurId: req.user.sub, action: "annuler_utilisation_vignette", entite: "vignettes_plaidoirie", entiteId: u.id,
      details: { numero_vignette: u.numero_vignette, dossier_id: u.dossier_id }, ip: req.ip });
    res.status(204).end();
  } catch (e) {
    await client.query("ROLLBACK"); console.error(e);
    if (e.code === "23503") return res.status(409).json({ error: "La dépense liée à cette vignette est référencée ailleurs : annulation impossible." });
    res.status(500).json({ error: "Erreur serveur" });
  } finally { client.release(); }
});

// PUT /api/depenses/:id — corriger une dépense avant décision (19/09/2026,
// gap comblé — jusqu'ici seul recours : la rejeter puis la resaisir).
// Restreint au déposant lui-même OU à quelqu'un habilité à décider
// (depenses.decision) — pas n'importe qui avec depenses.creer, pour éviter
// qu'une tierce personne corrige la dépense d'un collègue sans lien avec
// elle. Verrouillée dès que la décision est prise (statut ≠ 'soumise') —
// même principe que les autres corrections « avant qu'un engagement soit
// pris » déjà dans JURIA (facture non payée, instance...).
router.put("/:id", requirePermission("depenses.creer"), async (req, res) => {
  const b = { ...(req.body || {}) };
  if (!(await profilReglement(req)).decideur) { delete b.mode_paiement; delete b.compte_id; delete b.references; }
  try {
    const { rows: [actuelle] } = await pool.query("SELECT soumis_par, statut, nature, dossier_id, petite_caisse, categorie FROM depenses WHERE id = $1", [req.params.id]);
    if (!actuelle) return res.status(404).json({ error: "Dépense introuvable" });
    const veutPetiteCaisse = b.petite_caisse !== undefined ? !!b.petite_caisse : actuelle.petite_caisse;
    if (veutPetiteCaisse && estDebours(b.categorie || actuelle.categorie)) return res.status(409).json({ error: MSG_DEBOURS });
    if (veutPetiteCaisse && !(await categoriesPetiteCaisse()).includes(b.categorie || actuelle.categorie)) return res.status(409).json({ error: MSG_CATEGORIE });
    const n = resoudreNature(b, actuelle);
    if (n.erreur) return res.status(400).json({ error: n.erreur });
    const estDeposant = actuelle.soumis_par === req.user.sub;
    if (!estDeposant && !(await estAutorise(req.user.role, "depenses.decision", req.user.sub))) {
      return res.status(403).json({ error: "Seul le déposant ou une personne habilitée à décider peut corriger cette dépense." });
    }
    if (actuelle.statut !== "soumise") {
      return res.status(409).json({ error: "Dépense déjà traitée — non modifiable." });
    }
    // Moyen fourni : compte et références revalidés (compte vidé si le moyen n'en a pas).
    const modeFourni = !!b.mode_paiement;
    let regl = { valeurs: { mode_paiement: null, compte_id: null, references: {} } };
    if (modeFourni) {
      regl = await preparerDecaissement(pool, b, { exigerReferences: false });
      if (regl.erreur) return res.status(400).json({ error: regl.erreur });
    }
    const { rows } = await pool.query(
      `UPDATE depenses SET
         type = COALESCE($1::type_depense, type),
         categorie = COALESCE($2::categorie_depense, categorie),
         libelle = COALESCE($3, libelle),
         montant = COALESCE($4, montant),
         date_depense = COALESCE($5, date_depense),
         mode_paiement = COALESCE($6::mode_paiement, mode_paiement),
         compte_id = CASE WHEN $14::boolean THEN $7::uuid ELSE compte_id END,
         references_paiement = CASE WHEN $14::boolean THEN $15::jsonb ELSE references_paiement END,
         petite_caisse = COALESCE($8, petite_caisse),
         justificatif = COALESCE($9, justificatif),
         refacturable_client = COALESCE($10, refacturable_client),
         nature = $13,
         dossier_id = $11,
         beneficiaire = CASE WHEN $16::boolean THEN $17 ELSE beneficiaire END
       WHERE id = $12 AND statut = 'soumise'
       RETURNING id, type, categorie, libelle, montant, statut`,
      [b.type || null, b.categorie || null, b.libelle || null, b.montant ?? null,
       b.date_depense || null, regl.valeurs.mode_paiement, regl.valeurs.compte_id,
       b.petite_caisse, b.justificatif, n.nature === "dossier" ? b.refacturable_client : (b.refacturable_client === undefined ? undefined : false), n.dossierId, req.params.id, n.nature,
       modeFourni, JSON.stringify(regl.valeurs.references),
       Object.prototype.hasOwnProperty.call(b, "beneficiaire"), String(b.beneficiaire || "").trim().slice(0, 160) || null]
    );
    if (!rows[0]) return res.status(409).json({ error: "Dépense déjà traitée entre-temps — non modifiable." });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/depenses/:id — retirer une dépense soumise par erreur, avant
// toute décision (25/09/2026 — le déposant pouvait la corriger mais pas la
// retirer, contrairement aux congés/rétrocessions). Même contrôle que le PUT :
// déposant lui-même OU personne habilitée à décider ; verrouillé dès qu'une
// décision est prise (une dépense validée/rejetée reste tracée).
router.delete("/:id", requirePermission("depenses.creer"), async (req, res) => {
  try {
    const { rows: [actuelle] } = await pool.query("SELECT soumis_par, statut FROM depenses WHERE id = $1", [req.params.id]);
    if (!actuelle) return res.status(404).json({ error: "Dépense introuvable" });
    if (actuelle.soumis_par !== req.user.sub && !(await estAutorise(req.user.role, "depenses.decision", req.user.sub))) {
      return res.status(403).json({ error: "Seul le déposant ou une personne habilitée à décider peut retirer cette dépense." });
    }
    const { rowCount } = await pool.query("DELETE FROM depenses WHERE id = $1 AND statut = 'soumise'", [req.params.id]);
    if (!rowCount) return res.status(409).json({ error: "Dépense déjà traitée — non retirable." });
    await notif.traiter("depense_soumise", req.params.id);
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ---------------------------------------------------------------------
// Pièces d'une dépense (16/10/2026) : devis (plusieurs possibles, soumis
// pour choix), facture, preuve de paiement. Un devis n'est jamais
// obligatoire. Seul le valideur (depenses.decision) « retient » un devis.
// Dépôt de pièces (devis compris) possible À TOUT MOMENT, y compris après
// le décaissement (lot C, 11/11/2026) : par le déposant, par les associés et
// par les exécutants du paiement (depenses.decaisser : preuve de paiement,
// facture). Le choix du devis retenu reste réservé aux associés, avant la décision.
// ---------------------------------------------------------------------
async function peutGererPieces(req, depenseId) {
  const { rows: [d] } = await pool.query("SELECT soumis_par, statut FROM depenses WHERE id = $1", [depenseId]);
  if (!d) return { code: 404, erreur: "Dépense introuvable" };
  const decideur = await estAutorise(req.user.role, "depenses.decision", req.user.sub);
  if (d.soumis_par !== req.user.sub && !decideur && !(await estAutorise(req.user.role, "depenses.decaisser", req.user.sub))) {
    return { code: 403, erreur: "Seul le déposant, un associé ou une personne chargée du décaissement peut gérer les pièces de cette dépense." };
  }
  return { depense: d, decideur };
}

router.get("/:id/pieces", requirePermission("depenses.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.type, p.nom, p.type_mime, p.taille_octets, p.retenu, p.retenu_le, p.ajoute_le,
              u.prenom || ' ' || u.nom AS ajoute_par, p.ajoute_par AS ajoute_par_id
       FROM depense_pieces p LEFT JOIN utilisateurs u ON u.id = p.ajoute_par
       WHERE p.depense_id = $1 ORDER BY p.ajoute_le`, [req.params.id]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

router.post("/:id/pieces", requirePermission("depenses.creer"), upload.single("fichier"), async (req, res) => {
  const type = (req.body && req.body.type) || "autre";
  if (!["devis", "facture", "preuve_paiement", "autre"].includes(type)) return res.status(400).json({ error: "type de pièce invalide" });
  if (!req.file) return res.status(400).json({ error: "Fichier manquant" });
  try {
    const g = await peutGererPieces(req, req.params.id);
    if (g.erreur) return res.status(g.code).json({ error: g.erreur });
    const dest = `depenses/${req.params.id}/${Date.now()}_${req.file.originalname}`.replace(/\s+/g, "_");
    const chemin = await saveObject(req.file.buffer, dest, req.file.mimetype);
    const { rows } = await pool.query(
      `INSERT INTO depense_pieces (depense_id, type, nom, type_mime, taille_octets, chemin_storage, ajoute_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, type, nom, retenu`,
      [req.params.id, type, req.file.originalname, req.file.mimetype, req.file.size, chemin, req.user.sub]);
    await logAudit({ utilisateurId: req.user.sub, action: "ajouter_piece_depense", entite: "depenses", entiteId: req.params.id, details: { piece_id: rows[0].id, type, nom: req.file.originalname }, ip: req.ip });
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
});

router.get("/:id/pieces/:pieceId/fichier", requirePermission("depenses.consulter"), async (req, res) => {
  try {
    const { rows: [p] } = await pool.query("SELECT nom, type_mime, chemin_storage FROM depense_pieces WHERE id = $1 AND depense_id = $2", [req.params.pieceId, req.params.id]);
    if (!p) return res.status(404).json({ error: "Pièce introuvable" });
    const buf = await readObject(p.chemin_storage);
    res.setHeader("Content-Type", p.type_mime || "application/octet-stream");
    res.setHeader("Content-Disposition", enteteContentDisposition(p.nom));
    res.send(buf);
  } catch (e) {
    if (e instanceof FichierIntrouvableError) return res.status(404).json({ error: "Le fichier de cette pièce n'est plus disponible dans le stockage." });
    console.error(e); res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/:id/pieces/:pieceId/retenir", requirePermission("depenses.decision"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [d] } = await client.query("SELECT statut FROM depenses WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!d) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Dépense introuvable" }); }
    if (d.statut !== "soumise") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Le choix du devis se fait avant la décision sur la dépense." }); }
    const { rows: [p] } = await client.query("SELECT type FROM depense_pieces WHERE id = $1 AND depense_id = $2", [req.params.pieceId, req.params.id]);
    if (!p) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Pièce introuvable" }); }
    if (p.type !== "devis") { await client.query("ROLLBACK"); return res.status(400).json({ error: "Seul un devis peut être retenu." }); }
    await client.query("UPDATE depense_pieces SET retenu = FALSE, retenu_par = NULL, retenu_le = NULL WHERE depense_id = $1 AND retenu", [req.params.id]);
    await client.query("UPDATE depense_pieces SET retenu = TRUE, retenu_par = $1, retenu_le = now() WHERE id = $2", [req.user.sub, req.params.pieceId]);
    await client.query("COMMIT");
    await logAudit({ utilisateurId: req.user.sub, action: "retenir_devis_depense", entite: "depenses", entiteId: req.params.id, details: { piece_id: req.params.pieceId }, ip: req.ip });
    res.json({ depense_id: req.params.id, piece_id: req.params.pieceId, retenu: true });
  } catch (e) { await client.query("ROLLBACK"); console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
  finally { client.release(); }
});

router.delete("/:id/pieces/:pieceId", requirePermission("depenses.creer"), async (req, res) => {
  try {
    const g = await peutGererPieces(req, req.params.id);
    if (g.erreur) return res.status(g.code).json({ error: g.erreur });
    // Après la décision : un associé, ou la personne qui a ajouté la pièce (erreur de dépôt).
    const { rows: [p] } = await pool.query(
      `DELETE FROM depense_pieces WHERE id = $1 AND depense_id = $2 AND ($3::boolean OR $4::boolean OR ajoute_par = $5::uuid)
       RETURNING chemin_storage, nom, type`,
      [req.params.pieceId, req.params.id, g.depense.statut === "soumise", g.decideur, req.user.sub]);
    if (!p) return res.status(404).json({ error: "Pièce introuvable, ou retrait réservé à un associé après la décision." });
    await deleteObject(p.chemin_storage);
    await logAudit({ utilisateurId: req.user.sub, action: "retirer_piece_depense", entite: "depenses", entiteId: req.params.id, details: { nom: p.nom, type: p.type }, ip: req.ip });
    res.status(204).end();
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/depenses/:id/decision  { statut: 'validee'|'rejetee', motif_rejet?, mode_paiement?, compte_id?, references? }
// (associés). Validation avec moyen (+ compte) = ORDRE DE PAIEMENT donné d'un coup ; sans moyen, la dépense reste « validée, en
// attente d'ordre de paiement » (voir POST /:id/ordre-paiement). Le rejet exige un motif.
router.post("/:id/decision", requirePermission("depenses.decision"), async (req, res) => {
  const b = req.body || {};
  const { statut, motif_rejet } = b;
  if (!["validee", "rejetee"].includes(statut)) return res.status(400).json({ error: "Statut invalide" });
  if (statut === "rejetee" && !String(motif_rejet || "").trim()) return res.status(400).json({ error: "Un motif est requis pour rejeter une dépense." });
  let ordre = null;
  if (statut === "validee" && b.mode_paiement) {
    const r = await verifierOrdre(b);
    if (r.erreur) return res.status(400).json({ error: r.erreur });
    ordre = r.valeurs;
  }
  try {
    const { rows } = await pool.query(
      `UPDATE depenses SET statut = $1::statut_depense, motif_rejet = $2, valide_par = $3, valide_le = now(),
              mode_paiement = CASE WHEN $5::boolean THEN $6::mode_paiement ELSE mode_paiement END,
              compte_id = CASE WHEN $5::boolean THEN $7::uuid ELSE compte_id END,
              references_paiement = CASE WHEN $5::boolean THEN $8::jsonb ELSE references_paiement END,
              ordre_paiement_le = CASE WHEN $5::boolean THEN now() ELSE ordre_paiement_le END,
              ordre_paiement_par = CASE WHEN $5::boolean THEN $3::uuid ELSE ordre_paiement_par END
       WHERE id = $4 AND statut = 'soumise' RETURNING id, statut`,
      [statut, String(motif_rejet || "").trim() || null, req.user.sub, req.params.id, !!ordre,
       ordre ? ordre.mode_paiement : null, ordre ? ordre.compte_id : null, JSON.stringify(ordre ? ordre.references : {})]
    );
    if (!rows[0]) return res.status(404).json({ error: "Dépense introuvable ou déjà traitée" });
    await notif.traiter("depense_soumise", req.params.id);
    const { rows: [so] } = await pool.query("SELECT soumis_par FROM depenses WHERE id = $1", [req.params.id]);
    await notif.notifier({ type: "depense_decidee", destinataires: [so && so.soumis_par], auteurId: req.user.sub, ref: req.params.id,
      charge: { decision: statut, motif: statut === "rejetee" ? String(motif_rejet).trim() : undefined } });
    // « À décaisser » ne part vers les exécutants qu'une fois l'ordre de paiement donné.
    if (statut === "validee" && ordre) {
      await notif.notifier({ type: "depense_a_decaisser", destinataires: await notif.titulairesPermission("depenses.decaisser"),
        auteurId: req.user.sub, ref: req.params.id, aTraiter: true });
    }
    res.json({ ...rows[0], ordre_donne: !!ordre });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/depenses/:id/ordre-paiement  { mode_paiement, compte_id?, references? }  (associés)
// Donne (ou corrige) l'ordre de paiement d'une dépense validée non encore décaissée : moyen + compte à débiter. Efface un
// éventuel blocage signalé par l'exécutant et prévient les exécutants quand l'ordre est donné pour la première fois ou après blocage.
router.post("/:id/ordre-paiement", requirePermission("depenses.decision"), async (req, res) => {
  const r = await verifierOrdre(req.body || {});
  if (r.erreur) return res.status(400).json({ error: r.erreur });
  try {
    const { rows: [d] } = await pool.query("SELECT statut, ordre_paiement_le, blocage_le, annulee_le FROM depenses WHERE id = $1", [req.params.id]);
    if (!d) return res.status(404).json({ error: "Dépense introuvable" });
    if (d.statut !== "validee" || d.annulee_le) return res.status(409).json({ error: "L'ordre de paiement se donne sur une dépense validée, non encore décaissée." });
    const v = r.valeurs;
    const { rows } = await pool.query(
      `UPDATE depenses SET mode_paiement = $1::mode_paiement, compte_id = $2::uuid, references_paiement = $3::jsonb,
              ordre_paiement_le = now(), ordre_paiement_par = $4::uuid, blocage_motif = NULL, blocage_par = NULL, blocage_le = NULL
       WHERE id = $5 AND statut = 'validee' RETURNING id, statut`,
      [v.mode_paiement, v.compte_id, JSON.stringify(v.references), req.user.sub, req.params.id]);
    if (!rows[0]) return res.status(409).json({ error: "Dépense déjà traitée entre-temps." });
    await logAudit({ utilisateurId: req.user.sub, action: "ordonner_paiement_depense", entite: "depenses", entiteId: req.params.id,
      details: { mode_paiement: v.mode_paiement, premier_ordre: !d.ordre_paiement_le, apres_blocage: !!d.blocage_le }, ip: req.ip });
    await notif.traiter("depense_blocage", req.params.id);
    if (!d.ordre_paiement_le || d.blocage_le) {
      await notif.notifier({ type: "depense_a_decaisser", destinataires: await notif.titulairesPermission("depenses.decaisser"),
        auteurId: req.user.sub, ref: req.params.id, aTraiter: true });
    }
    res.json({ ...rows[0], ordre_donne: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/depenses/:id/blocage  { motif }  (exécutants) : signale un empêchement (solde insuffisant, chèque indisponible…).
// Les associés sont prévenus ; le décaissement reste bloqué pour les exécutants jusqu'à un nouvel ordre de paiement.
router.post("/:id/blocage", requirePermission("depenses.decaisser"), async (req, res) => {
  const motif = String((req.body || {}).motif || "").trim().slice(0, 300);
  if (!motif) return res.status(400).json({ error: "Précisez le motif du blocage." });
  try {
    const { rows } = await pool.query(
      `UPDATE depenses SET blocage_motif = $1, blocage_par = $2::uuid, blocage_le = now()
       WHERE id = $3 AND statut = 'validee' AND annulee_le IS NULL RETURNING id`, [motif, req.user.sub, req.params.id]);
    if (!rows[0]) return res.status(409).json({ error: "Le blocage ne se signale que sur une dépense validée, non encore décaissée." });
    await logAudit({ utilisateurId: req.user.sub, action: "signaler_blocage_depense", entite: "depenses", entiteId: req.params.id, details: { motif }, ip: req.ip });
    await notif.notifier({ type: "depense_blocage", destinataires: await notif.titulairesPermission("depenses.decision"),
      auteurId: req.user.sub, ref: req.params.id, aTraiter: true, charge: { motif: motif.slice(0, 140) } });
    res.json({ id: req.params.id, bloquee: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/depenses/:id/decaisser  (exécution : comptable/admin générale ; associés aussi)
// Un exécutant ne peut décaisser qu'une dépense dont l'ordre de paiement est donné : il saisit seulement les références
// (le moyen et le compte sont ceux de l'ordre). Un associé peut tout faire d'un seul geste (ordre + exécution).
router.post("/:id/decaisser", requirePermission("depenses.decaisser"), async (req, res) => {
  const b = req.body || {};
  try {
    const decideur = await estAutorise(req.user.role, "depenses.decision", req.user.sub);
    const { rows: [d] } = await pool.query(
      `SELECT statut, montant, mode_paiement, compte_id, references_paiement, beneficiaire, ordre_paiement_le, blocage_le
         FROM depenses WHERE id = $1`, [req.params.id]);
    if (!d || d.statut !== "validee") return res.status(404).json({ error: "La dépense doit être validée avant décaissement" });
    if (!decideur) {
      if (!d.ordre_paiement_le) return res.status(409).json({ error: "L'ordre de paiement n'a pas encore été donné par un associé : le décaissement est impossible pour le moment." });
      if (d.blocage_le) return res.status(409).json({ error: "Ce décaissement a été signalé comme bloqué : attendez le nouvel ordre de paiement d'un associé." });
    }
    // Justificatif exigé au-delà d'un seuil (réglage facultatif, 0 = désactivé) : au moins une facture ou une pièce « autre ».
    const { rows: [par] } = await pool.query("SELECT seuil_justificatif_decaissement AS seuil FROM parametres_cabinet WHERE id = 1");
    const seuil = Number(par && par.seuil);
    if (seuil > 0 && Number(d.montant) >= seuil) {
      const { rows: [j] } = await pool.query("SELECT 1 FROM depense_pieces WHERE depense_id = $1 AND type IN ('facture','autre') LIMIT 1", [req.params.id]);
      if (!j) {
        return res.status(409).json({ error: `Un justificatif (facture ou autre pièce) est exigé avant de décaisser une dépense de ${seuil.toLocaleString("fr-FR")} FCFA ou plus : ajoutez-le dans « Pièces / devis ».` });
      }
    }
    // Bénéficiaire saisi une seule fois : celui de la dépense pré-remplit celui du moyen de paiement (et inversement).
    const refsDecaissement = { ...((b.references !== undefined ? b.references : d.references_paiement) || {}) };
    if (!refsDecaissement.beneficiaire && d.beneficiaire) refsDecaissement.beneficiaire = d.beneficiaire;
    // Moyen et compte : fixés par l'ordre pour un exécutant (sauf anciennes dépenses validées sans moyen, où il choisit comme avant) ;
    // un associé peut les préciser ou les corriger. Les références du moyen sont exigées (l'argent sort).
    const fige = !decideur && !!d.mode_paiement;
    const regl = await preparerDecaissement(pool, {
      mode_paiement: fige ? d.mode_paiement : (b.mode_paiement || d.mode_paiement),
      compte_id: fige ? d.compte_id : (b.compte_id !== undefined ? b.compte_id : d.compte_id),
      references: refsDecaissement,
    }, { exigerReferences: true });
    if (regl.erreur) return res.status(400).json({ error: regl.erreur });
    const v = regl.valeurs;
    const { rows } = await pool.query(
      `UPDATE depenses SET statut = 'decaissee', decaisse_par = $1, decaisse_le = now(),
              mode_paiement = $3::mode_paiement, compte_id = $4::uuid, references_paiement = $5::jsonb,
              beneficiaire = COALESCE(beneficiaire, $6),
              ordre_paiement_le = COALESCE(ordre_paiement_le, now()), ordre_paiement_par = COALESCE(ordre_paiement_par, $1::uuid),
              blocage_motif = NULL, blocage_par = NULL, blocage_le = NULL
       WHERE id = $2 AND statut = 'validee' RETURNING id, statut`,
      [req.user.sub, req.params.id, v.mode_paiement, v.compte_id, JSON.stringify(v.references), String(v.references.beneficiaire || "").trim().slice(0, 160) || null]
    );
    if (!rows[0]) return res.status(404).json({ error: "La dépense doit être validée avant décaissement" });
    await notif.traiter(["depense_a_decaisser", "depense_blocage"], req.params.id);
    const { rows: [so] } = await pool.query("SELECT soumis_par FROM depenses WHERE id = $1", [req.params.id]);
    await notif.notifier({ type: "depense_decaissee", destinataires: [so && so.soumis_par], auteurId: req.user.sub, ref: req.params.id });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/depenses/moyens-paiement — moyens de décaissement et leurs références (20/10/2026).
router.get("/moyens-paiement", (req, res) => {
  res.json(DECAISSEMENT.map((m) => ({ code: m.code, libelle: m.libelle, famille: m.famille, frais: false, champs: m.champs })));
});

// GET /api/depenses/moyens-paiement/:code/comptes — comptes pouvant servir à ce moyen.
const VOIR_COMPTES = requireAnyPermission(["depenses.decision", "depenses.decaisser", "depenses.engager", "depenses.petite_caisse.doter",
  "factures.paiement.ajouter", "factures.creer", "fonds_tiers.consulter", "fonds_tiers.enregistrer", "fonds_tiers.reverser"]);
router.get("/moyens-paiement/:code/comptes", VOIR_COMPTES, async (req, res) => {
  const moyen = DECAISSEMENT_PAR_CODE[req.params.code];
  if (!moyen) return res.status(404).json({ error: "Moyen inconnu" });
  try { res.json(await comptesEligibles(pool, moyen)); }
  catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// GET /api/depenses/comptes
router.get("/comptes", VOIR_COMPTES, async (req, res) => {
  try {
    // Seulement l'identité du compte : ni banque, ni opérateur, ni téléphone (aucun écran n'en a besoin ici).
    const { rows } = await pool.query("SELECT id, intitule, type FROM comptes_bancaires WHERE actif = TRUE ORDER BY intitule");
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Solde de la petite caisse d'un mois : dotation − dépenses (hors rejetées).
// Mois d'une dotation / d'un solde (29/10/2026) : toute date ou « AAAA-MM » est ramenée au 1er du mois ; null si invalide.
function moisNormalise(v) {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?/.exec(String(v || ""));
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

async function soldePetiteCaisse(mois, c = CAISSES.petite_caisse) {
  // Dotation du mois : tolère une ancienne ligne enregistrée un autre jour du mois (avant la normalisation du 29/10/2026 :
  // le champ date acceptait n'importe quel jour et le solde cherchait le 1er) ; la ligne datée du 1er prime, sinon la plus récente.
  const dotation = await pool.query(
    `SELECT montant_alloue FROM dotations_petite_caisse WHERE caisse = $2 AND date_trunc('month', mois) = date_trunc('month', $1::date)
     ORDER BY (mois = date_trunc('month', $1::date)::date) DESC, cree_le DESC LIMIT 1`, [mois, c.code]);
  const depense = await pool.query(
    `SELECT COALESCE(SUM(montant),0) AS total FROM depenses
     WHERE ${c.flag} = TRUE AND statut <> 'rejetee' AND date_trunc('month', date_depense) = $1::date`,
    [mois]
  );
  const alloue = Number(dotation.rows[0]?.montant_alloue ?? 0);
  const total = Number(depense.rows[0].total);
  return { dotation: alloue, dotee: dotation.rows.length > 0, depense: total, solde: alloue - total };
}
const premierDuMois = (d = new Date()) => d.toISOString().slice(0, 8) + "01";

// GET /api/depenses/petite-caisse?mois=YYYY-MM-01
router.get("/petite-caisse", async (req, res) => {
  const mois = (req.query.mois && moisNormalise(req.query.mois)) || premierDuMois();
  try {
    const c = caisseDe(req.query.caisse);
    const { dotation, depense, solde } = await soldePetiteCaisse(mois, c);
    res.json({ mois, caisse: c.code, dotation, depense, solde, plafond_depense: (await plafondCaisse(c)) ?? null, categories_autorisees: await categoriesCaisse(c), fenetre_jours: FENETRE_JOURS + 1 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/depenses/petite-caisse  { mois, montant_alloue }  (administrateur)
router.post("/petite-caisse", requirePermission("depenses.petite_caisse.doter"), async (req, res) => {
  const { mois: moisBrut, montant_alloue } = req.body || {};
  const c = caisseDe((req.body || {}).caisse);
  if (!moisBrut || montant_alloue == null || montant_alloue === "") return res.status(400).json({ error: "mois et montant_alloue requis" });
  const mois = moisNormalise(moisBrut);
  if (!mois) return res.status(400).json({ error: "Mois invalide (AAAA-MM)." });
  const montant = Number(montant_alloue);
  if (!Number.isInteger(montant) || montant < 0) return res.status(400).json({ error: "Montant de dotation invalide : entier en FCFA, zéro ou plus (0 remet la caisse à zéro)." });
  try {
    // Une ligne existe-t-elle déjà pour ce mois (même enregistrée un autre jour du mois) ? On la corrige au lieu d'en créer une 2e.
    const { rows: [avant] } = await pool.query(
      `SELECT id, montant_alloue, mois FROM dotations_petite_caisse WHERE caisse = $2 AND date_trunc('month', mois) = date_trunc('month', $1::date)
       ORDER BY (mois = $1::date) DESC, cree_le DESC LIMIT 1`, [mois, c.code]);
    const { rows } = avant
      ? await pool.query(
        `UPDATE dotations_petite_caisse SET mois = $1::date, montant_alloue = $2, administrateur_id = $3 WHERE id = $4
         RETURNING mois::text AS mois, montant_alloue`, [mois, montant, req.user.sub, avant.id])
      : await pool.query(
        `INSERT INTO dotations_petite_caisse (mois, montant_alloue, administrateur_id, caisse) VALUES ($1::date,$2,$3,$4)
         RETURNING mois::text AS mois, montant_alloue`, [mois, montant, req.user.sub, c.code]);
    await logAudit({ utilisateurId: req.user.sub, action: avant ? "corriger_dotation_petite_caisse" : "doter_petite_caisse", entite: "dotations_petite_caisse",
      details: { mois, avant: avant ? Number(avant.montant_alloue) : null, apres: montant, caisse: c.code }, ip: req.ip });
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// GET /api/depenses/vignettes/stock — expose aussi le seuil d'alerte
// (08/10/2026) pour que l'écran puisse colorer la tuile sans requête
// séparée.
router.get("/vignettes/stock", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT (SELECT stock::int FROM v_stock_vignettes) AS stock, seuil_alerte_vignettes AS seuil FROM parametres_cabinet WHERE id = 1"
    );
    res.json({ stock: rows[0]?.stock ?? 0, seuil: rows[0]?.seuil ?? 10 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/depenses/vignettes/numeros-disponibles (08/10/2026) — numéros
// individuels connus à l'avance (achat avec plage renseignée) et pas
// encore consommés ; sert à proposer un numéro plutôt que de le ressaisir
// à la main quand il est déjà connu.
// GET /api/depenses/vignettes/a-affecter (lot F, 11/11/2026) — instances de dossiers contentieux, créées depuis le début du suivi
// (`parametres_cabinet.vignettes_suivi_depuis`), sans vignette enregistrée ni dispense, sur un dossier non clos. Renvoie aussi le
// prochain numéro connu du stock (proposé, jamais imposé : on le confirme ou on le corrige selon la vignette physique) et le stock.
router.get("/vignettes/a-affecter", requirePermission("depenses.vignettes.mouvement"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.id AS instance_id, i.dossier_id, d.numero AS dossier_numero, d.intitule, i.degre, i.juridiction, i.cree_le,
              (d.mode_honoraires IS NOT NULL) AS mode_honoraires_renseigne
         FROM instances i JOIN dossiers d ON d.id = i.dossier_id
        WHERE d.pole = 'contentieux' AND d.statut NOT IN ('clos','archive') AND i.vignette_dispensee = FALSE
          AND i.cree_le::date >= (SELECT vignettes_suivi_depuis FROM parametres_cabinet WHERE id = 1)
          AND NOT EXISTS (SELECT 1 FROM vignettes_plaidoirie v WHERE v.instance_id = i.id AND v.mouvement = 'utilisation')
        ORDER BY i.cree_le`);
    const { rows: [pool1] } = await pool.query("SELECT min(numero) AS prochain FROM vignettes_numeros_stock WHERE disponible = TRUE");
    const { rows: [st] } = await pool.query("SELECT (SELECT stock::int FROM v_stock_vignettes) AS stock, seuil_alerte_vignettes AS seuil FROM parametres_cabinet WHERE id = 1");
    res.json({ instances: rows, prochain_numero: pool1 && pool1.prochain != null ? Number(pool1.prochain) : null, stock: st ? st.stock : 0, seuil: st ? st.seuil : 10 });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

router.get("/vignettes/numeros-disponibles", requirePermission("depenses.vignettes.mouvement"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT numero FROM vignettes_numeros_stock WHERE disponible = TRUE ORDER BY numero ASC"
    );
    res.json(rows.map((r) => r.numero));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/depenses/vignettes  { quantite, numero_debut?, numero_fin? }
// (08/10/2026) — réservé à l'approvisionnement (achat) : la consommation
// ("utilisation") passe désormais exclusivement par
// POST /api/dossiers/:id/instances/:instanceId/vignette, seul endroit qui
// applique les règles de traçabilité (instance, numéro, mode d'honoraires
// renseigné). Laisser "utilisation" ici en parallèle aurait recréé la
// faille qu'on cherche justement à combler.
router.post("/vignettes", requirePermission("depenses.vignettes.mouvement"), async (req, res) => {
  const b = req.body || {};
  if (b.mouvement && b.mouvement !== "achat") {
    return res.status(400).json({ error: "La consommation d'une vignette se fait désormais depuis l'instance du dossier concerné (fiche dossier → Instances)." });
  }
  // Liste libre de numéros/plages (16/10/2026) — prioritaire sur l'ancienne
  // saisie "début/fin" (continue uniquement), conservée pour compatibilité.
  let numeros = null;
  if (b.numeros != null && String(b.numeros).trim() !== "") {
    const r = parserNumeros(b.numeros);
    if (r.erreur) return res.status(400).json({ error: r.erreur });
    numeros = r.numeros;
  }
  const plageFournie = numeros === null && (b.numero_debut != null || b.numero_fin != null);
  if (plageFournie && (b.numero_debut == null || b.numero_fin == null || b.numero_fin < b.numero_debut)) {
    return res.status(400).json({ error: "numero_debut et numero_fin doivent être fournis ensemble, avec numero_fin >= numero_debut." });
  }
  if (plageFournie) numeros = Array.from({ length: b.numero_fin - b.numero_debut + 1 }, (_, i) => b.numero_debut + i);
  const quantite = numeros ? numeros.length : b.quantite;
  if (!quantite) return res.status(400).json({ error: "quantite (ou une liste de numéros) requise" });
  if (numeros) {
    const deja = await pool.query("SELECT numero FROM vignettes_numeros_stock WHERE numero = ANY($1::int[]) LIMIT 5", [numeros]);
    if (deja.rows.length) {
      return res.status(409).json({ error: `Numéro(s) déjà enregistré(s) : ${deja.rows.map((r) => String(r.numero).padStart(7, "0")).join(", ")}.` });
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [achat] } = await client.query(
      `INSERT INTO vignettes_plaidoirie (mouvement, quantite, numero_debut, numero_fin, cree_par)
       VALUES ('achat', $1, $2, $3, $4)
       RETURNING id, mouvement, quantite, date_mouvement`,
      [quantite, plageFournie ? b.numero_debut : null, plageFournie ? b.numero_fin : null, req.user.sub]
    );
    if (numeros) {
      await client.query(
        "INSERT INTO vignettes_numeros_stock (numero, achat_id) SELECT unnest($1::int[]), $2",
        [numeros, achat.id]
      );
    }
    await client.query("COMMIT");
    res.status(201).json(achat);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

module.exports = router;
