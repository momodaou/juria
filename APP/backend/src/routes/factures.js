// JURIA — Facturation & paiements
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const { envoyerFacturePdf } = require("../facturePdf");
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
router.get("/impayees", requirePermission("factures.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.numero, f.montant_ttc, f.devise, f.statut, f.date_echeance,
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

router.get("/", requirePermission("factures.consulter"), async (req, res) => {
  const { statut, dossier_id, client_id } = req.query;
  const params = [];
  const clauses = [];
  if (statut) { params.push(statut); clauses.push(`f.statut = $${params.length}::statut_facture`); }
  if (dossier_id) { params.push(dossier_id); clauses.push(`f.dossier_id = $${params.length}`); }
  if (client_id) { params.push(client_id); clauses.push(`f.client_id = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.numero, f.mode, f.montant_ht, f.montant_frais, f.montant_debours, f.montant_ttc, f.devise,
              f.taux_applique, f.montant_ttc_xof, f.statut,
              f.date_emission, f.date_echeance,
              COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client,
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
    const c = await client.query("SELECT count(*) + 1 AS n FROM factures WHERE numero LIKE $1", [`F-${yy}-%`]);
    const numero = b.numero || `F-${yy}-${String(c.rows[0].n).padStart(3, "0")}`;

    const { rows } = await client.query(
      `INSERT INTO factures
         (numero, client_id, dossier_id, mode, montant_ht, taux_tva, montant_tva, montant_ttc,
          provision, devise, taux_applique, date_taux, taux_verrouille, montant_ttc_xof,
          libelle_principal, montant_frais, montant_debours, statut, date_emission, date_echeance,
          mode_reglement, compte_reglement_id, mention)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),$10,$11,current_date,TRUE,$12,
               $13,$14,$15,'emise',current_date,$16,$17,$18,$19)
       RETURNING id, numero, montant_ht, montant_ttc, devise, taux_applique, montant_ttc_xof,
                 montant_frais, montant_debours, statut`,
      [numero, clientId, dossierId, b.mode, ht, tauxTva, tva, ttc, b.provision,
       devise, taux, ttcXof, libellePrincipal, frais, debours, b.date_echeance || null,
       b.mode_reglement || null, b.compte_reglement_id || null, b.mention || null]
    );

    if (tempsFactures.length) {
      await client.query("UPDATE temps SET facture_id = $1 WHERE id = ANY($2::uuid[])", [rows[0].id, tempsFactures]);
    }
    if (deboursFactures.length) {
      await client.query("UPDATE depenses SET facture_id = $1 WHERE id = ANY($2::uuid[])", [rows[0].id, deboursFactures]);
    }

    await client.query("COMMIT");
    res.status(201).json({
      ...rows[0],
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
    res.json(maj.rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
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
