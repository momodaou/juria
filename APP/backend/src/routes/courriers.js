// JURIA — Registre du courrier (arrivée/départ), référencement automatique,
// et déclenchement d'événements/diligences/tâches à partir de la nature du courrier.
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const router = express.Router();

// Génère la référence ARR-2026-000123 / DEP-2026-000045 (par sens + année).
async function genererReference(client, sens, dateCourrier) {
  const prefixe = sens === "arrivee" ? "ARR" : "DEP";
  const annee = new Date(dateCourrier || Date.now()).getFullYear();
  const { rows } = await client.query(
    `SELECT COUNT(*) + 1 AS n FROM courriers
     WHERE sens = $1 AND EXTRACT(YEAR FROM date_courrier) = $2`,
    [sens, annee]
  );
  return `${prefixe}-${annee}-${String(rows[0].n).padStart(6, "0")}`;
}

// Applique les déclencheurs configurés (type_courrier -> événement/diligence/tâche suggéré).
async function appliquerDeclencheurs(client, courrier, utilisateurId) {
  if (!courrier.dossier_id) return null;
  const { rows } = await client.query(
    `SELECT * FROM declencheurs WHERE source_domaine = 'type_courrier' AND source_code = $1 AND actif = TRUE`,
    [courrier.type]
  );
  if (!rows[0]) return null;
  const decl = rows[0];
  const responsable = courrier.imputation_id || utilisateurId;

  if (decl.type_evenement === "diligence") {
    const dateDiligence = decl.delai_jours
      ? new Date(new Date(courrier.date_courrier).getTime() + decl.delai_jours * 86400000)
      : new Date(courrier.date_courrier);
    const ins = await client.query(
      `INSERT INTO diligences (type_diligence, dossier_id, membre_id, date_diligence, objet, courrier_id, cree_par)
       VALUES ('diligence',$1,$2,$3,$4,$5,$6) RETURNING id, objet, date_diligence`,
      [courrier.dossier_id, responsable, dateDiligence.toISOString().slice(0, 10), decl.libelle_suggere, courrier.id, utilisateurId]
    );
    return { type: "diligence", ...ins.rows[0] };
  }

  if (decl.delai_jours) {
    const typeMap = { audience: "audience", delai: "delai_procedure", echeance: "echeance_contractuelle" };
    const dateEcheance = new Date(new Date(courrier.date_courrier).getTime() + decl.delai_jours * 86400000);
    const ins = await client.query(
      `INSERT INTO evenements (dossier_id, type, titre, date_echeance, responsable_id, courrier_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, titre, date_echeance`,
      [courrier.dossier_id, typeMap[decl.type_evenement] || "depot", decl.libelle_suggere, dateEcheance, responsable, courrier.id]
    );
    return { type: "evenement", ...ins.rows[0] };
  }

  // Pas de délai calculable (ex. audience à date non fixée) -> tâche de suivi.
  const ins = await client.query(
    `INSERT INTO taches (dossier_id, titre, responsable_id, echeance, cree_par)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, titre, echeance`,
    [courrier.dossier_id, decl.libelle_suggere, responsable, courrier.date_courrier, utilisateurId]
  );
  return { type: "tache", ...ins.rows[0] };
}

// GET /api/courriers?sens=&dossier_id=&statut=&q=
router.get("/", requirePermission("courriers.consulter"), async (req, res) => {
  const { sens, dossier_id, statut, q } = req.query;
  const params = [];
  const clauses = [];
  if (sens) { params.push(sens); clauses.push(`c.sens = $${params.length}`); }
  if (dossier_id) { params.push(dossier_id); clauses.push(`c.dossier_id = $${params.length}`); }
  if (statut) { params.push(statut); clauses.push(`c.statut = $${params.length}`); }
  if (q) { params.push(`%${q}%`); clauses.push(`(c.correspondant ILIKE $${params.length} OR c.objet ILIKE $${params.length} OR c.reference ILIKE $${params.length})`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.reference, c.sens, c.type, c.date_courrier, c.correspondant, c.objet,
              c.support, c.statut, c.a_numeriser, c.numerise,
              d.numero AS dossier_numero, u.prenom || ' ' || u.nom AS impute_a
       FROM courriers c
       LEFT JOIN dossiers d ON d.id = c.dossier_id
       LEFT JOIN utilisateurs u ON u.id = c.imputation_id
       ${where}
       ORDER BY c.date_courrier DESC, c.cree_le DESC LIMIT 300`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/courriers/:id
router.get("/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, d.numero AS dossier_numero, u.prenom || ' ' || u.nom AS impute_a
       FROM courriers c
       LEFT JOIN dossiers d ON d.id = c.dossier_id
       LEFT JOIN utilisateurs u ON u.id = c.imputation_id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Courrier introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/courriers
// body : { sens, type, date_courrier?, acteur_type?, correspondant, objet?, dossier_id?, support?, imputation_id? }
router.post("/", requirePermission("courriers.creer"), async (req, res) => {
  const b = req.body || {};
  if (!b.sens || !b.type) return res.status(400).json({ error: "sens et type requis" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const dateCourrier = b.date_courrier || new Date().toISOString().slice(0, 10);
    const reference = await genererReference(client, b.sens, dateCourrier);
    const ins = await client.query(
      `INSERT INTO courriers
         (reference, sens, type, date_courrier, acteur_type, correspondant, objet,
          dossier_id, support, imputation_id, recu_par, cree_par,
          statut, a_numeriser)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::support_courrier,'papier'),$10::uuid,$11,$11,
               (CASE WHEN $12::uuid IS NOT NULL THEN 'impute' ELSE 'recu' END)::statut_courrier, $13)
       RETURNING *`,
      [reference, b.sens, b.type, dateCourrier, b.acteur_type || null, b.correspondant || null,
       b.objet || null, b.dossier_id || null, b.support, b.imputation_id || null, req.user.sub,
       b.imputation_id || null, b.support === "papier" || !b.support]
    );
    const courrier = ins.rows[0];
    const declenchement = await appliquerDeclencheurs(client, courrier, req.user.sub);
    await client.query("COMMIT");
    res.status(201).json({ ...courrier, declenchement });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// PUT /api/courriers/:id/statut  { statut, imputation_id? }
router.put("/:id/statut", requirePermission("courriers.statut.modifier"), async (req, res) => {
  const { statut, imputation_id } = req.body || {};
  const permis = ["recu", "impute", "en_traitement", "traite", "expedie"];
  if (!permis.includes(statut)) return res.status(400).json({ error: "Statut invalide" });
  const estImpute = statut === "impute";
  try {
    const { rows } = await pool.query(
      `UPDATE courriers SET
         statut = $1::statut_courrier,
         imputation_id = COALESCE($2, imputation_id),
         transmis_par = CASE WHEN $5 THEN $3 ELSE transmis_par END,
         transmis_le = CASE WHEN $5 THEN now() ELSE transmis_le END
       WHERE id = $4
       RETURNING id, statut, imputation_id`,
      [statut, imputation_id || null, req.user.sub, req.params.id, estImpute]
    );
    if (!rows[0]) return res.status(404).json({ error: "Courrier introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
