// JURIA — Rôle d'audience : agenda hebdomadaire, diffusion à l'équipe,
// planning des diligences, retours d'audience (renvoi -> rôle de la semaine suivante).
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const router = express.Router();

// Lundi de la semaine contenant la date donnée (chaîne YYYY-MM-DD).
function lundiDeSemaine(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const jour = d.getUTCDay(); // 0 = dimanche
  const decalage = jour === 0 ? -6 : 1 - jour;
  d.setUTCDate(d.getUTCDate() + decalage);
  return d.toISOString().slice(0, 10);
}

async function trouverOuCreerRole(client, semaineDebut, creePar) {
  const existe = await client.query("SELECT * FROM roles_audience WHERE semaine_debut = $1", [semaineDebut]);
  if (existe.rows[0]) return existe.rows[0];
  const fin = new Date(semaineDebut + "T00:00:00Z");
  fin.setUTCDate(fin.getUTCDate() + 6);
  const cree = await client.query(
    `INSERT INTO roles_audience (semaine_debut, semaine_fin, cree_par) VALUES ($1,$2,$3) RETURNING *`,
    [semaineDebut, fin.toISOString().slice(0, 10), creePar]
  );
  return cree.rows[0];
}

// GET /api/roles-audience?semaine=YYYY-MM-DD — rôle de la semaine (par défaut : semaine courante)
router.get("/", requirePermission("audiences.consulter"), async (req, res) => {
  const semaine = lundiDeSemaine(req.query.semaine || new Date().toISOString().slice(0, 10));
  try {
    const role = await pool.query("SELECT * FROM roles_audience WHERE semaine_debut = $1", [semaine]);
    if (!role.rows[0]) return res.json({ semaine_debut: semaine, statut: null, lignes: [] });

    const lignes = await pool.query(
      `SELECT l.id, l.date_prevue, l.juridiction, l.type, d.numero AS dossier_numero,
              d.intitule AS dossier_intitule, d.id AS dossier_id,
              u.prenom || ' ' || u.nom AS avocat_nom,
              a.id AS audience_id, a.heure, a.instructions, a.urgente,
              a.resultat, a.prochaine_date, a.observations,
              mr.libelle AS motif_renvoi
       FROM role_audience_lignes l
       JOIN dossiers d ON d.id = l.dossier_id
       LEFT JOIN utilisateurs u ON u.id = l.avocat_id
       LEFT JOIN audiences a ON a.id = l.audience_id
       LEFT JOIN motifs_renvoi mr ON mr.id = a.motif_renvoi_id
       WHERE l.role_id = $1
       ORDER BY l.date_prevue, l.juridiction`,
      [role.rows[0].id]
    );
    res.json({ ...role.rows[0], lignes: lignes.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/roles-audience/lignes
// { dossier_id, date_prevue, juridiction, type, avocat_id?, heure?, instructions?, urgente? }
router.post("/lignes", requirePermission("audiences.ligne.creer"), async (req, res) => {
  const b = req.body || {};
  if (!b.dossier_id || !b.date_prevue) return res.status(400).json({ error: "dossier_id et date_prevue requis" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const role = await trouverOuCreerRole(client, lundiDeSemaine(b.date_prevue), req.user.sub);
    const audience = await client.query(
      `INSERT INTO audiences
         (dossier_id, avocat_id, juridiction, date_audience, type, heure, instructions, urgente, cree_par)
       VALUES ($1,$2,$3,$4,COALESCE($5::type_audience,'mise_en_etat'),$6,$7,COALESCE($8,FALSE),$9) RETURNING id`,
      [b.dossier_id, b.avocat_id || null, b.juridiction || null, b.date_prevue, b.type,
       b.heure || null, b.instructions || null, b.urgente, req.user.sub]
    );
    const ligne = await client.query(
      `INSERT INTO role_audience_lignes (role_id, audience_id, dossier_id, date_prevue, juridiction, type, avocat_id)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6::type_audience,'mise_en_etat'),$7) RETURNING id`,
      [role.id, audience.rows[0].id, b.dossier_id, b.date_prevue, b.juridiction || null, b.type, b.avocat_id || null]
    );
    await client.query("COMMIT");
    res.status(201).json({ id: ligne.rows[0].id, role_id: role.id, audience_id: audience.rows[0].id });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// POST /api/roles-audience/:id/valider (associé/admin)
router.post("/:id/valider", requirePermission("audiences.role.valider"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE roles_audience SET statut = 'valide', valide_par = $1, valide_le = now()
       WHERE id = $2 AND statut = 'brouillon' RETURNING id, statut`,
      [req.user.sub, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Rôle introuvable ou déjà validé" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/roles-audience/:id/diffuser
router.post("/:id/diffuser", requirePermission("audiences.role.diffuser"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE roles_audience SET statut = 'diffuse', diffuse_le = now()
       WHERE id = $1 AND statut = 'valide' RETURNING id, statut, diffuse_le`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Le rôle doit être validé avant diffusion" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/roles-audience/motifs-renvoi
router.get("/motifs-renvoi", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, libelle FROM motifs_renvoi WHERE actif = TRUE ORDER BY libelle");
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/roles-audience/audiences/:id/retour
// body : { resultat, motif_renvoi_id?, prochaine_date?, observations? }
// Si prochaine_date est fourni, inscrit automatiquement l'audience suivante au rôle
// de la semaine correspondante (renvoi -> compilation du rôle N+1).
router.post("/audiences/:id/retour", requirePermission("audiences.retour.saisir"), async (req, res) => {
  const b = req.body || {};
  if (!b.resultat) return res.status(400).json({ error: "resultat requis" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const maj = await client.query(
      `UPDATE audiences SET resultat = $1, motif_renvoi_id = $2, prochaine_date = $3, observations = $4
       WHERE id = $5 RETURNING *`,
      [b.resultat, b.motif_renvoi_id || null, b.prochaine_date || null, b.observations || null, req.params.id]
    );
    if (!maj.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Audience introuvable" }); }
    const a = maj.rows[0];

    let prochaine = null;
    if (b.prochaine_date) {
      const role = await trouverOuCreerRole(client, lundiDeSemaine(b.prochaine_date), req.user.sub);
      const nouvelleAudience = await client.query(
        `INSERT INTO audiences (dossier_id, avocat_id, juridiction, date_audience, type, cree_par)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [a.dossier_id, a.avocat_id, a.juridiction, b.prochaine_date, a.type, req.user.sub]
      );
      const ligne = await client.query(
        `INSERT INTO role_audience_lignes (role_id, audience_id, dossier_id, date_prevue, juridiction, type, avocat_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [role.id, nouvelleAudience.rows[0].id, a.dossier_id, b.prochaine_date, a.juridiction, a.type, a.avocat_id]
      );
      prochaine = { role_id: role.id, ligne_id: ligne.rows[0].id, audience_id: nouvelleAudience.rows[0].id };
    }
    await client.query("COMMIT");
    res.json({ audience: a, prochaine_inscrite: prochaine });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

module.exports = router;
