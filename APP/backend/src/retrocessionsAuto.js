// JURIA — Rétrocessions des avocats apporteurs (13/11/2026).
//
// Règles décidées par l'utilisateur :
//  - réservées aux avocats apporteurs (rôles d'avocats), un ou plusieurs par dossier, avec une part en % (total 100) :
//    la rétrocession se PARTAGE entre eux (chacun applique le taux de sa qualité à sa part) ;
//  - date d'effet : dossiers ouverts à compter de parametres_cabinet.retro_date_effet (01/01/2027) ;
//  - base : honoraires de base HT de la facture, hors honoraires de résultat (mode success_fee) et hors facture exclue
//    (incident postérieur à une procédure préalable…) ;
//  - « tout ou rien » facture par facture : la rétrocession naît à l'encaissement intégral (statut « à décaisser ») ;
//  - convention-cadre (abonnement) : une seule fois, à la première facture d'abonnement intégralement encaissée, sur le
//    montant convenu (ou, à défaut, le HT facturé), et seulement si la convention le prévoit (clients.retro_abonnement).
// Idempotent : un index unique (facture, bénéficiaire) interdit tout doublon.
const { pool } = require("./db");

const ROLES_AVOCATS = ["associe", "associe_fondateur", "of_counsel", "collaborateur", "avocat_stagiaire"];
const TAUX = { associe: 30, collaborateur: 25 };
const qualiteDuRole = (role) => (role === "associe" || role === "associe_fondateur" ? "associe" : "collaborateur");

async function dateEffet(db = pool) {
  const { rows: [p] } = await db.query("SELECT retro_date_effet::text AS d FROM parametres_cabinet WHERE id = 1");
  return (p && p.d) || "2027-01-01";
}

// Répartition par défaut : parts égales (le reste des centimes au premier).
function partsEgales(n) {
  const base = Math.floor((10000 / n)) / 100;
  const parts = Array(n).fill(base);
  parts[0] = Math.round((100 - base * (n - 1)) * 100) / 100;
  return parts;
}

// Valide une liste [{utilisateur_id, part_pct?}] et renvoie la liste complétée (parts égales si aucune part saisie).
async function normaliserApporteurs(liste, db = pool) {
  if (!Array.isArray(liste)) return { erreur: "Liste d'apporteurs invalide." };
  if (!liste.length) return { apporteurs: [] };
  const ids = liste.map((a) => a && a.utilisateur_id);
  if (ids.some((i) => !i)) return { erreur: "Chaque apporteur doit être identifié." };
  if (new Set(ids).size !== ids.length) return { erreur: "Un même avocat ne peut figurer qu'une fois." };
  const { rows } = await db.query("SELECT id, role, actif FROM utilisateurs WHERE id = ANY($1::uuid[])", [ids]);
  if (rows.length !== ids.length) return { erreur: "Apporteur introuvable." };
  const hors = rows.find((u) => !ROLES_AVOCATS.includes(u.role));
  if (hors) return { erreur: "Seuls des avocats (associé, Of Counsel, collaborateur, avocat stagiaire) peuvent être apporteurs." };
  const saisies = liste.map((a) => (a.part_pct === undefined || a.part_pct === null || a.part_pct === "" ? null : Number(a.part_pct)));
  let parts;
  if (saisies.every((p) => p === null)) parts = partsEgales(liste.length);
  else if (saisies.some((p) => p === null || !(p > 0))) return { erreur: "Renseignez la part (en %) de chaque apporteur, ou aucune pour un partage égal." };
  else parts = saisies;
  const total = parts.reduce((s, p) => s + p, 0);
  if (Math.abs(total - 100) > 0.01) return { erreur: `Les parts doivent totaliser 100 % (actuellement ${Math.round(total * 100) / 100} %).` };
  return { apporteurs: liste.map((a, i) => ({ utilisateur_id: a.utilisateur_id, part_pct: parts[i] })) };
}

async function notifierAssocies(crees, facture) {
  try {
    const notif = require("./notifications");
    const ids = await notif.titulairesPermission("retrocessions.decaisser");
    const total = crees.reduce((s, r) => s + Number(r.montant), 0);
    await notif.notifier({
      type: "retro_a_decaisser", destinataires: ids, cle: "retro_a_decaisser", aTraiter: true,
      charge: { facture: facture.numero, n: crees.length, montant: total },
    });
  } catch (e) { console.error("Notification rétrocession non créée :", e.message); }
}

// Crée les rétrocessions dues pour une facture, si elle est éligible et intégralement encaissée. Renvoie les lignes créées.
async function declencherPourFacture(factureId, db = pool) {
  const { rows: [f] } = await db.query(
    `SELECT f.id, f.numero, f.mode::text AS mode, f.statut::text AS statut, f.montant_ht, f.montant_ttc, f.taux_applique,
            f.date_emission::text AS date_emission, f.client_id, f.dossier_id, f.retro_exclue,
            cl.abonnement_periodicite, cl.retro_abonnement, cl.abonnement_montant_convenu_xof,
            d.date_ouverture::text AS date_ouverture,
            COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.facture_id = f.id), 0) AS regle
     FROM factures f
     JOIN clients cl ON cl.id = f.client_id
     LEFT JOIN dossiers d ON d.id = f.dossier_id
     WHERE f.id = $1`, [factureId]);
  if (!f || f.statut === "annulee" || f.retro_exclue || f.mode === "success_fee") return [];
  if (Number(f.regle) < Number(f.montant_ttc) || Number(f.montant_ttc) <= 0) return [];
  const effet = await dateEffet(db);

  let apporteurs, base, dossierId = null;
  if (f.abonnement_periodicite) {
    // client sous convention-cadre : seule la facture d'abonnement compte, une seule fois
    if (f.mode !== "abonnement" || f.retro_abonnement !== "une_fois" || f.date_emission < effet) return [];
    const { rows: [deja] } = await db.query(
      `SELECT 1 FROM retrocessions r JOIN factures f2 ON f2.id = r.facture_id
       WHERE f2.client_id = $1 AND f2.mode = 'abonnement' AND r.origine = 'apport' LIMIT 1`, [f.client_id]);
    if (deja) return [];
    ({ rows: apporteurs } = await db.query(
      `SELECT a.utilisateur_id, a.part_pct, u.role::text AS role FROM apporteurs a JOIN utilisateurs u ON u.id = a.utilisateur_id
       WHERE a.client_id = $1 ORDER BY a.cree_le`, [f.client_id]));
    base = f.abonnement_montant_convenu_xof != null ? Number(f.abonnement_montant_convenu_xof) : Math.round(Number(f.montant_ht) * Number(f.taux_applique || 1));
  } else {
    if (f.mode === "abonnement" || !f.dossier_id || !f.date_ouverture || f.date_ouverture < effet) return [];
    dossierId = f.dossier_id;
    ({ rows: apporteurs } = await db.query(
      `SELECT a.utilisateur_id, a.part_pct, u.role::text AS role FROM apporteurs a JOIN utilisateurs u ON u.id = a.utilisateur_id
       WHERE a.dossier_id = $1 ORDER BY a.cree_le`, [f.dossier_id]));
    base = Math.round(Number(f.montant_ht) * Number(f.taux_applique || 1));
  }
  if (!apporteurs.length || !(base > 0)) return [];

  const crees = [];
  for (const a of apporteurs) {
    if (!ROLES_AVOCATS.includes(a.role)) continue;
    const qualite = qualiteDuRole(a.role);
    const taux = TAUX[qualite];
    const baseHt = Math.round((base * Number(a.part_pct)) / 100);
    const montant = Math.round((baseHt * taux) / 100);
    const { rows } = await db.query(
      `INSERT INTO retrocessions (beneficiaire_id, qualite, taux, dossier_id, facture_id, base_ht, montant, statut, origine, part_pct)
       VALUES ($1,$2::qualite_retro,$3,$4,$5,$6,$7,'a_decaisser','apport',$8)
       ON CONFLICT (facture_id, beneficiaire_id) WHERE origine = 'apport' DO NOTHING
       RETURNING id, beneficiaire_id, montant`,
      [a.utilisateur_id, qualite, taux, dossierId, f.id, baseHt, montant, a.part_pct]);
    if (rows[0]) crees.push(rows[0]);
  }
  if (crees.length) await notifierAssocies(crees, f);
  return crees;
}

// Appel « au mieux » depuis les circuits d'encaissement : ne fait jamais échouer le paiement.
async function declencherSansEchec(factureId) {
  try { return await declencherPourFacture(factureId); }
  catch (e) { console.error("Rétrocession automatique non calculée :", e.message); return []; }
}

// Après désignation des apporteurs d'un dossier : rattrape les factures déjà intégralement encaissées.
async function rattraperDossier(dossierId, db = pool) {
  const { rows } = await db.query("SELECT id FROM factures WHERE dossier_id = $1 AND statut = 'payee'", [dossierId]);
  let n = 0;
  for (const r of rows) n += (await declencherPourFacture(r.id, db)).length;
  return n;
}
async function rattraperClient(clientId, db = pool) {
  const { rows } = await db.query("SELECT id FROM factures WHERE client_id = $1 AND mode = 'abonnement' AND statut = 'payee' ORDER BY date_emission, cree_le", [clientId]);
  let n = 0;
  for (const r of rows) { n += (await declencherPourFacture(r.id, db)).length; if (n) break; }
  return n;
}

module.exports = {
  ROLES_AVOCATS, TAUX, qualiteDuRole, dateEffet, partsEgales, normaliserApporteurs,
  declencherPourFacture, declencherSansEchec, rattraperDossier, rattraperClient,
};
