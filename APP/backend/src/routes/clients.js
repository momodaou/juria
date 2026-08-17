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
    params.push(`%${q}%`);
    clauses.push(
      `COALESCE(denomination,'') || ' ' || COALESCE(nom,'') || ' ' || COALESCE(prenom,'') ILIKE $${params.length}`
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

// GET /api/clients/:id — fiche 360° (KYC, dossiers, originaux confiés, liens)
router.get("/:id", async (req, res) => {
  try {
    const cli = await pool.query("SELECT * FROM clients WHERE id = $1", [req.params.id]);
    if (!cli.rows[0]) return res.status(404).json({ error: "Client introuvable" });

    const [pieces, dossiers, originaux, liens] = await Promise.all([
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
    ]);

    res.json({
      ...cli.rows[0],
      pieces_kyc: pieces.rows,
      dossiers: dossiers.rows,
      originaux_confies: originaux.rows,
      liens: liens.rows,
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
    if (req.file) {
      const dest = `kyc/${req.params.id}/${Date.now()}_${req.file.originalname}`.replace(/\s+/g, "_");
      chemin = await saveObject(req.file.buffer, dest, req.file.mimetype);
    }
    const { rows } = await pool.query(
      `INSERT INTO client_pieces_kyc (client_id, libelle, chemin_storage, date_expiration)
       VALUES ($1,$2,$3,$4)
       RETURNING id, libelle, date_expiration, cree_le`,
      [req.params.id, b.libelle, chemin, b.date_expiration || null]
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
      "SELECT libelle, chemin_storage FROM client_pieces_kyc WHERE id = $1 AND client_id = $2",
      [req.params.pieceId, req.params.id]
    );
    if (!rows[0] || !rows[0].chemin_storage) return res.status(404).json({ error: "Pièce introuvable" });
    const buf = await readObject(rows[0].chemin_storage);
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

module.exports = router;
