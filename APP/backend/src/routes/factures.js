// JURIA — Facturation & paiements
const express = require("express");
const { pool } = require("../db");
const { requirePermission, estAutorise } = require("../permissions");
const { envoyerFacturePdf } = require("../facturePdf");
const { logAudit, diffChamps } = require("../audit");
const { MOYENS, comptesEligibles, preparerReglement, referenceCourte, PAR_CODE } = require("../moyensPaiement");
const router = express.Router();

// Qui supporte les frais retenus en route (virement de l'étranger, mobile money,
// transferts) : indiqué à la saisie, sinon d'après la mention de la facture.
// Frais à la charge du client : seule la somme réellement reçue (nette) est
// imputée sur la facture, qui reste due des frais ; à la charge du cabinet : le
// montant payé est imputé en entier.
function fraisACharge(demande, mention) {
  if (demande === "client" || demande === "cabinet") return demande;
  return /charge du client/i.test(mention || "") ? "client" : "cabinet";
}
function montantImpute(montant, frais, charge) {
  return frais > 0 && charge === "client" ? montant - frais : montant;
}

// Recalcule et met à jour le statut d'une facture selon les paiements reçus.
async function majStatut(factureId) {
  const f = await pool.query("SELECT montant_ttc FROM factures WHERE id = $1", [factureId]);
  if (!f.rows[0]) return;
  const ttc = Number(f.rows[0].montant_ttc);
  const p = await pool.query("SELECT COALESCE(SUM(montant),0) AS regle FROM paiements WHERE facture_id = $1", [factureId]);
  const regle = Number(p.rows[0].regle);
  let statut = "emise";
  if (regle <= 0) statut = "emise";
  else if (regle < ttc) statut = "partielle";
  else statut = "payee";
  await pool.query("UPDATE factures SET statut = $1 WHERE id = $2", [statut, factureId]);
  return statut;
}

// Résout le taux XOF applicable à une devise pour une facture qu'on émet
// maintenant, et le FIGE (règle « verrouillé à l'émission » du cahier des
// charges) :
//  - devise à parité fixe (XOF, EUR) : le taux vient de devises.parite_xof,
//    non négociable (ex. EUR = 655,957, arrimage BCEAO) — un taux_applique
//    fourni par l'appelant est ignoré pour ces devises.
//  - devise flottante (USD, GBP...) : soit l'appelant fournit b.taux_applique
//    pour CETTE facture (et on l'archive dans taux_change pour historique),
//    soit on reprend le dernier taux_change connu pour cette devise ; sans
//    l'un ou l'autre, on refuse (pas de taux inventé).
async function resoudreTauxChange(devise, tauxFourni, userId) {
  const d = await pool.query("SELECT code, flottante, parite_xof, actif FROM devises WHERE code = $1", [devise]);
  if (!d.rows[0] || !d.rows[0].actif) {
    return { erreur: `Devise inconnue ou inactive : ${devise}` };
  }
  const dev = d.rows[0];
  if (!dev.flottante) {
    return { taux: Number(dev.parite_xof) };
  }
  if (tauxFourni != null) {
    const taux = Number(tauxFourni);
    if (!(taux > 0)) return { erreur: "taux_applique invalide" };
    await pool.query(
      `INSERT INTO taux_change (devise_code, taux_vers_xof, source, saisi_par)
       VALUES ($1,$2,'saisie manuelle (facture)',$3)
       ON CONFLICT (devise_code, date_taux) DO UPDATE SET taux_vers_xof = EXCLUDED.taux_vers_xof`,
      [devise, taux, userId]
    );
    return { taux };
  }
  const t = await pool.query(
    "SELECT taux_vers_xof FROM taux_change WHERE devise_code = $1 ORDER BY date_taux DESC LIMIT 1",
    [devise]
  );
  if (!t.rows[0]) {
    return { erreur: `Aucun taux de change enregistré pour ${devise} — fournir taux_applique.` };
  }
  return { taux: Number(t.rows[0].taux_vers_xof) };
}

// GET /api/factures/moyens-paiement — catalogue des moyens d'encaissement et de
// leurs références (20/10/2026), d'après lequel l'écran construit le formulaire.
router.get("/moyens-paiement", requirePermission("factures.consulter"), (req, res) => {
  res.json(MOYENS.map((m) => ({ code: m.code, libelle: m.libelle, famille: m.famille, frais: !!m.frais, champs: m.champs })));
});

// GET /api/factures/moyens-paiement/:code/comptes — comptes pouvant recevoir ce moyen.
router.get("/moyens-paiement/:code/comptes", requirePermission("factures.consulter"), async (req, res) => {
  const moyen = PAR_CODE[req.params.code];
  if (!moyen) return res.status(404).json({ error: "Moyen inconnu" });
  try { res.json(await comptesEligibles(pool, moyen)); }
  catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// GET /api/factures/especes-a-deposer — encaissements en espèces pas encore déposés en banque.
router.get("/especes-a-deposer", requirePermission("factures.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.facture_id, f.numero AS facture_numero, p.date_paiement, p.montant, p.devise,
              p.references_paiement->>'numero_recu' AS numero_recu,
              COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client
       FROM paiements p JOIN factures f ON f.id = p.facture_id JOIN clients c ON c.id = f.client_id
       WHERE p.depot_statut = 'en_attente' ORDER BY p.date_paiement, p.cree_le`
    );
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/factures/paiements/:paiementId/depot { compte_id, date_depot? } — enregistre le
// dépôt en banque d'un encaissement en espèces.
router.post("/paiements/:paiementId/depot", requirePermission("factures.paiement.ajouter"), async (req, res) => {
  const b = req.body || {};
  if (!b.compte_id) return res.status(400).json({ error: "Compte de dépôt requis." });
  const date = b.date_depot || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || new Date(date) > new Date()) return res.status(400).json({ error: "Date de dépôt invalide." });
  try {
    const { rows: [p] } = await pool.query("SELECT id, facture_id, depot_statut FROM paiements WHERE id = $1", [req.params.paiementId]);
    if (!p) return res.status(404).json({ error: "Paiement introuvable" });
    if (p.depot_statut !== "en_attente") return res.status(409).json({ error: "Cet encaissement n'est pas en attente de dépôt." });
    const eligibles = await comptesEligibles(pool, PAR_CODE.especes);
    if (!eligibles.some((c) => c.id === b.compte_id)) return res.status(400).json({ error: "Ce compte ne peut pas recevoir un dépôt d'espèces." });
    await pool.query("UPDATE paiements SET depot_statut = 'depose', date_depot = $1::date, compte_id = $2::uuid WHERE id = $3", [date, b.compte_id, p.id]);
    await logAudit({ utilisateurId: req.user.sub, action: "deposer_especes", entite: "factures", entiteId: p.facture_id,
      details: { paiement_id: p.id, compte_id: b.compte_id, date_depot: date }, ip: req.ip });
    res.json({ id: p.id, depot_statut: "depose" });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// GET /api/factures?statut=  |  GET /api/factures/impayees
router.get("/impayees", requirePermission("factures.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.numero, f.client_id, f.montant_ttc, f.devise, f.statut, f.date_echeance,
              COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client,
              f.montant_ttc - COALESCE((SELECT SUM(montant) FROM paiements p WHERE p.facture_id = f.id),0) AS reste
       FROM factures f JOIN clients c ON c.id = f.client_id
       WHERE f.statut IN ('emise','partielle','impayee')
       ORDER BY f.date_echeance NULLS LAST`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/factures/encaissements?mode=&debut=&fin=&client_id=&dossier_id=
// Vue "Encaissements" (16/10/2026) : une ligne par PAIEMENT (et non par
// facture, qui peut être réglée par plusieurs moyens), avec le total par
// moyen de paiement en FCFA (montant_xof, repli sur montant pour XOF).
router.get("/encaissements", requirePermission("factures.consulter"), async (req, res) => {
  const { mode, debut, fin, client_id, dossier_id } = req.query;
  const params = [];
  const clauses = [];
  if (mode) { params.push(mode); clauses.push(`p.mode = $${params.length}::mode_paiement`); }
  if (debut) { params.push(debut); clauses.push(`p.date_paiement >= $${params.length}::date`); }
  if (fin) { params.push(fin); clauses.push(`p.date_paiement <= $${params.length}::date`); }
  if (client_id) { params.push(client_id); clauses.push(`f.client_id = $${params.length}::uuid`); }
  if (dossier_id) { params.push(dossier_id); clauses.push(`f.dossier_id = $${params.length}::uuid`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.facture_id, f.numero AS facture_numero, f.client_id, f.dossier_id,
              d.numero AS dossier_numero, p.date_paiement, p.mode, p.montant, p.devise,
              COALESCE(p.montant_xof, p.montant) AS montant_xof, p.reference,
              p.frais_retenus, p.frais_a_charge, p.depot_statut, cb.intitule AS compte_intitule,
              COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client
       FROM paiements p
       JOIN factures f ON f.id = p.facture_id
       JOIN clients c ON c.id = f.client_id
       LEFT JOIN dossiers d ON d.id = f.dossier_id
       LEFT JOIN comptes_bancaires cb ON cb.id = p.compte_id
       ${where}
       ORDER BY p.date_paiement DESC, p.cree_le DESC LIMIT 500`,
      params
    );
    const totaux = {};
    for (const r of rows) {
      const t = (totaux[r.mode] ||= { mode: r.mode, nb: 0, montant_xof: 0 });
      t.nb += 1;
      t.montant_xof += Number(r.montant_xof);
    }
    res.json({
      lignes: rows,
      totaux: Object.values(totaux).sort((a, b) => b.montant_xof - a.montant_xof),
      total_xof: rows.reduce((s, r) => s + Number(r.montant_xof), 0),
      tronque: rows.length >= 500,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/", requirePermission("factures.consulter"), async (req, res) => {
  const { statut, dossier_id, client_id, etat } = req.query;
  const params = [];
  const clauses = [];
  if (statut) { params.push(statut); clauses.push(`f.statut = $${params.length}::statut_facture`); }
  // Filtres métier (16/10/2026) : "payee" = intégralement réglée (soldée),
  // "non_soldee" = reste à payer (émise ou partielle), "partielle", "annulee",
  // "en_retard" = échéance dépassée avec un reliquat. Le statut "impayee"
  // n'est jamais posé : le retard est dérivé, pas stocké.
  const REGLE = "COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.facture_id = f.id),0)";
  if (etat === "payee") clauses.push("f.statut = 'payee'");
  else if (etat === "non_soldee") clauses.push("f.statut IN ('emise','partielle')");
  else if (etat === "partielle") clauses.push("f.statut = 'partielle'");
  else if (etat === "annulee") clauses.push("f.statut = 'annulee'");
  else if (etat === "en_retard") clauses.push(`f.statut IN ('emise','partielle') AND f.date_echeance < current_date AND f.montant_ttc - ${REGLE} > 0`);
  if (dossier_id) { params.push(dossier_id); clauses.push(`f.dossier_id = $${params.length}`); }
  if (client_id) { params.push(client_id); clauses.push(`f.client_id = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.numero, f.objet, f.mode, f.montant_ht, f.taux_tva, f.montant_frais, f.montant_debours, f.montant_ttc, f.devise,
              f.taux_applique, f.montant_ttc_xof, f.statut, f.mention, f.mode_reglement, f.compte_reglement_id,
              f.date_emission, f.date_echeance, f.dossier_id, f.client_id,
              COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client,
              d.numero AS dossier_numero,
              COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.facture_id = f.id),0) AS encaisse,
              CASE WHEN f.statut = 'annulee' THEN 0
                   ELSE f.montant_ttc - COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.facture_id = f.id),0) END AS reliquat
       FROM factures f
       JOIN clients c ON c.id = f.client_id
       LEFT JOIN dossiers d ON d.id = f.dossier_id
       ${where}
       ORDER BY f.cree_le DESC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Vérifie qu'un lot de lignes (temps ou dépenses) verrouillées appartient
// toutes à un même dossier, cohérent avec dossierId s'il est déjà connu —
// factorisé pour éviter de dupliquer la même logique entre temps_ids et
// depense_ids (voir diagnostic Facturation, 22-25/08/2026).
function verifierDossierUnique(rows, dossierIdConnu) {
  const distincts = new Set(rows.map((r) => r.dossier_id));
  if (distincts.size > 1) return { erreur: "Les lignes sélectionnées appartiennent à des dossiers différents." };
  const dossierLignes = rows[0].dossier_id;
  if (dossierIdConnu && dossierLignes && dossierIdConnu !== dossierLignes) {
    return { erreur: "dossier_id ne correspond pas au dossier des lignes sélectionnées." };
  }
  return { dossierId: dossierLignes || dossierIdConnu };
}

// POST /api/factures
// { dossier_id?, client_id?, mode, montant_ht, devise?, taux_applique?,
//   taux_tva?, provision?, montant_frais?, date_echeance? }
// ... ou, pour facturer du temps déjà saisi plutôt que saisir un montant :
// { dossier_id, mode, temps_ids: [...], devise?('XOF' uniquement), ... }
// — montant_ht est alors calculé depuis les temps sélectionnés (voir
// diagnostic Facturation du 22/08/2026, HISTORY.md) et b.montant_ht est
// ignoré s'il est fourni en même temps que temps_ids.
// ... et/ou, pour refacturer des débours déjà avancés pour le client :
// { depense_ids: [...] } — montant_debours calculé depuis les dépenses
// `refacturable_client=TRUE` et déjà décaissées sélectionnées (diagnostic
// Facturation, 25/08/2026 — « le schéma proposé suffit-il ? »). temps_ids
// et depense_ids sont combinables sur une même facture.
// mode_reglement?, compte_reglement_id?, mention? : existaient déjà au
// schéma (17/08/2026) mais n'étaient acceptés par aucune route — câblés le
// 28/08/2026 (facture PDF enrichie) pour imprimer les coordonnées
// bancaires du cabinet et une instruction libre sur la facture.
// objet? : distinct de l'objet du dossier lié (dossiers.objet, toujours
// affiché en repli sur le PDF si absent) — permet de préciser/écraser sur
// UNE facture donnée sans toucher à la fiche dossier (diagnostic
// Facturation, 05/09/2026).
router.post("/", requirePermission("factures.creer"), async (req, res) => {
  const b = req.body || {};
  const tempsIds = Array.isArray(b.temps_ids) ? b.temps_ids.filter(Boolean) : [];
  const depenseIds = Array.isArray(b.depense_ids) ? b.depense_ids.filter(Boolean) : [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let clientId = b.client_id;
    let dossierId = b.dossier_id || null;

    // Le taux horaire des temps saisis (comme le montant d'une dépense) est
    // toujours enregistré en FCFA — la conversion vers une autre devise n'a
    // pas de sens ici sans un taux à appliquer à un montant qui n'existe pas
    // encore comme tel : refusé plutôt que de deviner.
    const devise = (b.devise || "XOF").toUpperCase();
    if ((tempsIds.length || depenseIds.length) && devise !== "XOF") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "La facturation depuis des temps saisis ou des débours n'est prise en charge qu'en XOF (montants toujours enregistrés en FCFA)." });
    }

    let ht;
    let tempsFactures = [];
    if (tempsIds.length) {
      // Verrouille les lignes sélectionnées pour éviter qu'un même temps
      // soit facturé deux fois en cas de double clic/appel concurrent
      // (même famille de garde que les corrections de concurrence du
      // 17/08/2026, cf. CLAUDE.md).
      const t = await client.query(
        `SELECT id, dossier_id, duree_minutes, taux_horaire FROM temps
         WHERE id = ANY($1::uuid[]) AND facturable = TRUE AND facture_id IS NULL
         FOR UPDATE`,
        [tempsIds]
      );
      if (t.rows.length !== tempsIds.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Certains temps sélectionnés ont déjà été facturés ou ne sont plus disponibles." });
      }
      const verif = verifierDossierUnique(t.rows, dossierId);
      if (verif.erreur) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: verif.erreur });
      }
      dossierId = verif.dossierId;
      ht = t.rows.reduce((somme, r) => somme + Math.round((Number(r.duree_minutes) / 60) * Number(r.taux_horaire)), 0);
      tempsFactures = t.rows.map((r) => r.id);
    } else if (!depenseIds.length) {
      const htRaw = Number(b.montant_ht);
      if (!Number.isFinite(htRaw) || htRaw <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "montant_ht invalide (nombre positif requis)" });
      }
      ht = Math.round(htRaw);
    } else {
      // Facture composée uniquement de débours (pas d'honoraires) : montant_ht
      // reste optionnel, 0 par défaut plutôt que rejeté.
      const htRaw = b.montant_ht !== undefined ? Number(b.montant_ht) : 0;
      if (!Number.isFinite(htRaw) || htRaw < 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "montant_ht invalide (nombre positif ou nul)" });
      }
      ht = Math.round(htRaw);
    }

    let debours = 0;
    let deboursFactures = [];
    if (depenseIds.length) {
      // Une dépense n'est refacturable que si elle a été explicitement
      // marquée comme telle ET réellement décaissée (le cabinet a bien
      // avancé l'argent) — pas juste soumise/validée.
      const d = await client.query(
        `SELECT id, dossier_id, montant FROM depenses
         WHERE id = ANY($1::uuid[]) AND refacturable_client = TRUE AND statut = 'decaissee' AND facture_id IS NULL
         FOR UPDATE`,
        [depenseIds]
      );
      if (d.rows.length !== depenseIds.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Certaines dépenses sélectionnées ne sont plus disponibles (déjà refacturées, non décaissées, ou non refacturables)." });
      }
      const verif = verifierDossierUnique(d.rows, dossierId);
      if (verif.erreur) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: verif.erreur });
      }
      dossierId = verif.dossierId;
      debours = d.rows.reduce((somme, r) => somme + Math.round(Number(r.montant)), 0);
      deboursFactures = d.rows.map((r) => r.id);
    }

    const frais = b.montant_frais !== undefined ? Math.round(Number(b.montant_frais)) : 0;
    if (!Number.isFinite(frais) || frais < 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "montant_frais invalide" });
    }

    if (!clientId && dossierId) {
      const d = await client.query("SELECT client_id FROM dossiers WHERE id = $1", [dossierId]);
      clientId = d.rows[0] ? d.rows[0].client_id : null;
    }
    if (!clientId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "client_id ou dossier_id valide requis" });
    }
    if (!b.mode) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "mode d'honoraires requis" });
    }

    const { taux, erreur } = await resoudreTauxChange(devise, b.taux_applique, req.user.sub);
    if (erreur) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: erreur });
    }

    // TVA : 18 % par défaut pour un client localisé au Mali, 0 % par défaut
    // pour un client hors Mali (prestation hors territorialité) — ce sont
    // des VALEURS DE DÉPART, pas un avis fiscal, toujours écrasées si
    // b.taux_tva est fourni explicitement. À valider avec l'expert-comptable
    // du cabinet avant de s'y fier en production réelle. Comparaison
    // insensible à la casse/espaces (« MALI », « mali » ne tombaient pas
    // dans la règle par défaut avant ce correctif — diagnostic du 22/08/2026).
    let tauxTva = b.taux_tva !== undefined ? Number(b.taux_tva) : null;
    if (tauxTva == null) {
      const cl = await client.query("SELECT pays FROM clients WHERE id = $1", [clientId]);
      const pays = cl.rows[0] ? cl.rows[0].pays : null;
      tauxTva = !pays || pays.trim().toLowerCase() === "mali" ? 18 : 0;
    }

    // TVA calculée uniquement sur les honoraires (HT) — frais et débours
    // sont hors TVA (un débours est un remboursement, pas une prestation ;
    // même traitement retenu pour les frais par cohérence, faute de cas
    // d'usage contraire signalé).
    const tva = Math.round((ht * tauxTva) / 100);
    const ttc = ht + tva + frais + debours;
    const ttcXof = Math.round(ttc * taux);
    const libellePrincipal = ["xof", "devise"].includes(b.libelle_principal)
      ? b.libelle_principal
      : (devise === "XOF" ? "xof" : "devise");

    // Numérotation automatique : F-AA-XXX
    const yy = new Date().getFullYear().toString().slice(2);
    // 21/10/2026 — « plus grand numéro + 1 » (et non « nombre de factures + 1 », qui retombait
    // sur un numéro déjà pris après une suppression ou un numéro saisi à la main) ; verrou de
    // transaction pour que deux émissions simultanées n'obtiennent pas le même numéro.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('numero_facture'))");
    const c = await client.query(
      "SELECT COALESCE(MAX(CAST(substring(numero from '^F-[0-9]{2}-([0-9]+)$') AS integer)), 0) + 1 AS n FROM factures WHERE numero LIKE $1",
      [`F-${yy}-%`]);
    const numero = b.numero || `F-${yy}-${String(c.rows[0].n).padStart(3, "0")}`;

    const { rows } = await client.query(
      `INSERT INTO factures
         (numero, client_id, dossier_id, mode, montant_ht, taux_tva, montant_tva, montant_ttc,
          provision, devise, taux_applique, date_taux, taux_verrouille, montant_ttc_xof,
          libelle_principal, montant_frais, montant_debours, statut, date_emission, date_echeance,
          mode_reglement, compte_reglement_id, mention, objet)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),$10,$11,current_date,TRUE,$12,
               $13,$14,$15,'emise',current_date,$16,$17,$18,$19,$20)
       RETURNING id, numero, objet, montant_ht, montant_ttc, devise, taux_applique, montant_ttc_xof,
                 montant_frais, montant_debours, statut`,
      [numero, clientId, dossierId, b.mode, ht, tauxTva, tva, ttc, b.provision,
       devise, taux, ttcXof, libellePrincipal, frais, debours, b.date_echeance || null,
       b.mode_reglement || null, b.compte_reglement_id || null, b.mention || null, b.objet || null]
    );

    // Acompte / provision reçu à l'émission (16/10/2026) : un premier
    // paiement partiel enregistré dans la même transaction que la facture.
    let acompteEnregistre = null;
    if (b.acompte && Number(b.acompte.montant) > 0) {
      const mnt = Math.round(Number(b.acompte.montant));
      if (!b.acompte.mode) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Acompte : moyen de paiement requis." }); }
      if (mnt > Math.round(Number(rows[0].montant_ttc))) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Acompte : le montant (${mnt}) dépasse le total de la facture (${rows[0].montant_ttc}).` });
      }
      if (!(await estAutorise(req.user.role, "factures.paiement.ajouter", req.user.sub))) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Vous n'avez pas le droit d'enregistrer un paiement." });
      }
      const regl = await preparerReglement(client, { ...b.acompte, date_paiement: undefined }, { montant: mnt, compteParDefaut: b.compte_reglement_id || null });
      if (regl.erreur) { await client.query("ROLLBACK"); return res.status(400).json({ error: `Acompte : ${regl.erreur}` }); }
      const v = regl.valeurs;
      const charge = fraisACharge(b.acompte.frais_a_charge, b.mention);
      const imputeA = montantImpute(mnt, v.frais_retenus, charge);
      if (imputeA <= 0) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Acompte : les frais retenus absorbent tout le paiement." }); }
      await client.query(
        `INSERT INTO paiements (facture_id, montant, mode, date_paiement, reference, devise, taux_applique, montant_xof,
                                compte_id, references_paiement, frais_retenus, depot_statut, date_depot, montant_verse, frais_a_charge)
         VALUES ($1,$2,$3::mode_paiement,current_date,$4,$5,$6,$7,$8::uuid,$9::jsonb,$10,$11,$12::date,$13,$14)`,
        [rows[0].id, imputeA, b.acompte.mode, referenceCourte(v.references) || b.acompte.reference || null, rows[0].devise, rows[0].taux_applique,
         Math.round(imputeA * Number(rows[0].taux_applique)), v.compte_id, JSON.stringify(v.references), v.frais_retenus, v.depot_statut, v.date_depot, mnt, charge]
      );
      acompteEnregistre = imputeA;
    }

    if (tempsFactures.length) {
      await client.query("UPDATE temps SET facture_id = $1 WHERE id = ANY($2::uuid[])", [rows[0].id, tempsFactures]);
    }
    if (deboursFactures.length) {
      await client.query("UPDATE depenses SET facture_id = $1 WHERE id = ANY($2::uuid[])", [rows[0].id, deboursFactures]);
    }

    await client.query("COMMIT");
    await logAudit({ utilisateurId: req.user.sub, action: "creer_facture", entite: "factures", entiteId: rows[0].id,
      details: { numero: rows[0].numero, montant_ttc: Number(rows[0].montant_ttc), devise: rows[0].devise, acompte: acompteEnregistre || null }, ip: req.ip });
    const statutFinal = acompteEnregistre ? await majStatut(rows[0].id) : rows[0].statut;
    res.status(201).json({
      ...rows[0],
      statut: statutFinal,
      acompte: acompteEnregistre || undefined,
      temps_factures: tempsFactures.length || undefined,
      depenses_facturees: deboursFactures.length || undefined,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// POST /api/factures/:id/annuler
// Annule une facture émise à tort — refusée si un paiement a déjà été
// enregistré dessus (une facture partiellement/totalement réglée ne
// s'annule pas, elle se corrige par un avoir, hors périmètre actuel —
// diagnostic Facturation du 22/08/2026, HISTORY.md). Les temps et dépenses
// éventuellement rattachés (b.temps_ids/b.depense_ids à la création) sont
// libérés (facture_id remis à NULL) pour pouvoir être refacturés.
router.post("/:id/annuler", requirePermission("factures.annuler"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const p = await client.query("SELECT COALESCE(SUM(montant),0) AS regle FROM paiements WHERE facture_id = $1", [req.params.id]);
    if (Number(p.rows[0].regle) > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Facture déjà réglée (au moins partiellement) : impossible de l'annuler." });
    }
    const maj = await client.query(
      "UPDATE factures SET statut = 'annulee' WHERE id = $1 AND statut <> 'annulee' RETURNING id, numero, statut",
      [req.params.id]
    );
    if (!maj.rows[0]) {
      await client.query("ROLLBACK");
      const existe = await pool.query("SELECT id FROM factures WHERE id = $1", [req.params.id]);
      return res.status(existe.rows[0] ? 409 : 404).json(
        existe.rows[0] ? { error: "Facture déjà annulée." } : { error: "Facture introuvable" }
      );
    }
    await client.query("UPDATE temps SET facture_id = NULL WHERE facture_id = $1", [req.params.id]);
    await client.query("UPDATE depenses SET facture_id = NULL WHERE facture_id = $1", [req.params.id]);
    await client.query("COMMIT");
    await logAudit({ utilisateurId: req.user.sub, action: "annuler_facture", entite: "factures", entiteId: req.params.id, details: { numero: maj.rows[0].numero }, ip: req.ip });
    res.json(maj.rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// PUT /api/factures/:id  { objet?, mode? (mode d'honoraires), montant_ht?, taux_tva?, montant_frais?,
//   date_echeance?, mode_reglement?, compte_reglement_id?, mention? }
// Corrige une facture émise. Réutilise le taux de change et le montant de
// débours déjà figés à l'émission (ni l'un ni l'autre ne se corrigent ici —
// annuler/recréer si la devise ou les débours rattachés doivent changer) ;
// même palier de permission que l'annulation (factures.annuler).
//
// 09/10/2026 (gap signalé par l'utilisateur — « aucune possibilité de
// mettre à jour les montants des factures déjà émises en raison d'une
// erreur ») : jusqu'ici UN SEUL paiement, même une poussière, même saisi
// par erreur, bloquait TOUTE correction — y compris un simple objet/mention
// sans aucun rapport avec le montant. Distingue désormais deux familles de
// champs : ceux qui AFFECTENT le montant dû (montant_ht/taux_tva/
// montant_frais) restent verrouillés dès qu'un paiement existe (intégrité
// du montant déjà réglé — retirer le paiement d'abord via
// DELETE /:id/paiements/:paiementId, qui réévalue le statut et rouvre
// cette correction, voir majStatut) ; les champs purement administratifs
// (objet, échéance, règlement, mention) restent corrigibles à tout moment
// tant que la facture n'est pas annulée (seul état réellement figé).
router.put("/:id", requirePermission("factures.annuler"), async (req, res) => {
  const b = req.body || {};
  try {
    const cur = await pool.query(
      `SELECT statut, montant_ht, taux_tva, montant_frais, montant_debours, taux_applique, montant_ttc, objet,
              date_echeance::text AS date_echeance, mode_reglement, compte_reglement_id, mention, mode FROM factures WHERE id = $1`,
      [req.params.id]
    );
    if (!cur.rows[0]) return res.status(404).json({ error: "Facture introuvable" });
    if (cur.rows[0].statut === "annulee") {
      return res.status(409).json({ error: "Facture annulée — non modifiable. Recréez-la si nécessaire." });
    }
    const MODES_HONORAIRES = ["forfait", "temps_passe", "success_fee", "abonnement", "consultation", "autre"];
    if (b.mode && !MODES_HONORAIRES.includes(b.mode)) return res.status(400).json({ error: "Mode d'honoraires invalide." });
    if (b.mode_reglement && !PAR_CODE[b.mode_reglement]) return res.status(400).json({ error: "Moyen de règlement invalide : choisissez dans la liste." });
    const financeTouchee = b.montant_ht !== undefined || b.taux_tva !== undefined || b.montant_frais !== undefined;
    if (financeTouchee && cur.rows[0].statut !== "emise") {
      return res.status(409).json({
        error: "Le montant ne peut plus être corrigé : un paiement est déjà enregistré sur cette facture. Retirez-le d'abord (onglet Paiements) pour pouvoir le corriger.",
      });
    }

    const ht = b.montant_ht !== undefined ? Math.round(Number(b.montant_ht)) : Number(cur.rows[0].montant_ht);
    if (!Number.isFinite(ht) || ht <= 0) return res.status(400).json({ error: "montant_ht invalide (nombre positif requis)" });
    const tauxTva = b.taux_tva !== undefined ? Number(b.taux_tva) : Number(cur.rows[0].taux_tva);
    if (!Number.isFinite(tauxTva) || tauxTva < 0) return res.status(400).json({ error: "taux_tva invalide" });
    const frais = b.montant_frais !== undefined ? Math.round(Number(b.montant_frais)) : Number(cur.rows[0].montant_frais);
    if (!Number.isFinite(frais) || frais < 0) return res.status(400).json({ error: "montant_frais invalide" });
    const debours = Number(cur.rows[0].montant_debours);
    const tauxApplique = Number(cur.rows[0].taux_applique);

    const tva = Math.round((ht * tauxTva) / 100);
    const ttc = ht + tva + frais + debours;
    const ttcXof = Math.round(ttc * tauxApplique);

    const { rows } = await pool.query(
      `UPDATE factures SET
         objet = COALESCE($1, objet), montant_ht = $2, taux_tva = $3, montant_tva = $4,
         montant_frais = $5, montant_ttc = $6, montant_ttc_xof = $7,
         date_echeance = COALESCE($8, date_echeance), mode_reglement = COALESCE($9::mode_paiement, mode_reglement),
         compte_reglement_id = COALESCE($10::uuid, compte_reglement_id), mention = COALESCE($11, mention),
         mode = COALESCE($13::mode_honoraires, mode)
       WHERE id = $12
       RETURNING id, numero, objet, montant_ht, montant_tva, montant_frais, montant_ttc, montant_ttc_xof, statut, date_echeance::text AS date_echeance,
                 mode_reglement, compte_reglement_id, mention, taux_tva, mode`,
      [b.objet ?? null, ht, tauxTva, tva, frais, ttc, ttcXof,
       b.date_echeance || null, b.mode_reglement || null, b.compte_reglement_id || null, b.mention ?? null,
       req.params.id, b.mode || null]
    );
    // Trace (avant / après) d'une correction de facture émise ou payée (29/10/2026).
    const changements = diffChamps(cur.rows[0], rows[0], ["objet", "mode", "montant_ht", "taux_tva", "montant_frais", "montant_ttc", "date_echeance", "mode_reglement", "compte_reglement_id", "mention"]);
    if (Object.keys(changements).length) {
      await logAudit({ utilisateurId: req.user.sub, action: "modifier_facture", entite: "factures", entiteId: req.params.id,
        details: { numero: rows[0].numero, statut: rows[0].statut, changements }, ip: req.ip });
    }
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/factures/:id/paiements  { montant, mode, reference? }
// Un paiement est toujours dans la devise de sa facture (pas de règlement
// multi-devises sur une même facture) ; l'équivalence FCFA reprend le taux
// figé de la facture (déjà verrouillé à l'émission).
router.post("/:id/paiements", requirePermission("factures.paiement.ajouter"), async (req, res) => {
  const b = req.body || {};
  if (!b.montant || !b.mode) return res.status(400).json({ error: "montant et mode requis" });
  const montant = Math.round(Number(b.montant));
  if (!(montant > 0)) return res.status(400).json({ error: "Le montant doit être positif." });
  if (b.date_paiement && new Date(b.date_paiement) > new Date()) {
    return res.status(400).json({ error: "La date du paiement ne peut pas être dans le futur." });
  }
  try {
    const f = await pool.query(
      `SELECT f.devise, f.taux_applique, f.statut, f.montant_ttc, f.compte_reglement_id, f.mention,
              COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.facture_id = f.id),0) AS regle
       FROM factures f WHERE f.id = $1`, [req.params.id]);
    if (!f.rows[0]) return res.status(404).json({ error: "Facture introuvable" });
    if (f.rows[0].statut === "annulee") return res.status(409).json({ error: "Facture annulée : aucun paiement possible." });
    const regl = await preparerReglement(pool, b, { montant, compteParDefaut: f.rows[0].compte_reglement_id });
    if (regl.erreur) return res.status(400).json({ error: regl.erreur });
    const v = regl.valeurs;
    const charge = fraisACharge(b.frais_a_charge, f.rows[0].mention);
    const impute = montantImpute(montant, v.frais_retenus, charge);
    if (impute <= 0) return res.status(400).json({ error: "Les frais retenus absorbent tout le paiement." });
    // Un paiement ne peut pas dépasser le reliquat (contrôle de saisie : un
    // trop-perçu serait un autre sujet — avoir/remboursement — à traiter à part).
    const reliquat = Number(f.rows[0].montant_ttc) - Number(f.rows[0].regle);
    if (impute > reliquat) {
      return res.status(409).json({ error: `Le montant imputé (${impute}) dépasse le reliquat de la facture (${reliquat}).`, reliquat });
    }
    const montantXof = Math.round(impute * Number(f.rows[0].taux_applique));
    await pool.query(
      `INSERT INTO paiements (facture_id, montant, mode, date_paiement, reference, devise, taux_applique, montant_xof,
                              compte_id, references_paiement, frais_retenus, depot_statut, date_depot, montant_verse, frais_a_charge)
       VALUES ($1,$2,$3::mode_paiement,COALESCE($4::date, current_date),$5,$6,$7,$8,$9::uuid,$10::jsonb,$11,$12,$13::date,$14,$15)`,
      [req.params.id, impute, b.mode, b.date_paiement || null, referenceCourte(v.references) || b.reference || null,
       f.rows[0].devise, f.rows[0].taux_applique, montantXof, v.compte_id, JSON.stringify(v.references), v.frais_retenus, v.depot_statut, v.date_depot, montant, charge]
    );
    const statut = await majStatut(req.params.id);
    await logAudit({ utilisateurId: req.user.sub, action: "ajouter_paiement", entite: "factures", entiteId: req.params.id,
      details: { montant: impute, mode: b.mode, date_paiement: b.date_paiement || null, statut }, ip: req.ip });
    res.status(201).json({ facture_id: req.params.id, statut, reliquat: reliquat - impute });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/factures/:id/paiements/:paiementId  { mode?, compte_id?, references?, date_paiement?, date_depot? }
// (29/10/2026) Corrige le MOYEN d'un paiement déjà enregistré (moyen, compte, références, date) sans le supprimer : jusqu'ici,
// une erreur de moyen ou de n° de chèque obligeait à supprimer le paiement (statut de la facture rouvert) et à le ressaisir.
// Le MONTANT, les frais retenus et l'équivalence FCFA ne changent pas ici (supprimer / ressaisir). Même palier que la
// suppression (factures.annuler) ; tracé avant / après au journal d'audit.
router.put("/:id/paiements/:paiementId", requirePermission("factures.annuler"), async (req, res) => {
  const b = req.body || {};
  try {
    const { rows: [p] } = await pool.query(
      `SELECT id, montant, montant_verse, mode, date_paiement::text AS date_paiement, reference, compte_id, references_paiement,
              frais_retenus, depot_statut, date_depot::text AS date_depot FROM paiements WHERE id = $1 AND facture_id = $2`,
      [req.params.paiementId, req.params.id]);
    if (!p) return res.status(404).json({ error: "Paiement introuvable" });
    const { rows: [fac] } = await pool.query("SELECT statut FROM factures WHERE id = $1", [req.params.id]);
    if (!fac || fac.statut === "annulee") return res.status(409).json({ error: "Facture annulée : paiement non modifiable." });
    const { rows: [issuDeFonds] } = await pool.query("SELECT 1 FROM fonds_tiers_mouvements WHERE paiement_id = $1 AND statut = 'valide' LIMIT 1", [p.id]);
    if (issuDeFonds) return res.status(409).json({ error: "Ce paiement provient d'une imputation sur les fonds de tiers (CARPA) : corrigez-le dans « Fonds de tiers »." });
    const date = b.date_paiement || p.date_paiement;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return res.status(400).json({ error: "Date de paiement invalide (AAAA-MM-JJ)." });
    if (new Date(date) > new Date()) return res.status(400).json({ error: "La date du paiement ne peut pas être dans le futur." });
    const mode = b.mode || p.mode;
    const memeMoyen = mode === p.mode;
    const regl = await preparerReglement(pool, {
      mode,
      compte_id: "compte_id" in b ? (b.compte_id || null) : (memeMoyen ? p.compte_id : null),
      references: b.references !== undefined ? b.references : (memeMoyen ? p.references_paiement : {}),
      frais_retenus: p.frais_retenus,
      date_depot: b.date_depot || (memeMoyen && p.date_depot ? p.date_depot : undefined),
      date_paiement: date,
    }, { montant: Number(p.montant_verse ?? p.montant) });
    if (regl.erreur) return res.status(400).json({ error: regl.erreur });
    const v = regl.valeurs;
    await pool.query(
      `UPDATE paiements SET mode = $1::mode_paiement, date_paiement = $2::date, reference = $3, compte_id = $4::uuid,
              references_paiement = $5::jsonb, depot_statut = $6, date_depot = $7::date WHERE id = $8`,
      [mode, date, referenceCourte(v.references) || null, v.compte_id, JSON.stringify(v.references), v.depot_statut, v.date_depot, p.id]);
    await logAudit({
      utilisateurId: req.user.sub, action: "corriger_paiement", entite: "factures", entiteId: req.params.id,
      details: { paiement_id: p.id, avant: { mode: p.mode, compte_id: p.compte_id, date_paiement: p.date_paiement, references: p.references_paiement },
                 apres: { mode, compte_id: v.compte_id, date_paiement: date, references: v.references } },
      ip: req.ip,
    });
    res.json({ id: p.id, mode, compte_id: v.compte_id, date_paiement: date, references: v.references, depot_statut: v.depot_statut });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// GET /api/factures/:id/paiements — historique des règlements d'une facture
// (25/09/2026 : jusqu'ici aucun écran ne listait les paiements enregistrés).
router.get("/:id/paiements", requirePermission("factures.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.montant, p.mode, p.date_paiement, p.reference, p.devise, p.cree_le,
              p.references_paiement, p.frais_retenus, p.frais_a_charge, p.montant_verse,
              COALESCE(p.montant_verse, p.montant) - p.frais_retenus AS montant_recu_net,
              p.depot_statut, p.date_depot, p.compte_id, cb.intitule AS compte_intitule,
              f.montant_ttc - SUM(p.montant) OVER (ORDER BY p.date_paiement, p.cree_le) AS reste_apres
       FROM paiements p JOIN factures f ON f.id = p.facture_id
       LEFT JOIN comptes_bancaires cb ON cb.id = p.compte_id
       WHERE p.facture_id = $1 ORDER BY p.date_paiement, p.cree_le`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /api/factures/:id/paiements/:paiementId — supprimer un paiement
// saisi par erreur (25/09/2026). Même palier que factures.annuler (même
// sensibilité : touche au statut d'une facture émise). Le statut de la
// facture est recalculé (payée → partielle/émise). Refusé si une
// rétrocession liée à cette facture a déjà été décaissée : la règle « tout
// ou rien » reposait sur cet encaissement. Tracé dans journal_audit.
router.delete("/:id/paiements/:paiementId", requirePermission("factures.annuler"), async (req, res) => {
  try {
    const { rows: [p] } = await pool.query(
      "SELECT id, montant, mode, date_paiement, reference FROM paiements WHERE id = $1 AND facture_id = $2",
      [req.params.paiementId, req.params.id]
    );
    if (!p) return res.status(404).json({ error: "Paiement introuvable" });
    const { rows: [issuDeFonds] } = await pool.query(
      "SELECT 1 FROM fonds_tiers_mouvements WHERE paiement_id = $1 AND statut = 'valide' LIMIT 1", [p.id]
    );
    if (issuDeFonds) {
      return res.status(409).json({ error: "Ce paiement provient d'une imputation sur les fonds de tiers (CARPA) : annulez l'imputation dans « Fonds de tiers »." });
    }
    const { rows: [retro] } = await pool.query(
      "SELECT 1 FROM retrocessions WHERE facture_id = $1 AND statut = 'decaissee' LIMIT 1", [req.params.id]
    );
    if (retro) {
      return res.status(409).json({ error: "Une rétrocession liée à cette facture a déjà été décaissée sur la base de cet encaissement — suppression refusée." });
    }
    await pool.query("DELETE FROM paiements WHERE id = $1", [p.id]);
    const statut = await majStatut(req.params.id);
    await logAudit({
      utilisateurId: req.user.sub, action: "supprimer_paiement", entite: "factures", entiteId: req.params.id,
      details: { paiement_id: p.id, montant: p.montant, mode: p.mode, date_paiement: p.date_paiement, reference: p.reference },
      ip: req.ip,
    });
    res.json({ facture_id: req.params.id, statut });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/factures/:id/pdf
// Support « papier numérique » d'une facture — générée à la volée depuis
// les données figées en base (voir facturePdf.js), pas persistée en GED.
router.get("/:id/pdf", requirePermission("factures.consulter"), async (req, res) => {
  try {
    const trouvee = await envoyerFacturePdf(pool, req.params.id, res);
    if (!trouvee) res.status(404).json({ error: "Facture introuvable" });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
module.exports.majStatut = majStatut;
