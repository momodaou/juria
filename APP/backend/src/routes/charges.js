// JURIA — État mensuel des charges (24/10/2026).
// Fonctionnement du cabinet : l'administratrice générale (ou le comptable)
// prépare chaque mois un état des charges à payer (fixes + ponctuelles) ; les
// associés approuvent, rejettent ou REPORTENT chaque ligne et orientent le
// moyen de paiement ; l'approbation crée une dépense « validée » dans le
// circuit existant (le décaissement n'est pas modifié). Une ligne reportée
// revient dans l'état du mois suivant avec son retard. Les salaires restent
// dans le module RH. Permissions réutilisées (aucune nouvelle action
// cataloguée) : consulter / creer (préparer) / decision (approuver).
const express = require("express");
const multer = require("multer");
const { pool } = require("../db");
const { saveObject, readObject, deleteObject, FichierIntrouvableError, enteteContentDisposition } = require("../storage");
const { filtreTypeFichier } = require("../uploadFilter");
const { logAudit } = require("../audit");
const { preparerDecaissement } = require("../moyensPaiement");
const { requirePermission, estAutorise } = require("../permissions");
const { genererEtatChargesPdf } = require("../etatChargesPdf");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 }, fileFilter: filtreTypeFichier });
const router = express.Router();

const SEUIL_ALERTE_RETARD = 2; // mois de report à partir desquels la ligne est signalée

// « 2026-10 » ou « 2026-10-17 » → « 2026-10-01 » ; null si invalide.
function premierDuMois(v) {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(String(v || ""));
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const ABREGE = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
// « septembre 2026 » ou « oct. 2026 – déc. 2026 » d'après les dates AAAA-MM-JJ de la période couverte.
function libellePeriode(debut, fin) {
  if (!debut) return "";
  const [a, m] = String(debut).split("-"); const [b, n] = String(fin || debut).split("-");
  if (a === b && m === n) return `${MOIS[+m - 1]} ${a}`;
  return `${ABREGE[+m - 1]} ${a} – ${ABREGE[+n - 1]} ${b}`;
}

// Libellé d'une charge : 240 caractères au plus (colonne VARCHAR(240), reprise telle quelle dans la dépense créée à
// l'approbation). Message clair plutôt que l'erreur brute « value too long for type character varying ».
const LIBELLE_MAX = 240;
const libelleTropLong = (libelle) => String(libelle || "").trim().length > LIBELLE_MAX;
// Catégorie « Autre » (28/10/2026) : la nature de la charge doit être précisée (120 caractères au plus) ;
// pour toute autre catégorie la précision est ignorée (NULL).
const PRECISION_MAX = 120;
function preciserAutre(categorie, precision) {
  if ((categorie || "autre") !== "autre") return { valeur: null };
  const p = String(precision ?? "").trim();
  if (!p) return { erreur: "Précisez la nature de la charge (catégorie « Autre »)." };
  if (p.length > PRECISION_MAX) return { erreur: `Précision trop longue (${PRECISION_MAX} caractères au plus).` };
  return { valeur: p };
}
// Bénéficiaire (28/10/2026) : fournisseur ou personne payée, facultatif, 160 caractères au plus.
const BENEFICIAIRE_MAX = 160;
function preciserBeneficiaire(v) {
  const t = String(v ?? "").trim();
  if (t.length > BENEFICIAIRE_MAX) return { erreur: `Bénéficiaire trop long (${BENEFICIAIRE_MAX} caractères au plus).` };
  return { valeur: t || null };
}

// Nature d'une ligne (28/10/2026) : « cabinet » (défaut) ou « dossier » (débours rattaché à un dossier, avec le
// sélecteur de dossier de Dépenses & caisse). Même règle que resoudreNature de depenses.js.
async function resoudreNatureLigne(b, existant) {
  const nature = b.nature || (b.dossier_id ? "dossier" : existant ? existant.nature : "cabinet");
  if (!["dossier", "cabinet"].includes(nature)) return { erreur: "Nature invalide (dossier ou cabinet)." };
  if (nature === "cabinet") return { nature, dossierId: null, refacturable: false };
  const dossierId = b.dossier_id || (existant && existant.dossier_id) || null;
  if (!dossierId) return { erreur: "Une charge liée à un dossier doit préciser le dossier." };
  const { rows } = await pool.query("SELECT 1 FROM dossiers WHERE id = $1::uuid", [dossierId]);
  if (!rows[0]) return { erreur: "Dossier introuvable." };
  const refacturable = "refacturable_client" in b ? !!b.refacturable_client : !!(existant && existant.refacturable_client);
  return { nature, dossierId, refacturable };
}

const MESSAGE_LIBELLE = `Libellé trop long (${LIBELLE_MAX} caractères au plus) : gardez un intitulé court et mettez le détail dans le champ Observation.`;

// Libellé de la dépense créée à l'approbation : « libellé — période », borné à 240 caractères (colonne
// depenses.libelle) en rognant le libellé, jamais la période.
function libelleDepense(libelle, periode) {
  const suffixe = periode ? ` — ${periode}` : "";
  return `${String(libelle).slice(0, Math.max(0, LIBELLE_MAX - suffixe.length))}${suffixe}`;
}

const entier = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
const montantValide = (v) => Number.isInteger(v) && v >= 0;

// Moyen + compte compatibles (références non exigées avant le paiement effectif).
async function reglement(b) {
  if (!b.mode_paiement) return { valeurs: { mode_paiement: null, compte_id: null } };
  return preparerDecaissement(pool, { mode_paiement: b.mode_paiement, compte_id: b.compte_id || null }, { exigerReferences: false });
}

const SQL_LIGNES = `
  SELECT l.*, l.periode_debut::text AS periode_debut, l.periode_fin::text AS periode_fin, c.intitule AS compte_intitule, d.statut AS depense_statut,
         u.prenom || ' ' || u.nom AS decide_par_nom, dos.numero AS dossier_numero,
         (SELECT count(*) FROM etats_charges_pieces p WHERE p.ligne_id = l.id)::int AS nb_pieces,
         (SELECT l2.montant FROM etats_charges_lignes l2 JOIN etats_charges e2 ON e2.id = l2.etat_id
           WHERE e2.mois < e.mois AND l2.decision <> 'rejetee'
             AND ((l.modele_id IS NOT NULL AND l2.modele_id = l.modele_id) OR (l.modele_id IS NULL AND lower(l2.libelle) = lower(l.libelle)))
           ORDER BY e2.mois DESC, l2.ordre LIMIT 1) AS montant_precedent
  FROM etats_charges_lignes l
  JOIN etats_charges e ON e.id = l.etat_id
  LEFT JOIN dossiers dos ON dos.id = l.dossier_id
  LEFT JOIN comptes_bancaires c ON c.id = l.compte_id
  LEFT JOIN depenses d ON d.id = l.depense_id
  LEFT JOIN utilisateurs u ON u.id = l.decide_par
  WHERE l.etat_id = $1
  ORDER BY l.ordre, l.periode_debut, l.libelle, l.cree_le`;

async function chargerEtat(id) {
  const { rows: [etat] } = await pool.query(
    `SELECT e.*, e.mois::text AS mois, p.prenom || ' ' || p.nom AS prepare_par_nom
     FROM etats_charges e LEFT JOIN utilisateurs p ON p.id = e.prepare_par WHERE e.id = $1`, [id]);
  if (!etat) return null;
  const { rows: lignes } = await pool.query(SQL_LIGNES, [id]);
  const somme = (f) => lignes.filter(f).reduce((s, l) => s + Number(l.montant), 0);
  etat.lignes = lignes;
  etat.totaux = {
    total: somme((l) => l.decision !== "rejetee"),
    approuve: somme((l) => l.decision === "approuvee"),
    reporte: somme((l) => l.decision === "reportee"),
    rejete: somme((l) => l.decision === "rejetee"),
    a_decider: somme((l) => l.decision === "en_attente"),
  };
  etat.en_retard = lignes.filter((l) => l.retard_mois >= SEUIL_ALERTE_RETARD && l.decision === "en_attente").length;
  return etat;
}

// ---------------------------------------------------------------------
// Catalogue des charges habituelles
// ---------------------------------------------------------------------
router.get("/modeles", requirePermission("depenses.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, c.intitule AS compte_intitule FROM charges_modeles m
       LEFT JOIN comptes_bancaires c ON c.id = m.compte_id
       WHERE ($1::boolean OR m.actif) ORDER BY m.actif DESC, m.libelle`, [req.query.inactifs === "true"]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

async function ecrireModele(req, res, id) {
  const b = req.body || {};
  const montant = entier(b.montant_habituel ?? 0);
  if (!b.libelle || !String(b.libelle).trim()) return res.status(400).json({ error: "Le libellé est requis." });
  if (libelleTropLong(b.libelle)) return res.status(400).json({ error: MESSAGE_LIBELLE });
  if (!montantValide(montant)) return res.status(400).json({ error: "Montant habituel invalide (entier en FCFA)." });
  const periodicite = b.periodicite || "mensuelle";
  if (!["mensuelle", "trimestrielle", "annuelle"].includes(periodicite)) return res.status(400).json({ error: "Périodicité invalide." });
  const moisEch = entier(b.mois_echeance);
  if (periodicite !== "mensuelle" && !(moisEch >= 1 && moisEch <= 12)) return res.status(400).json({ error: "Précisez le mois d'échéance (1 à 12) pour une charge trimestrielle ou annuelle." });
  const regl = await reglement(b);
  if (regl.erreur) return res.status(400).json({ error: regl.erreur });
  const prec = preciserAutre(b.categorie, b.precision_autre);
  if (prec.erreur) return res.status(400).json({ error: prec.erreur });
  const benef = preciserBeneficiaire(b.beneficiaire);
  if (benef.erreur) return res.status(400).json({ error: benef.erreur });
  const v = [String(b.libelle).trim(), b.categorie || "autre", b.type || "fixe", montant, !!b.montant_variable,
    periodicite, periodicite === "mensuelle" ? null : moisEch, regl.valeurs.mode_paiement, regl.valeurs.compte_id, prec.valeur, benef.valeur];
  try {
    const sql = id
      ? `UPDATE charges_modeles SET libelle=$1, categorie=$2::categorie_depense, type=$3::type_depense, montant_habituel=$4,
           montant_variable=$5, periodicite=$6, mois_echeance=$7, mode_paiement=$8::mode_paiement, compte_id=$9::uuid,
           precision_autre=$10, beneficiaire=$11, actif = COALESCE($13::boolean, actif)
         WHERE id=$12::uuid RETURNING *`
      : `INSERT INTO charges_modeles (libelle,categorie,type,montant_habituel,montant_variable,periodicite,mois_echeance,mode_paiement,compte_id,precision_autre,beneficiaire,cree_par)
         VALUES ($1,$2::categorie_depense,$3::type_depense,$4,$5,$6,$7,$8::mode_paiement,$9::uuid,$10,$11,$12::uuid) RETURNING *`;
    const params = id ? [...v, id, typeof b.actif === "boolean" ? b.actif : null] : [...v, req.user.sub];
    const { rows } = await pool.query(sql, params);
    if (!rows[0]) return res.status(404).json({ error: "Charge introuvable." });
    res.status(id ? 200 : 201).json(rows[0]);
  } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
}
router.post("/modeles", requirePermission("depenses.creer"), (req, res) => ecrireModele(req, res, null));
router.put("/modeles/:id", requirePermission("depenses.creer"), (req, res) => ecrireModele(req, res, req.params.id));
// Retrait du catalogue = désactivation (les états déjà préparés ne changent pas).
router.delete("/modeles/:id", requirePermission("depenses.creer"), async (req, res) => {
  try {
    const { rowCount } = await pool.query("UPDATE charges_modeles SET actif = FALSE WHERE id = $1::uuid", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Charge introuvable." });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// ---------------------------------------------------------------------
// États mensuels
// ---------------------------------------------------------------------
router.get("/etats", requirePermission("depenses.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.mois::text AS mois, e.statut, e.soumis_le, e.clos_le,
              count(l.id)::int AS nb_lignes,
              COALESCE(sum(l.montant) FILTER (WHERE l.decision <> 'rejetee'), 0)::bigint AS total,
              count(l.id) FILTER (WHERE l.decision = 'en_attente')::int AS nb_a_decider,
              count(l.id) FILTER (WHERE l.decision = 'reportee')::int AS nb_reportees,
              count(l.id) FILTER (WHERE l.retard_mois >= $1 AND l.decision <> 'rejetee')::int AS nb_en_retard
       FROM etats_charges e LEFT JOIN etats_charges_lignes l ON l.etat_id = e.id
       GROUP BY e.id ORDER BY e.mois DESC`, [SEUIL_ALERTE_RETARD]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

router.get("/etats/:id", requirePermission("depenses.consulter"), async (req, res) => {
  try {
    const etat = await chargerEtat(req.params.id);
    if (!etat) return res.status(404).json({ error: "État introuvable." });
    res.json(etat);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/charges/etats { mois } — crée l'état du mois, pré-rempli par le
// catalogue (selon la périodicité) et par les lignes REPORTÉES des mois précédents.
router.post("/etats", requirePermission("depenses.creer"), async (req, res) => {
  const mois = premierDuMois((req.body || {}).mois);
  if (!mois) return res.status(400).json({ error: "Mois invalide (AAAA-MM)." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [etat] } = await client.query(
      `INSERT INTO etats_charges (mois, prepare_par) VALUES ($1::date, $2::uuid)
       ON CONFLICT (mois) DO NOTHING RETURNING id, mois::text AS mois`, [mois, req.user.sub]);
    if (!etat) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Un état existe déjà pour ce mois." }); }
    // Charges reportées non encore reprises.
    await client.query(
      `INSERT INTO etats_charges_lignes
         (etat_id, modele_id, libelle, categorie, precision_autre, type, montant, periode_debut, periode_fin, observation,
          mode_paiement, compte_id, nature, dossier_id, refacturable_client, beneficiaire, report_de, retard_mois, ordre)
       SELECT $1::uuid, l.modele_id, l.libelle, l.categorie, l.precision_autre, l.type, l.montant, l.periode_debut, l.periode_fin, l.observation,
              l.mode_paiement, l.compte_id, l.nature, l.dossier_id, l.refacturable_client, l.beneficiaire, l.id, l.retard_mois + 1, 0
       FROM etats_charges_lignes l JOIN etats_charges e ON e.id = l.etat_id
       WHERE l.decision = 'reportee' AND e.mois < $2::date
         AND NOT EXISTS (SELECT 1 FROM etats_charges_lignes s WHERE s.report_de = l.id)
       ORDER BY e.mois, l.ordre, l.cree_le`, [etat.id, mois]);
    // Charges habituelles du mois (mensuelles ; trimestrielles/annuelles à leur échéance).
    await client.query(
      `INSERT INTO etats_charges_lignes
         (etat_id, modele_id, libelle, categorie, precision_autre, type, montant, periode_debut, periode_fin, mode_paiement, compte_id, beneficiaire, ordre)
       SELECT $1::uuid, m.id, m.libelle, m.categorie, m.precision_autre, m.type, m.montant_habituel, $2::date,
              ($2::date + CASE m.periodicite WHEN 'mensuelle' THEN interval '1 month' WHEN 'trimestrielle' THEN interval '3 months' ELSE interval '12 months' END
               - interval '1 day')::date,
              m.mode_paiement, m.compte_id, m.beneficiaire, 10
       FROM charges_modeles m
       WHERE m.actif AND (m.periodicite = 'mensuelle'
          OR (m.periodicite = 'annuelle' AND m.mois_echeance = EXTRACT(MONTH FROM $2::date))
          OR (m.periodicite = 'trimestrielle' AND MOD(EXTRACT(MONTH FROM $2::date)::int - m.mois_echeance + 12, 3) = 0))
       ORDER BY m.libelle`, [etat.id, mois]);
    await client.query("COMMIT");
    await copierPiecesDesReports(etat.id);
    await logAudit({ utilisateurId: req.user.sub, action: "etat_charges_cree", entite: "etat_charges", entiteId: etat.id, details: { mois } });
    res.status(201).json(await chargerEtat(etat.id));
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  } finally { client.release(); }
});

// Compléter un état en préparation avec les charges habituelles dues ce mois-ci et pas encore présentes
// (28/10/2026) : le catalogue n'est recopié qu'à la création de l'état ; une charge habituelle ajoutée
// ensuite n'y figurait pas. Idempotent : une charge déjà dans l'état (même modèle) n'est jamais doublée.
router.post("/etats/:id/completer", requirePermission("depenses.creer"), async (req, res) => {
  try {
    const { rows: [etat] } = await pool.query("SELECT id, statut, mois::text AS mois FROM etats_charges WHERE id = $1::uuid", [req.params.id]);
    if (!etat) return res.status(404).json({ error: "État introuvable." });
    if (etat.statut !== "en_preparation") return res.status(409).json({ error: "L'état est déjà soumis : rouvrez-le pour le compléter." });
    const ajout = await pool.query(
      `INSERT INTO etats_charges_lignes
         (etat_id, modele_id, libelle, categorie, precision_autre, type, montant, periode_debut, periode_fin, mode_paiement, compte_id, beneficiaire, ordre)
       SELECT $1::uuid, m.id, m.libelle, m.categorie, m.precision_autre, m.type, m.montant_habituel, $2::date,
              ($2::date + CASE m.periodicite WHEN 'mensuelle' THEN interval '1 month' WHEN 'trimestrielle' THEN interval '3 months' ELSE interval '12 months' END
               - interval '1 day')::date,
              m.mode_paiement, m.compte_id, m.beneficiaire, 10
       FROM charges_modeles m
       WHERE m.actif AND (m.periodicite = 'mensuelle'
          OR (m.periodicite = 'annuelle' AND m.mois_echeance = EXTRACT(MONTH FROM $2::date))
          OR (m.periodicite = 'trimestrielle' AND MOD(EXTRACT(MONTH FROM $2::date)::int - m.mois_echeance + 12, 3) = 0))
         AND NOT EXISTS (SELECT 1 FROM etats_charges_lignes x WHERE x.etat_id = $1::uuid AND x.modele_id = m.id)
       ORDER BY m.libelle
       RETURNING id`, [etat.id, etat.mois]);
    await logAudit({ utilisateurId: req.user.sub, action: "etat_charges_complete", entite: "etat_charges", entiteId: etat.id, details: { ajoutees: ajout.rowCount } });
    const complet = await chargerEtat(etat.id);
    complet.ajoutees = ajout.rowCount;
    res.json(complet);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

router.put("/etats/:id", requirePermission("depenses.creer"), async (req, res) => {
  try {
    const { rowCount } = await pool.query("UPDATE etats_charges SET note = $1 WHERE id = $2::uuid AND statut = 'en_preparation'",
      [(req.body || {}).note || null, req.params.id]);
    if (!rowCount) return res.status(409).json({ error: "État introuvable ou déjà soumis." });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

async function etatDe(id) {
  const { rows: [e] } = await pool.query("SELECT id, statut FROM etats_charges WHERE id = $1::uuid", [id]);
  return e;
}

// Ajout d'une ligne ponctuelle (état en préparation).
router.post("/etats/:id/lignes", requirePermission("depenses.creer"), async (req, res) => {
  const b = req.body || {};
  const montant = entier(b.montant);
  if (!b.libelle || !String(b.libelle).trim()) return res.status(400).json({ error: "Le libellé est requis." });
  if (libelleTropLong(b.libelle)) return res.status(400).json({ error: MESSAGE_LIBELLE });
  if (!montantValide(montant)) return res.status(400).json({ error: "Montant invalide (entier en FCFA)." });
  const regl = await reglement(b);
  if (regl.erreur) return res.status(400).json({ error: regl.erreur });
  const prec = preciserAutre(b.categorie, b.precision_autre);
  if (prec.erreur) return res.status(400).json({ error: prec.erreur });
  const benef = preciserBeneficiaire(b.beneficiaire);
  if (benef.erreur) return res.status(400).json({ error: benef.erreur });
  try {
    const nat = await resoudreNatureLigne(b, null);
    if (nat.erreur) return res.status(400).json({ error: nat.erreur });
    const etat = await etatDe(req.params.id);
    if (!etat) return res.status(404).json({ error: "État introuvable." });
    if (etat.statut !== "en_preparation") return res.status(409).json({ error: "L'état est déjà soumis : rouvrez-le pour ajouter une ligne." });
    const { rows } = await pool.query(
      `INSERT INTO etats_charges_lignes
         (etat_id, libelle, categorie, type, montant, periode_debut, periode_fin, observation, mode_paiement, compte_id, precision_autre, nature, dossier_id, refacturable_client, beneficiaire, ordre)
       SELECT e.id, $2, $3::categorie_depense, $4::type_depense, $5, COALESCE($6::date, e.mois),
              COALESCE($7::date, $6::date, (e.mois + interval '1 month' - interval '1 day')::date), $8, $9::mode_paiement, $10::uuid, $11,
              $12, $13::uuid, $14, $15, 20
       FROM etats_charges e WHERE e.id = $1::uuid RETURNING *`,
      [req.params.id, String(b.libelle).trim(), b.categorie || "autre", b.type || "ponctuelle", montant,
       b.periode_debut || null, b.periode_fin || null, b.observation || null, regl.valeurs.mode_paiement, regl.valeurs.compte_id, prec.valeur,
       nat.nature, nat.dossierId, nat.refacturable, benef.valeur]);
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
});

// Modification d'une ligne : préparation (tous les champs) ou, une fois l'état
// soumis, les associés peuvent corriger montant / moyen / compte d'une ligne en attente.
router.put("/etats/:id/lignes/:ligneId", requirePermission("depenses.consulter"), async (req, res) => {
  const b = req.body || {};
  try {
    const etat = await etatDe(req.params.id);
    if (!etat) return res.status(404).json({ error: "État introuvable." });
    const { rows: [l] } = await pool.query("SELECT * FROM etats_charges_lignes WHERE id = $1::uuid AND etat_id = $2::uuid", [req.params.ligneId, req.params.id]);
    if (!l) return res.status(404).json({ error: "Ligne introuvable." });
    const prepa = etat.statut === "en_preparation";
    const code = prepa ? "depenses.creer" : "depenses.decision";
    if (!(await estAutorise(req.user.role, code, req.user.sub))) return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
    if (etat.statut === "clos" || (!prepa && l.decision !== "en_attente")) return res.status(409).json({ error: "Cette ligne n'est plus modifiable." });
    const montant = b.montant === undefined ? Number(l.montant) : entier(b.montant);
    if (!montantValide(montant)) return res.status(400).json({ error: "Montant invalide (entier en FCFA)." });
    const regl = ("mode_paiement" in b || "compte_id" in b)
      ? await reglement({ mode_paiement: "mode_paiement" in b ? b.mode_paiement : l.mode_paiement, compte_id: "compte_id" in b ? b.compte_id : l.compte_id })
      : { valeurs: { mode_paiement: l.mode_paiement, compte_id: l.compte_id } };
    if (regl.erreur) return res.status(400).json({ error: regl.erreur });
    const libelle = prepa && b.libelle !== undefined ? String(b.libelle).trim() : l.libelle;
    if (!libelle) return res.status(400).json({ error: "Le libellé est requis." });
    if (libelleTropLong(libelle)) return res.status(400).json({ error: MESSAGE_LIBELLE });
    const categorie = prepa && b.categorie ? b.categorie : l.categorie;
    let precision = l.precision_autre;
    if (prepa) {
      const prec = preciserAutre(categorie, "precision_autre" in b ? b.precision_autre : l.precision_autre);
      if (prec.erreur) return res.status(400).json({ error: prec.erreur });
      precision = prec.valeur;
    }
    let nat = { nature: l.nature, dossierId: l.dossier_id, refacturable: l.refacturable_client };
    let beneficiaire = l.beneficiaire;
    if (prepa) {
      nat = await resoudreNatureLigne(b, l);
      if (nat.erreur) return res.status(400).json({ error: nat.erreur });
      if ("beneficiaire" in b) {
        const benef = preciserBeneficiaire(b.beneficiaire);
        if (benef.erreur) return res.status(400).json({ error: benef.erreur });
        beneficiaire = benef.valeur;
      }
    }
    const { rows } = await pool.query(
      `UPDATE etats_charges_lignes SET libelle=$1, categorie=$2::categorie_depense, type=$3::type_depense, montant=$4,
         periode_debut=$5::date, periode_fin=$6::date, observation=$7, mode_paiement=$8::mode_paiement, compte_id=$9::uuid,
         precision_autre=$11, nature=$12, dossier_id=$13::uuid, refacturable_client=$14, beneficiaire=$15
       WHERE id=$10::uuid RETURNING *`,
      [libelle, categorie, prepa && b.type ? b.type : l.type, montant,
       prepa && "periode_debut" in b ? b.periode_debut || null : l.periode_debut,
       prepa && "periode_fin" in b ? b.periode_fin || null : l.periode_fin,
       prepa && "observation" in b ? b.observation || null : l.observation,
       regl.valeurs.mode_paiement, regl.valeurs.compte_id, l.id, precision,
       nat.nature, nat.dossierId, nat.refacturable, beneficiaire]);
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
});

router.delete("/etats/:id/lignes/:ligneId", requirePermission("depenses.creer"), async (req, res) => {
  try {
    const etat = await etatDe(req.params.id);
    if (!etat) return res.status(404).json({ error: "État introuvable." });
    if (etat.statut !== "en_preparation") return res.status(409).json({ error: "L'état est déjà soumis." });
    const { rows: [l] } = await pool.query("SELECT report_de FROM etats_charges_lignes WHERE id = $1::uuid AND etat_id = $2::uuid", [req.params.ligneId, req.params.id]);
    if (!l) return res.status(404).json({ error: "Ligne introuvable." });
    if (l.report_de) return res.status(409).json({ error: "Une charge reportée ne se supprime pas : les associés la rejettent s'il n'y a plus lieu de la payer." });
    const { rows: pieces } = await pool.query("SELECT chemin_storage FROM etats_charges_pieces WHERE ligne_id = $1::uuid", [req.params.ligneId]);
    await pool.query("DELETE FROM etats_charges_lignes WHERE id = $1::uuid", [req.params.ligneId]);
    for (const p of pieces) await deleteObject(p.chemin_storage).catch(() => {});
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Soumission aux associés / réouverture (tant qu'aucune décision n'a été prise).
router.post("/etats/:id/soumettre", requirePermission("depenses.creer"), async (req, res) => {
  try {
    const { rows: [n] } = await pool.query("SELECT count(*)::int AS n FROM etats_charges_lignes WHERE etat_id = $1::uuid", [req.params.id]);
    if (!n.n) return res.status(400).json({ error: "L'état est vide : ajoutez au moins une charge." });
    const { rowCount } = await pool.query(
      "UPDATE etats_charges SET statut = 'soumis', soumis_le = now() WHERE id = $1::uuid AND statut = 'en_preparation'", [req.params.id]);
    if (!rowCount) return res.status(409).json({ error: "État introuvable ou déjà soumis." });
    await logAudit({ utilisateurId: req.user.sub, action: "etat_charges_soumis", entite: "etat_charges", entiteId: req.params.id });
    res.json(await chargerEtat(req.params.id));
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

router.post("/etats/:id/rouvrir", requirePermission("depenses.creer"), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE etats_charges SET statut = 'en_preparation', soumis_le = NULL
       WHERE id = $1::uuid AND statut = 'soumis'
         AND NOT EXISTS (SELECT 1 FROM etats_charges_lignes WHERE etat_id = $1::uuid AND decision <> 'en_attente')`, [req.params.id]);
    if (!rowCount) return res.status(409).json({ error: "Impossible de rouvrir : l'état n'est pas soumis ou des décisions ont déjà été prises." });
    await logAudit({ utilisateurId: req.user.sub, action: "etat_charges_rouvert", entite: "etat_charges", entiteId: req.params.id });
    res.json(await chargerEtat(req.params.id));
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// --- Approbation : dépense « validée » créée depuis une ligne (28/10/2026, factorisé pour la décision groupée) ---
async function creerDepenseDeLigne(client, l, montant, v, decideurId) {
  const { rows: [e] } = await client.query("SELECT prepare_par FROM etats_charges WHERE id = $1::uuid", [l.etat_id]);
  const { rows: [d] } = await client.query(
    `INSERT INTO depenses
       (nature, type, categorie, libelle, montant, date_depense, mode_paiement, compte_id, statut,
        soumis_par, valide_par, valide_le, cree_par, dossier_id, refacturable_client, beneficiaire)
     VALUES ($9, $1::type_depense, $2::categorie_depense, $3, $4, current_date, $5::mode_paiement, $6::uuid, 'validee',
             $7::uuid, $8::uuid, now(), $7::uuid, $10::uuid, $11, $12)
     RETURNING id`,
    [l.type, l.categorie, libelleDepense(l.libelle, libellePeriode(l.periode_debut, l.periode_fin) || libellePeriode(l.mois)), montant,
     v.mode_paiement, v.compte_id, (e && e.prepare_par) || decideurId, decideurId,
     l.nature || "cabinet", l.nature === "dossier" ? l.dossier_id : null, l.nature === "dossier" ? !!l.refacturable_client : false, l.beneficiaire || null]);
  return d.id;
}

// Copie physique d'une pièce (le fichier est dupliqué : supprimer l'une ne touche jamais l'autre).
async function dupliquerFichier(chemin, nom, mime, dossierDest) {
  const buf = await readObject(chemin);
  return saveObject(buf, `${dossierDest}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${nom}`.replace(/\s+/g, "_"), mime || "application/octet-stream");
}

// Les justificatifs de la ligne suivent la dépense créée à l'approbation (hors transaction : un fichier
// introuvable ne doit jamais empêcher la décision ; l'incident est seulement journalisé).
async function copierPiecesVersDepense(ligneId, depenseId, userId) {
  try {
    const { rows } = await pool.query("SELECT * FROM etats_charges_pieces WHERE ligne_id = $1::uuid ORDER BY ajoute_le", [ligneId]);
    for (const p of rows) {
      try {
        const chemin = await dupliquerFichier(p.chemin_storage, p.nom, p.type_mime, `depenses/${depenseId}`);
        await pool.query(
          `INSERT INTO depense_pieces (depense_id, type, nom, type_mime, taille_octets, chemin_storage, ajoute_par)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`, [depenseId, p.type, p.nom, p.type_mime, p.taille_octets, chemin, p.ajoute_par || userId]);
      } catch (e) { console.error("Copie d'un justificatif vers la dépense impossible :", e.message); }
    }
  } catch (e) { console.error(e); }
}

// Une charge reportée garde ses justificatifs dans l'état du mois suivant.
async function copierPiecesDesReports(etatId) {
  try {
    const { rows } = await pool.query(
      `SELECT n.id AS nouvelle, p.* FROM etats_charges_lignes n
         JOIN etats_charges_pieces p ON p.ligne_id = n.report_de
       WHERE n.etat_id = $1::uuid ORDER BY p.ajoute_le`, [etatId]);
    for (const p of rows) {
      try {
        const chemin = await dupliquerFichier(p.chemin_storage, p.nom, p.type_mime, `etats-charges/${p.nouvelle}`);
        await pool.query(
          `INSERT INTO etats_charges_pieces (ligne_id, type, nom, type_mime, taille_octets, chemin_storage, ajoute_par)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`, [p.nouvelle, p.type, p.nom, p.type_mime, p.taille_octets, chemin, p.ajoute_par]);
      } catch (e) { console.error("Copie d'un justificatif sur une charge reportée impossible :", e.message); }
    }
  } catch (e) { console.error(e); }
}

// --- Justificatifs d'une ligne de l'état (avant ET après soumission, tant que la ligne attend sa décision) ---
const TYPES_PIECE = ["devis", "facture", "preuve_paiement", "autre"];

async function ligneModifiablePieces(req, res) {
  const { rows: [l] } = await pool.query(
    `SELECT l.id, l.decision, e.statut FROM etats_charges_lignes l JOIN etats_charges e ON e.id = l.etat_id
     WHERE l.id = $1::uuid AND l.etat_id = $2::uuid`, [req.params.ligneId, req.params.id]);
  if (!l) { res.status(404).json({ error: "Ligne introuvable." }); return null; }
  if (l.statut === "clos") { res.status(409).json({ error: "L'état est clos." }); return null; }
  if (l.decision !== "en_attente") {
    res.status(409).json({ error: "Cette charge a déjà fait l'objet d'une décision : ajoutez le justificatif sur la dépense (Dépenses & caisse › Pièces / devis)." });
    return null;
  }
  return l;
}

router.get("/etats/:id/lignes/:ligneId/pieces", requirePermission("depenses.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.type, p.nom, p.type_mime, p.taille_octets, p.ajoute_le, u.prenom || ' ' || u.nom AS ajoute_par
       FROM etats_charges_pieces p JOIN etats_charges_lignes l ON l.id = p.ligne_id
       LEFT JOIN utilisateurs u ON u.id = p.ajoute_par
       WHERE p.ligne_id = $1::uuid AND l.etat_id = $2::uuid ORDER BY p.ajoute_le`, [req.params.ligneId, req.params.id]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

router.post("/etats/:id/lignes/:ligneId/pieces", requirePermission("depenses.creer"), upload.single("fichier"), async (req, res) => {
  const type = (req.body && req.body.type) || "autre";
  if (!TYPES_PIECE.includes(type)) return res.status(400).json({ error: "Type de pièce invalide." });
  if (!req.file) return res.status(400).json({ error: "Fichier manquant." });
  try {
    if (!(await ligneModifiablePieces(req, res))) return;
    const chemin = await saveObject(req.file.buffer,
      `etats-charges/${req.params.ligneId}/${Date.now()}_${req.file.originalname}`.replace(/\s+/g, "_"), req.file.mimetype);
    const { rows } = await pool.query(
      `INSERT INTO etats_charges_pieces (ligne_id, type, nom, type_mime, taille_octets, chemin_storage, ajoute_par)
       VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::uuid) RETURNING id, type, nom`,
      [req.params.ligneId, type, req.file.originalname, req.file.mimetype, req.file.size, chemin, req.user.sub]);
    await logAudit({ utilisateurId: req.user.sub, action: "etat_charges_piece_ajoutee", entite: "etat_charges_ligne", entiteId: req.params.ligneId,
      details: { type, nom: req.file.originalname } });
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
});

router.get("/etats/:id/lignes/:ligneId/pieces/:pieceId/fichier", requirePermission("depenses.consulter"), async (req, res) => {
  try {
    const { rows: [p] } = await pool.query(
      `SELECT p.nom, p.type_mime, p.chemin_storage FROM etats_charges_pieces p JOIN etats_charges_lignes l ON l.id = p.ligne_id
       WHERE p.id = $1::uuid AND p.ligne_id = $2::uuid AND l.etat_id = $3::uuid`, [req.params.pieceId, req.params.ligneId, req.params.id]);
    if (!p) return res.status(404).json({ error: "Pièce introuvable." });
    const buf = await readObject(p.chemin_storage);
    res.setHeader("Content-Type", p.type_mime || "application/octet-stream");
    res.setHeader("Content-Disposition", enteteContentDisposition(p.nom));
    res.send(buf);
  } catch (e) {
    if (e instanceof FichierIntrouvableError) return res.status(404).json({ error: "Le fichier de cette pièce n'est plus disponible dans le stockage." });
    console.error(e); res.status(500).json({ error: "Erreur serveur" });
  }
});

router.delete("/etats/:id/lignes/:ligneId/pieces/:pieceId", requirePermission("depenses.creer"), async (req, res) => {
  try {
    if (!(await ligneModifiablePieces(req, res))) return;
    const { rows: [p] } = await pool.query(
      "DELETE FROM etats_charges_pieces WHERE id = $1::uuid AND ligne_id = $2::uuid RETURNING chemin_storage, nom, type", [req.params.pieceId, req.params.ligneId]);
    if (!p) return res.status(404).json({ error: "Pièce introuvable." });
    await deleteObject(p.chemin_storage).catch(() => {});
    await logAudit({ utilisateurId: req.user.sub, action: "etat_charges_piece_retiree", entite: "etat_charges_ligne", entiteId: req.params.ligneId,
      details: { type: p.type, nom: p.nom } });
    res.status(204).end();
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// --- Décision groupée (28/10/2026, optionnelle) : approuve d'un coup les lignes encore en attente ---
// Une ligne qui a déjà son moyen de paiement le garde ; le moyen / compte par défaut du corps de la requête ne sert
// qu'aux autres. Les lignes à montant nul restent en attente (à traiter à la main). Tout ou rien (une transaction).
router.post("/etats/:id/approuver-tout", requirePermission("depenses.decision"), async (req, res) => {
  const b = req.body || {};
  const client = await pool.connect();
  const creees = [];
  try {
    await client.query("BEGIN");
    const { rows: [etat] } = await client.query("SELECT id, statut FROM etats_charges WHERE id = $1::uuid FOR UPDATE", [req.params.id]);
    if (!etat) { await client.query("ROLLBACK"); return res.status(404).json({ error: "État introuvable." }); }
    if (etat.statut !== "soumis") { await client.query("ROLLBACK"); return res.status(409).json({ error: "L'état doit être soumis aux associés pour décider." }); }
    const { rows: lignes } = await client.query(
      `SELECT l.*, l.periode_debut::text AS periode_debut, l.periode_fin::text AS periode_fin, e.mois::text AS mois
       FROM etats_charges_lignes l JOIN etats_charges e ON e.id = l.etat_id
       WHERE l.etat_id = $1::uuid AND l.decision = 'en_attente' ORDER BY l.ordre, l.libelle FOR UPDATE OF l`, [req.params.id]);
    let ignorees = 0; let total = 0;
    for (const l of lignes) {
      const montant = Number(l.montant);
      if (!(montant > 0)) { ignorees += 1; continue; }
      const regl = await reglement(l.mode_paiement
        ? { mode_paiement: l.mode_paiement, compte_id: l.compte_id }
        : { mode_paiement: b.mode_paiement, compte_id: b.compte_id });
      if (regl.erreur) { await client.query("ROLLBACK"); return res.status(400).json({ error: `« ${l.libelle} » : ${regl.erreur}` }); }
      const v = regl.valeurs;
      const depenseId = await creerDepenseDeLigne(client, l, montant, v, req.user.sub);
      await client.query(
        `UPDATE etats_charges_lignes SET decision = 'approuvee', mode_paiement = $1::mode_paiement, compte_id = $2::uuid,
           decide_par = $3::uuid, decide_le = now(), depense_id = $4::uuid WHERE id = $5::uuid`,
        [v.mode_paiement, v.compte_id, req.user.sub, depenseId, l.id]);
      creees.push({ ligneId: l.id, depenseId, libelle: l.libelle, montant });
      total += montant;
    }
    if (!creees.length) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Aucune ligne à approuver (aucune ligne en attente avec un montant positif)." }); }
    await client.query("COMMIT");
    for (const c of creees) await copierPiecesVersDepense(c.ligneId, c.depenseId, req.user.sub);
    for (const c of creees) {
      await logAudit({ utilisateurId: req.user.sub, action: "etat_charges_approuvee", entite: "etat_charges_ligne", entiteId: c.ligneId,
        details: { libelle: c.libelle, montant: c.montant, groupee: true } });
    }
    await logAudit({ utilisateurId: req.user.sub, action: "etat_charges_approuver_tout", entite: "etat_charges", entiteId: req.params.id,
      details: { approuvees: creees.length, ignorees, total } });
    const complet = await chargerEtat(req.params.id);
    complet.approuvees = creees.length; complet.ignorees = ignorees; complet.total_approuve = total;
    res.json(complet);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

// Décision des associés sur une ligne : approuvee (crée la dépense validée),
// rejetee (motif obligatoire) ou reportee (revient le mois suivant).
// Le moyen / compte / montant peuvent être orientés dans la même requête.
router.post("/etats/:id/lignes/:ligneId/decision", requirePermission("depenses.decision"), async (req, res) => {
  const b = req.body || {};
  if (!["approuvee", "rejetee", "reportee"].includes(b.decision)) return res.status(400).json({ error: "Décision invalide (approuvee, rejetee ou reportee)." });
  if (b.decision === "rejetee" && !String(b.motif || "").trim()) return res.status(400).json({ error: "Un motif est obligatoire pour rejeter une charge." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [l] } = await client.query(
      `SELECT l.*, l.periode_debut::text AS periode_debut, l.periode_fin::text AS periode_fin, e.statut AS etat_statut, e.mois::text AS mois FROM etats_charges_lignes l JOIN etats_charges e ON e.id = l.etat_id
       WHERE l.id = $1::uuid AND l.etat_id = $2::uuid FOR UPDATE OF l`, [req.params.ligneId, req.params.id]);
    if (!l) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Ligne introuvable." }); }
    if (l.etat_statut !== "soumis") { await client.query("ROLLBACK"); return res.status(409).json({ error: "L'état doit être soumis aux associés pour décider." }); }
    if (l.decision !== "en_attente") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Cette ligne a déjà fait l'objet d'une décision." }); }
    const montant = b.montant === undefined ? Number(l.montant) : entier(b.montant);
    if (!montantValide(montant)) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Montant invalide (entier en FCFA)." }); }
    const regl = await reglement({
      mode_paiement: "mode_paiement" in b ? b.mode_paiement : l.mode_paiement,
      compte_id: "compte_id" in b ? b.compte_id : l.compte_id });
    if (regl.erreur) { await client.query("ROLLBACK"); return res.status(400).json({ error: regl.erreur }); }
    const v = regl.valeurs;
    let depenseId = null;
    if (b.decision === "approuvee") {
      if (montant <= 0) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Le montant doit être positif pour approuver." }); }
      depenseId = await creerDepenseDeLigne(client, l, montant, v, req.user.sub);
    }
    const { rows: [maj] } = await client.query(
      `UPDATE etats_charges_lignes SET decision = $1, motif = $2, montant = $3, mode_paiement = $4::mode_paiement, compte_id = $5::uuid,
         decide_par = $6::uuid, decide_le = now(), depense_id = $7::uuid
       WHERE id = $8::uuid RETURNING *`,
      [b.decision, b.motif ? String(b.motif).trim() : null, montant, v.mode_paiement, v.compte_id, req.user.sub, depenseId, l.id]);
    await client.query("COMMIT");
    if (depenseId) await copierPiecesVersDepense(l.id, depenseId, req.user.sub);
    await logAudit({ utilisateurId: req.user.sub, action: `etat_charges_${b.decision}`, entite: "etat_charges_ligne", entiteId: l.id,
      details: { libelle: l.libelle, montant, retard_mois: l.retard_mois } });
    res.json(maj);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

// Clôture : toutes les lignes doivent avoir fait l'objet d'une décision.
router.post("/etats/:id/cloturer", requirePermission("depenses.decision"), async (req, res) => {
  try {
    const { rows: [r] } = await pool.query(
      "SELECT count(*)::int AS n FROM etats_charges_lignes WHERE etat_id = $1::uuid AND decision = 'en_attente'", [req.params.id]);
    if (r.n) return res.status(409).json({ error: `${r.n} ligne(s) attendent encore une décision (approuver, rejeter ou reporter).` });
    const { rowCount } = await pool.query(
      "UPDATE etats_charges SET statut = 'clos', clos_par = $2::uuid, clos_le = now() WHERE id = $1::uuid AND statut = 'soumis'", [req.params.id, req.user.sub]);
    if (!rowCount) return res.status(409).json({ error: "L'état n'est pas soumis aux associés." });
    await logAudit({ utilisateurId: req.user.sub, action: "etat_charges_clos", entite: "etat_charges", entiteId: req.params.id });
    res.json(await chargerEtat(req.params.id));
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// PDF paysage pour les associés (aperçu / impression).
router.get("/etats/:id/pdf", requirePermission("depenses.consulter"), async (req, res) => {
  try {
    const etat = await chargerEtat(req.params.id);
    if (!etat) return res.status(404).json({ error: "État introuvable." });
    const { rows: [c] } = await pool.query("SELECT raison_sociale FROM parametres_cabinet WHERE id = 1");
    const pdf = await genererEtatChargesPdf({ etat, lignes: etat.lignes, raisonSociale: c && c.raison_sociale });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="etat-charges-${String(etat.mois).slice(0, 7)}.pdf"`);
    res.send(pdf);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

module.exports = router;
