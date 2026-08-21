// JURIA — Clients & KYC
// Registre clients, fiche 360° (KYC, dossiers, originaux confiés, liens),
// suivi des pièces KYC/LBC-FT avec alertes d'expiration.
const express = require("express");
const multer = require("multer");
const { pool } = require("../db");
const { saveObject, readObject } = require("../storage");
const { filtreTypeFichier } = require("../uploadFilter");
const { requirePermission } = require("../permissions");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 Mo
  fileFilter: filtreTypeFichier,
});
const router = express.Router();

// GET /api/clients?q=&kyc=
router.get("/", async (req, res) => {
  const { q, kyc } = req.query;
  const params = [];
  const clauses = [];
  if (q) {
    // Élargi le 20/08/2026 (diagnostic utilisateur) : ne cherchait jusqu'ici
    // que dénomination/nom/prénom, alors que RCCM/NIF/email/téléphone sont
    // en pratique les identifiants utilisés pour retrouver un client KYC.
    params.push(`%${q}%`);
    clauses.push(
      `(COALESCE(denomination,'') || ' ' || COALESCE(nom,'') || ' ' || COALESCE(prenom,'') ILIKE $${params.length}
        OR rccm ILIKE $${params.length} OR nif ILIKE $${params.length}
        OR email ILIKE $${params.length} OR telephone ILIKE $${params.length})`
    );
  }
  if (kyc) {
    params.push(kyc);
    clauses.push(`kyc_statut = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.type, c.denomination, c.prenom, c.nom, c.rccm, c.nif, c.pays,
              c.kyc_statut, c.kyc_maj_le,
              (SELECT COUNT(*) FROM dossiers d WHERE d.client_id = c.id) AS nb_dossiers,
              (SELECT COUNT(*) FROM client_pieces_kyc p
                 WHERE p.client_id = c.id AND p.date_expiration IS NOT NULL
                   AND p.date_expiration < current_date) AS pieces_expirees
       FROM clients c ${where} ORDER BY c.maj_le DESC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/clients/kyc/alertes?jours=30 — pièces expirées ou expirant bientôt (toutes fiches)
router.get("/kyc/alertes", async (req, res) => {
  const jours = Number(req.query.jours) || 30;
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.libelle, p.date_expiration, c.id AS client_id,
              COALESCE(c.denomination, c.prenom || ' ' || c.nom) AS client_nom,
              (p.date_expiration - current_date) AS jours_restants
       FROM client_pieces_kyc p
       JOIN clients c ON c.id = p.client_id
       WHERE p.date_expiration IS NOT NULL
         AND p.date_expiration <= current_date + ($1 || ' days')::interval
       ORDER BY p.date_expiration ASC`,
      [jours]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/clients/verifier-doublon?type=&denomination=&prenom=&nom=&rccm=&nif=
// (20/08/2026, diagnostic utilisateur) — aucune contrainte d'unicité n'existe
// en base sur rccm/nif (deux clients peuvent légitimement partager un champ
// mal renseigné), donc la création elle-même (POST /) n'est PAS bloquée ici
// — seulement précédée d'un contrôle côté écran, sur le même principe que le
// contrôle de conflit à l'ouverture : on prévient, l'utilisateur décide.
// Sans ce contrôle, rien ne signalait qu'un client existait déjà (RCCM/NIF
// identique ou nom identique à l'espace/tiret près), fragmentant son
// historique entre deux fiches distinctes.
router.get("/verifier-doublon", async (req, res) => {
  const { type, denomination, prenom, nom, rccm, nif } = req.query;
  const nomComplet = (type === "physique" ? [prenom, nom].filter(Boolean).join(" ") : denomination || "").trim();
  const rccmT = (rccm || "").trim();
  const nifT = (nif || "").trim();
  if (!nomComplet && !rccmT && !nifT) return res.json([]);
  try {
    const clauses = [];
    const params = [];
    if (rccmT) { params.push(rccmT); clauses.push(`rccm ILIKE $${params.length}`); }
    if (nifT) { params.push(nifT); clauses.push(`nif ILIKE $${params.length}`); }
    if (nomComplet) {
      // Comparaison insensible à l'espace/tiret/point/virgule (21/08/2026 —
      // le contrôle existait depuis le 20/08 mais ne comparait en réalité
      // que la casse, malgré le commentaire ci-dessus qui promettait déjà
      // "à l'espace/tiret près" : « Bâtir SA » ne rapprochait pas « Bâtir-SA »).
      // Uniquement sur le nom — RCCM/NIF restent comparés tels quels
      // au-dessus, ces identifiants officiels ne devant pas être normalisés
      // (un espace/tiret peut y être significatif).
      params.push(nomComplet);
      clauses.push(
        `regexp_replace(lower(COALESCE(denomination, TRIM(COALESCE(prenom,'') || ' ' || COALESCE(nom,'')))), '[\\s\\-.,]', '', 'g')
           = regexp_replace(lower($${params.length}), '[\\s\\-.,]', '', 'g')`
      );
    }
    const { rows } = await pool.query(
      `SELECT id, type, denomination, prenom, nom, rccm, nif, pays
       FROM clients WHERE ${clauses.join(" OR ")} LIMIT 10`,
      params
    );
    const norm = (s) => (s || "").trim().toLowerCase();
    const normNom = (s) => norm(s).replace(/[\s\-.,]/g, "");
    const doublons = rows.map((c) => ({
      ...c,
      motifs: [
        rccmT && norm(c.rccm) === norm(rccmT) ? "RCCM identique" : null,
        nifT && norm(c.nif) === norm(nifT) ? "NIF identique" : null,
        nomComplet && normNom(c.denomination || `${c.prenom} ${c.nom}`) === normNom(nomComplet) ? "Nom identique" : null,
      ].filter(Boolean),
    }));
    res.json(doublons);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/clients/:id — fiche 360° (KYC, dossiers, originaux confiés, liens)
router.get("/:id", async (req, res) => {
  try {
    const cli = await pool.query("SELECT * FROM clients WHERE id = $1", [req.params.id]);
    if (!cli.rows[0]) return res.status(404).json({ error: "Client introuvable" });

    const [pieces, dossiers, originaux, liens, liensInverses] = await Promise.all([
      pool.query(
        `SELECT id, libelle, date_expiration, cree_le,
                (date_expiration IS NOT NULL AND date_expiration < current_date) AS expiree
         FROM client_pieces_kyc WHERE client_id = $1 ORDER BY cree_le DESC`,
        [req.params.id]
      ),
      pool.query(
        `SELECT id, numero, intitule, statut, phase, urgence
         FROM dossiers WHERE client_id = $1 ORDER BY date_ouverture DESC`,
        [req.params.id]
      ),
      pool.query(
        `SELECT id, type_piece, description, recu_le, emplacement, restitue, restitue_le
         FROM originaux_confies WHERE client_id = $1 ORDER BY recu_le DESC`,
        [req.params.id]
      ),
      pool.query(
        `SELECT l.id, l.nature, l.lie_a_id,
                COALESCE(c2.denomination, c2.prenom || ' ' || c2.nom) AS lie_a_nom
         FROM client_liens l JOIN clients c2 ON c2.id = l.lie_a_id
         WHERE l.client_id = $1`,
        [req.params.id]
      ),
      // Sens inverse (20/08/2026, diagnostic utilisateur) : un lien n'était
      // visible que du côté où il avait été saisi (l.client_id = ce client)
      // — si A a été déclaré "filiale de" B, la fiche de B ne montrait rien.
      // Même table, la relation "vue depuis l'autre bout" en résulte.
      pool.query(
        `SELECT l.id, l.nature, l.client_id AS lie_a_id,
                COALESCE(c2.denomination, c2.prenom || ' ' || c2.nom) AS lie_a_nom
         FROM client_liens l JOIN clients c2 ON c2.id = l.client_id
         WHERE l.lie_a_id = $1`,
        [req.params.id]
      ),
    ]);

    res.json({
      ...cli.rows[0],
      pieces_kyc: pieces.rows,
      dossiers: dossiers.rows,
      originaux_confies: originaux.rows,
      liens: liens.rows,
      liens_inverses: liensInverses.rows,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/clients
router.post("/", requirePermission("clients.creer"), async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await pool.query(
      `INSERT INTO clients
         (type, denomination, rccm, nif, forme_juridique, prenom, nom,
          nationalite, email, telephone, adresse, ville, pays, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13,'Mali'),$14)
       RETURNING id, type, denomination, nom`,
      [b.type, b.denomination, b.rccm, b.nif, b.forme_juridique, b.prenom, b.nom,
       b.nationalite, b.email, b.telephone, b.adresse, b.ville, b.pays, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/clients/:id — mise à jour des coordonnées + statut KYC
// b.maj_le_attendu (optionnel, valeur de clients.maj_le vue par le client au
// chargement de la fiche) active une détection de conflit optimiste : si la
// fiche a été modifiée par quelqu'un d'autre entre-temps, l'écriture est
// refusée (409) plutôt que d'écraser silencieusement ces changements — le
// motif COALESCE ci-dessous protège déjà les champs non envoyés contre une
// édition concurrente sur des champs DIFFÉRENTS, mais pas contre deux
// personnes modifiant le MÊME champ en même temps.
router.put("/:id", requirePermission("clients.modifier"), async (req, res) => {
  const b = req.body || {};
  try {
    // date_trunc('milliseconds', ...) des deux côtés : Postgres stocke
    // TIMESTAMPTZ à la microseconde, mais un aller-retour JSON/JS Date perd
    // cette précision (arrondi à la milliseconde) — sans ce troncage, une
    // comparaison d'égalité stricte échouerait presque toujours, y compris
    // pour une écriture parfaitement légitime juste après le chargement.
    const clauseConcurrence = b.maj_le_attendu != null
      ? "AND date_trunc('milliseconds', maj_le) = date_trunc('milliseconds', $17::timestamptz)"
      : "";
    const params = [b.denomination, b.rccm, b.nif, b.forme_juridique, b.prenom, b.nom,
      b.nationalite, b.email, b.telephone, b.adresse, b.ville, b.pays,
      b.beneficiaires_effectifs, b.notes, b.kyc_statut, req.params.id];
    if (b.maj_le_attendu != null) params.push(b.maj_le_attendu);

    const { rows } = await pool.query(
      `UPDATE clients SET
         denomination = COALESCE($1, denomination), rccm = COALESCE($2, rccm),
         nif = COALESCE($3, nif), forme_juridique = COALESCE($4, forme_juridique),
         prenom = COALESCE($5, prenom), nom = COALESCE($6, nom),
         nationalite = COALESCE($7, nationalite), email = COALESCE($8, email),
         telephone = COALESCE($9, telephone), adresse = COALESCE($10, adresse),
         ville = COALESCE($11, ville), pays = COALESCE($12, pays),
         beneficiaires_effectifs = COALESCE($13, beneficiaires_effectifs),
         notes = COALESCE($14, notes),
         kyc_statut = COALESCE($15, kyc_statut),
         kyc_maj_le = CASE WHEN $15 IS NOT NULL THEN current_date ELSE kyc_maj_le END,
         maj_le = now()
       WHERE id = $16 ${clauseConcurrence}
       RETURNING id, kyc_statut, kyc_maj_le, maj_le`,
      params
    );
    if (!rows[0]) {
      const existe = await pool.query("SELECT 1 FROM clients WHERE id = $1", [req.params.id]);
      if (!existe.rows[0]) return res.status(404).json({ error: "Client introuvable" });
      return res.status(409).json({ error: "Cette fiche a été modifiée entre-temps par quelqu'un d'autre — rechargez avant de réessayer." });
    }
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// GET /api/clients/:id/kyc-pieces
router.get("/:id/kyc-pieces", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, libelle, date_expiration, cree_le,
              (date_expiration IS NOT NULL AND date_expiration < current_date) AS expiree
       FROM client_pieces_kyc WHERE client_id = $1 ORDER BY cree_le DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/clients/:id/kyc-pieces  (multipart/form-data : fichier, libelle, date_expiration?)
router.post("/:id/kyc-pieces", requirePermission("clients.kyc_piece.ajouter"), upload.single("fichier"), async (req, res) => {
  const b = req.body || {};
  if (!b.libelle) return res.status(400).json({ error: "libelle requis (ex. « Passeport »)" });
  try {
    let chemin = null;
    // type_mime capturé depuis le 21/08/2026 (voir schema.sql) — permet un
    // aperçu fiable (Content-Type correct au téléchargement) ; les pièces
    // antérieures à cette migration resteront à NULL.
    let typeMime = null;
    if (req.file) {
      const dest = `kyc/${req.params.id}/${Date.now()}_${req.file.originalname}`.replace(/\s+/g, "_");
      chemin = await saveObject(req.file.buffer, dest, req.file.mimetype);
      typeMime = req.file.mimetype;
    }
    const { rows } = await pool.query(
      `INSERT INTO client_pieces_kyc (client_id, libelle, chemin_storage, date_expiration, type_mime)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, libelle, date_expiration, cree_le`,
      [req.params.id, b.libelle, chemin, b.date_expiration || null, typeMime]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// GET /api/clients/:id/kyc-pieces/:pieceId/download
router.get("/:id/kyc-pieces/:pieceId/download", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT libelle, chemin_storage, type_mime FROM client_pieces_kyc WHERE id = $1 AND client_id = $2",
      [req.params.pieceId, req.params.id]
    );
    if (!rows[0] || !rows[0].chemin_storage) return res.status(404).json({ error: "Pièce introuvable" });
    const buf = await readObject(rows[0].chemin_storage);
    res.setHeader("Content-Type", rows[0].type_mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${rows[0].libelle}"`);
    res.send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /api/clients/:id/kyc-pieces/:pieceId
router.delete("/:id/kyc-pieces/:pieceId", requirePermission("clients.kyc_piece.supprimer"), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM client_pieces_kyc WHERE id = $1 AND client_id = $2",
      [req.params.pieceId, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Pièce introuvable" });
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST/DELETE /api/clients/:id/liens — personnes/entités liées (bénéficiaires
// effectifs, filiales, dirigeants…) (20/08/2026, diagnostic utilisateur) :
// la table `client_liens` existait depuis le tout premier schéma et était
// déjà LUE par GET /:id (ci-dessus), mais aucune route ne permettait de
// jamais l'alimenter — fonctionnalité LBC-FT du module Clients & KYC
// entièrement inaccessible jusqu'ici. Gardée par `clients.modifier` (pas
// une nouvelle action dédiée) : relier un client à un autre fait partie de
// l'édition de sa fiche identité/KYC, même niveau que le statut KYC déjà
// modifiable sous ce même droit.
router.post("/:id/liens", requirePermission("clients.modifier"), async (req, res) => {
  const { lie_a_id, nature } = req.body || {};
  if (!lie_a_id || !nature) return res.status(400).json({ error: "lie_a_id et nature requis" });
  if (lie_a_id === req.params.id) return res.status(400).json({ error: "Un client ne peut pas être lié à lui-même" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO client_liens (client_id, lie_a_id, nature) VALUES ($1,$2,$3)
       RETURNING id, nature, lie_a_id`,
      [req.params.id, lie_a_id, nature]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

router.delete("/:id/liens/:lienId", requirePermission("clients.modifier"), async (req, res) => {
  try {
    // Un lien peut avoir été saisi depuis l'un ou l'autre bout (voir
    // liens_inverses de GET /:id) — on autorise sa suppression depuis les
    // deux fiches, pas seulement celle où il a été créé.
    const { rowCount } = await pool.query(
      "DELETE FROM client_liens WHERE id = $1 AND (client_id = $2 OR lie_a_id = $2)",
      [req.params.lienId, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Lien introuvable" });
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /api/clients/:id — suppression volontairement limitée à un client
// "à l'ouverture", sans activité réelle enregistrée (aucun dossier — déjà
// bloqué nativement par la contrainte FK dossiers.client_id — mais aussi
// aucune facture, pièce KYC, original confié, lien avec un autre client,
// ou rattachement comme client additionnel sur un dossier). Plusieurs de
// ces tables ont ON DELETE CASCADE en base (pièces KYC, liens) : sans ce
// contrôle applicatif, la suppression effacerait silencieusement des
// pièces KYC/LBC-FT réelles.
router.delete("/:id", requirePermission("clients.supprimer"), async (req, res) => {
  const id = req.params.id;
  try {
    const chk = await pool.query(
      `SELECT
         (SELECT count(*) FROM dossiers WHERE client_id = $1) AS dossiers,
         (SELECT count(*) FROM dossier_clients_additionnels WHERE client_id = $1) AS dossiers_additionnels,
         (SELECT count(*) FROM factures WHERE client_id = $1) AS factures,
         (SELECT count(*) FROM client_pieces_kyc WHERE client_id = $1) AS pieces_kyc,
         (SELECT count(*) FROM originaux_confies WHERE client_id = $1) AS originaux,
         (SELECT count(*) FROM client_liens WHERE client_id = $1 OR lie_a_id = $1) AS liens`,
      [id]
    );
    const c = chk.rows[0];
    const bloquants = Object.entries(c).filter(([, n]) => Number(n) > 0);
    if (bloquants.length) {
      return res.status(409).json({
        error: `Suppression impossible : activité déjà enregistrée (${bloquants.map(([k, n]) => `${n} ${k}`).join(", ")}).`,
      });
    }
    const del = await pool.query("DELETE FROM clients WHERE id = $1 RETURNING id", [id]);
    if (!del.rows[0]) return res.status(404).json({ error: "Client introuvable" });
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
