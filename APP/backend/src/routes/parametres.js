// JURIA — Paramètres du cabinet : seuil de frais pro bono + quota mensuel,
// identité du cabinet (en-tête facture) et comptes bancaires (RIB imprimé
// sur la facture).
//
// Historique (18/08/2026) : cette route couvrait aussi un seuil d'honoraires
// minimum pour les dossiers classiques (honoraires_min_xof, 150 000 FCFA) —
// abandonné explicitement par l'utilisateur le même jour (colonne
// supprimée en base). Le volet pro bono, distinct, est conservé.
//
// Ajout 28/08/2026 (facture PDF enrichie) : parametres_cabinet.raison_
// sociale/adresse/telephone/email/nif/rccm/compte_carpa/mentions_legales
// existaient depuis le premier schéma (utilisés par actes.js et
// facturePdf.js) mais n'avaient AUCUNE route d'écriture — seule la valeur
// par défaut ('JFC AVOCATS MALI') était présente, le reste à NULL, faute
// de mécanisme pour les saisir autrement qu'un import SQL manuel. Même
// constat pour comptes_bancaires (aucune route POST/PUT nulle part dans
// l'appli — seul un SELECT existait, dans depenses.js).
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const { validerCompte, TYPES_ACTIFS } = require("../comptesCabinet");
const router = express.Router();

// GET /api/parametres/honoraires — lecture ouverte à tout utilisateur
// authentifié : les seuils sont de toute façon visibles indirectement via
// le badge honoraires sur les dossiers pro bono.
router.get("/honoraires", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT frais_procedure_pro_bono_min_xof, quota_pro_bono_mensuel, seuil_alerte_vignettes, petite_caisse_plafond_depense
       FROM parametres_cabinet WHERE id = 1`
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /api/parametres/honoraires  { frais_procedure_pro_bono_min_xof?, quota_pro_bono_mensuel?, seuil_alerte_vignettes? }
// Réservé par la matrice de permissions (parametres.honoraires.modifier),
// pas un requireRole en dur : contrairement à la matrice elle-même, il n'y
// a pas de risque d'auto-verrouillage à faire dépendre ce réglage de la
// matrice qu'il ne contrôle pas. seuil_alerte_vignettes (08/10/2026)
// réutilise cette même route/permission plutôt qu'un nouveau concept de
// réglage dédié — c'est un seuil du même esprit que les deux autres.
router.put("/honoraires", requirePermission("parametres.honoraires.modifier"), async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE parametres_cabinet SET
         frais_procedure_pro_bono_min_xof = COALESCE($1, frais_procedure_pro_bono_min_xof),
         quota_pro_bono_mensuel = COALESCE($2, quota_pro_bono_mensuel),
         seuil_alerte_vignettes = COALESCE($3, seuil_alerte_vignettes),
         petite_caisse_plafond_depense = COALESCE($4, petite_caisse_plafond_depense)
       WHERE id = 1
       RETURNING frais_procedure_pro_bono_min_xof, quota_pro_bono_mensuel, seuil_alerte_vignettes, petite_caisse_plafond_depense`,
      [b.frais_procedure_pro_bono_min_xof ?? null, b.quota_pro_bono_mensuel ?? null, b.seuil_alerte_vignettes ?? null, b.petite_caisse_plafond_depense ?? null]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

const CHAMPS_CABINET = [
  "raison_sociale", "forme", "adresse", "telephone", "email",
  "nif", "rccm", "compte_carpa", "mentions_legales",
];

// GET /api/parametres/cabinet — identité complète du cabinet (en-tête de
// facture/acte). Lecture ouverte comme /honoraires : rien de confidentiel
// (adresse, NIF, RCCM du cabinet lui-même — déjà imprimés sur chaque
// document sortant).
router.get("/cabinet", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${CHAMPS_CABINET.join(", ")} FROM parametres_cabinet WHERE id = 1`
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /api/parametres/cabinet — mêmes champs, tous optionnels (COALESCE).
router.put("/cabinet", requirePermission("parametres.cabinet.modifier"), async (req, res) => {
  const b = req.body || {};
  const sets = CHAMPS_CABINET.map((c, i) => `${c} = COALESCE($${i + 1}, ${c})`);
  const params = CHAMPS_CABINET.map((c) => (b[c] !== undefined ? b[c] : null));
  try {
    const { rows } = await pool.query(
      `UPDATE parametres_cabinet SET ${sets.join(", ")} WHERE id = 1 RETURNING ${CHAMPS_CABINET.join(", ")}`,
      params
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// GET /api/parametres/comptes-bancaires — liste complète (actifs et
// inactifs) pour la gestion, RIB inclus. À distinguer de
// GET /api/depenses/comptes (liste allégée, actifs seulement, sans RIB —
// utilisée par les sélecteurs de règlement, ouverte à tout rôle).
router.get("/comptes-bancaires", requirePermission("parametres.cabinet.modifier"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, intitule, type, banque, numero, operateur, telephone, afficher_sur_factures, actif,
              code_banque, code_guichet, cle_rib, iban, bic
       FROM comptes_bancaires ORDER BY actif DESC, type, intitule`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/parametres/comptes-bancaires/verifier-doublon?intitule=&numero=
// (26/09/2026, audit doublons) — aucune contrainte n'empêche deux comptes
// identiques (même pas sur `numero`) ; signale sans jamais bloquer.
router.get("/comptes-bancaires/verifier-doublon", requirePermission("parametres.cabinet.modifier"), async (req, res) => {
  const { intitule, numero } = req.query;
  if (!intitule && !numero) return res.json([]);
  try {
    const clauses = [];
    const params = [];
    if (intitule) { params.push(intitule); clauses.push(`intitule ILIKE $${params.length}`); }
    if (numero) { params.push(numero); clauses.push(`(numero = $${params.length} OR telephone = $${params.length})`); }
    const { rows } = await pool.query(
      `SELECT id, intitule, banque, numero FROM comptes_bancaires WHERE ${clauses.join(" OR ")}`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/parametres/comptes-bancaires — deux familles (banque : fonctionnement
// ou CARPA ; mobile money), validées et normalisées par comptesCabinet.js.
router.post("/comptes-bancaires", requirePermission("parametres.cabinet.modifier"), async (req, res) => {
  const v = validerCompte(req.body || {});
  if (v.erreur) return res.status(400).json({ error: v.erreur });
  const c = v.valeurs;
  try {
    const { rows } = await pool.query(
      `INSERT INTO comptes_bancaires
         (intitule, type, banque, numero, operateur, telephone, afficher_sur_factures, code_banque, code_guichet, cle_rib, iban, bic)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [c.intitule, c.type, c.banque, c.numero, c.operateur, c.telephone, c.afficher_sur_factures,
       c.code_banque, c.code_guichet, c.cle_rib, c.iban, c.bic]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/parametres/comptes-bancaires/:id — modification complète d'un compte
// (validée comme à la création) ou simple bascule { actif } (désactivation
// plutôt que suppression : un compte déjà référencé ne doit pas disparaître).
// Les anciens types (espèces, virement étranger) ne sont plus modifiables.
router.put("/comptes-bancaires/:id", requirePermission("parametres.cabinet.modifier"), async (req, res) => {
  const b = req.body || {};
  try {
    const { rows: [existant] } = await pool.query("SELECT * FROM comptes_bancaires WHERE id = $1", [req.params.id]);
    if (!existant) return res.status(404).json({ error: "Compte introuvable" });
    const cles = Object.keys(b);
    if (cles.length && cles.every((k) => k === "actif")) {
      await pool.query("UPDATE comptes_bancaires SET actif = $1 WHERE id = $2", [!!b.actif, req.params.id]);
      return res.json({ id: req.params.id });
    }
    if (!TYPES_ACTIFS.includes(existant.type) && !TYPES_ACTIFS.includes(b.type)) {
      return res.status(400).json({ error: "Ancien type de compte : désactivez-le et créez un compte Banque ou Mobile money." });
    }
    const v = validerCompte({ ...existant, ...b });
    if (v.erreur) return res.status(400).json({ error: v.erreur });
    const c = v.valeurs;
    await pool.query(
      `UPDATE comptes_bancaires SET intitule=$1, type=$2, banque=$3, numero=$4, operateur=$5, telephone=$6,
         afficher_sur_factures=$7, code_banque=$8, code_guichet=$9, cle_rib=$10, iban=$11, bic=$12,
         actif = COALESCE($13::boolean, actif)
       WHERE id = $14`,
      [c.intitule, c.type, c.banque, c.numero, c.operateur, c.telephone, c.afficher_sur_factures,
       c.code_banque, c.code_guichet, c.cle_rib, c.iban, c.bic, b.actif ?? null, req.params.id]
    );
    res.json({ id: req.params.id });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/parametres/comptes-bancaires/:id (01/10/2026 — gap comblé,
// seule la désactivation existait) — suppression réelle possible
// uniquement si le compte n'est référencé nulle part (paiements, dépenses,
// factures réglées par virement) ; sinon 409, désactivation recommandée
// à la place (même garde-fou anti-perte de données que les suppressions
// de dossier/client).
router.delete("/comptes-bancaires/:id", requirePermission("parametres.cabinet.modifier"), async (req, res) => {
  const id = req.params.id;
  try {
    const refs = await pool.query(
      `SELECT
         (SELECT count(*) FROM paiements WHERE compte_id = $1) AS paiements,
         (SELECT count(*) FROM depenses WHERE compte_id = $1) AS depenses,
         (SELECT count(*) FROM factures WHERE compte_reglement_id = $1) AS factures`,
      [id]
    );
    const r = refs.rows[0];
    if (Number(r.paiements) > 0 || Number(r.depenses) > 0 || Number(r.factures) > 0) {
      return res.status(409).json({
        error: "Ce compte est déjà référencé (paiement, dépense ou facture) et ne peut pas être supprimé — désactivez-le à la place.",
      });
    }
    const { rows } = await pool.query("DELETE FROM comptes_bancaires WHERE id = $1 RETURNING id", [id]);
    if (!rows[0]) return res.status(404).json({ error: "Compte introuvable" });
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
