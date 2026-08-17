// JURIA — Facturation & paiements
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const router = express.Router();

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

// GET /api/factures?statut=  |  GET /api/factures/impayees
router.get("/impayees", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.numero, f.montant_ttc, f.devise, f.statut, f.date_echeance,
              COALESCE(c.denomination, c.prenom || ' ' || c.nom) AS client,
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

router.get("/", async (req, res) => {
  const { statut, dossier_id, client_id } = req.query;
  const params = [];
  const clauses = [];
  if (statut) { params.push(statut); clauses.push(`f.statut = $${params.length}::statut_facture`); }
  if (dossier_id) { params.push(dossier_id); clauses.push(`f.dossier_id = $${params.length}`); }
  if (client_id) { params.push(client_id); clauses.push(`f.client_id = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.numero, f.mode, f.montant_ht, f.montant_ttc, f.devise,
              f.taux_applique, f.montant_ttc_xof, f.statut,
              f.date_emission, f.date_echeance,
              COALESCE(c.denomination, c.prenom || ' ' || c.nom) AS client,
              d.numero AS dossier_numero
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

// POST /api/factures
// { dossier_id?, client_id?, mode, montant_ht, devise?, taux_applique?,
//   taux_tva?, provision?, date_echeance? }
router.post("/", requirePermission("factures.creer"), async (req, res) => {
  const b = req.body || {};
  try {
    let clientId = b.client_id;
    if (!clientId && b.dossier_id) {
      const d = await pool.query("SELECT client_id FROM dossiers WHERE id = $1", [b.dossier_id]);
      clientId = d.rows[0] ? d.rows[0].client_id : null;
    }
    if (!clientId) return res.status(400).json({ error: "client_id ou dossier_id valide requis" });
    if (!b.mode) return res.status(400).json({ error: "mode d'honoraires requis" });

    const devise = (b.devise || "XOF").toUpperCase();
    const { taux, erreur } = await resoudreTauxChange(devise, b.taux_applique, req.user.sub);
    if (erreur) return res.status(400).json({ error: erreur });

    // TVA : 18 % par défaut pour un client localisé au Mali, 0 % par défaut
    // pour un client hors Mali (prestation hors territorialité) — ce sont
    // des VALEURS DE DÉPART, pas un avis fiscal, toujours écrasées si
    // b.taux_tva est fourni explicitement. À valider avec l'expert-comptable
    // du cabinet avant de s'y fier en production réelle.
    let tauxTva = b.taux_tva !== undefined ? Number(b.taux_tva) : null;
    if (tauxTva == null) {
      const cl = await pool.query("SELECT pays FROM clients WHERE id = $1", [clientId]);
      const pays = cl.rows[0] ? cl.rows[0].pays : null;
      tauxTva = !pays || pays === "Mali" ? 18 : 0;
    }

    const ht = Math.round(Number(b.montant_ht || 0));
    const tva = Math.round((ht * tauxTva) / 100);
    const ttc = ht + tva;
    const ttcXof = Math.round(ttc * taux);
    const libellePrincipal = ["xof", "devise"].includes(b.libelle_principal)
      ? b.libelle_principal
      : (devise === "XOF" ? "xof" : "devise");

    // Numérotation automatique : F-AA-XXX
    const yy = new Date().getFullYear().toString().slice(2);
    const c = await pool.query("SELECT count(*) + 1 AS n FROM factures WHERE numero LIKE $1", [`F-${yy}-%`]);
    const numero = b.numero || `F-${yy}-${String(c.rows[0].n).padStart(3, "0")}`;

    const { rows } = await pool.query(
      `INSERT INTO factures
         (numero, client_id, dossier_id, mode, montant_ht, taux_tva, montant_tva, montant_ttc,
          provision, devise, taux_applique, date_taux, taux_verrouille, montant_ttc_xof,
          libelle_principal, statut, date_emission, date_echeance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),$10,$11,current_date,TRUE,$12,
               $13,'emise',current_date,$14)
       RETURNING id, numero, montant_ht, montant_ttc, devise, taux_applique, montant_ttc_xof, statut`,
      [numero, clientId, b.dossier_id || null, b.mode, ht, tauxTva, tva, ttc, b.provision,
       devise, taux, ttcXof, libellePrincipal, b.date_echeance || null]
    );
    res.status(201).json(rows[0]);
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
  try {
    const f = await pool.query("SELECT devise, taux_applique FROM factures WHERE id = $1", [req.params.id]);
    if (!f.rows[0]) return res.status(404).json({ error: "Facture introuvable" });
    const montant = Math.round(Number(b.montant));
    const montantXof = Math.round(montant * Number(f.rows[0].taux_applique));
    await pool.query(
      `INSERT INTO paiements (facture_id, montant, mode, reference, devise, taux_applique, montant_xof)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.params.id, montant, b.mode, b.reference || null, f.rows[0].devise, f.rows[0].taux_applique, montantXof]
    );
    const statut = await majStatut(req.params.id);
    res.status(201).json({ facture_id: req.params.id, statut });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
