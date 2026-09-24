// JURIA — Rôle d'audience : agenda hebdomadaire, diffusion à l'équipe,
// planning des diligences, retours d'audience (renvoi -> rôle de la semaine suivante).
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const { SELECT_STATUT_FACTURATION, JOIN_STATUT_FACTURATION } = require("../facturationDiscipline");
const { SELECT_INSTANCE_ACTUELLE, JOIN_INSTANCE_ACTUELLE } = require("../instanceActuelle");
const { envoyerRolePdf } = require("../rolePdf");
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
    if (!role.rows[0]) {
      // 24/09/2026 — gap signalé par l'utilisateur (« l'en-tête ne délimite
      // pas la semaine, X au [rien] ») : sur une semaine encore vide (aucune
      // ligne `roles_audience` créée), cette réponse omettait `semaine_fin`
      // — calculée ici comme `trouverOuCreerRole()` le fait déjà pour une
      // semaine qui a une ligne (lundi + 6 jours).
      const fin = new Date(semaine + "T00:00:00Z");
      fin.setUTCDate(fin.getUTCDate() + 6);
      return res.json({ semaine_debut: semaine, semaine_fin: fin.toISOString().slice(0, 10), statut: null, lignes: [] });
    }

    const lignes = await pool.query(
      `SELECT l.id, l.date_prevue, l.juridiction, l.type, l.avocat_id, d.numero AS dossier_numero,
              d.intitule AS dossier_intitule, d.id AS dossier_id,
              u.prenom || ' ' || u.nom AS avocat_nom, u.code AS avocat_code,
              ur.prenom || ' ' || ur.nom AS responsable_dossier_nom, ur.code AS responsable_dossier_code,
              a.id AS audience_id, a.heure, a.instructions, a.urgente,
              a.resultat, a.prochaine_date, a.observations,
              a.nature_procedure, a.nature_precision,
              a.motif_renvoi_id, a.motif_renvoi_precision, mr.libelle AS motif_renvoi,
              a.dernier_motif_id, a.dernier_motif_precision, mrd.libelle AS motif_dernier_renvoi,
              suite.date_audience AS suite_date, suite.heure AS suite_heure,
              suite.juridiction AS suite_juridiction, suite.type AS suite_type,
              suite.instructions AS suite_instructions, sa.code AS suite_avocat_code,
              ${SELECT_STATUT_FACTURATION},
              ${SELECT_INSTANCE_ACTUELLE}
       FROM role_audience_lignes l
       JOIN dossiers d ON d.id = l.dossier_id
       LEFT JOIN utilisateurs u ON u.id = l.avocat_id
       LEFT JOIN utilisateurs ur ON ur.id = d.responsable_id
       LEFT JOIN audiences a ON a.id = l.audience_id
       LEFT JOIN motifs_renvoi mr ON mr.id = a.motif_renvoi_id
       LEFT JOIN motifs_renvoi mrd ON mrd.id = a.dernier_motif_id
       -- 24/09/2026 — « Suite programmée » (aperçu inline, gap signalé par
       -- l'utilisateur) : l'audience déjà chaînée par un retour (renvoi OU
       -- mise en délibéré avec date de prononcé) est jointe directement ici
       -- pour affichage sur place, sans changer de semaine.
       LEFT JOIN audiences suite ON suite.audience_prec_id = a.id
       LEFT JOIN utilisateurs sa ON sa.id = suite.avocat_id
       ${JOIN_STATUT_FACTURATION}
       ${JOIN_INSTANCE_ACTUELLE}
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
// { dossier_id, date_prevue, juridiction, type, avocat_id?, heure?, instructions?, urgente?,
//   nature_procedure?, nature_precision? }
router.post("/lignes", requirePermission("audiences.ligne.creer"), async (req, res) => {
  const b = req.body || {};
  if (!b.dossier_id || !b.date_prevue) return res.status(400).json({ error: "dossier_id et date_prevue requis" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const role = await trouverOuCreerRole(client, lundiDeSemaine(b.date_prevue), req.user.sub);
    const audience = await client.query(
      `INSERT INTO audiences
         (dossier_id, avocat_id, juridiction, date_audience, type, heure, instructions, urgente,
          nature_procedure, nature_precision, cree_par)
       VALUES ($1,$2,$3,$4,COALESCE($5::type_audience,'mise_en_etat'),$6,$7,COALESCE($8,FALSE),$9,$10,$11) RETURNING id`,
      [b.dossier_id, b.avocat_id || null, b.juridiction || null, b.date_prevue, b.type,
       b.heure || null, b.instructions || null, b.urgente,
       b.nature_procedure || null, b.nature_precision || null, req.user.sub]
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

// PUT /api/roles-audience/audiences/:id — comble un gap signalé par
// l'utilisateur (21/09/2026, « impossible de modifier les informations du
// rôle ou d'une audience à venir ») : jusqu'ici seules 3 actions existaient
// (créer une ligne, valider/diffuser le rôle, saisir un retour), aucune ne
// permettant de corriger une erreur de saisie (date, heure, juridiction,
// type, avocat) avant ou après la tenue de l'audience — /retour ne touche
// que le résultat, jamais ces champs.
// Ancrée sur `audiences.id` (pas `role_audience_lignes.id`) délibérément :
// c'est le seul identifiant déjà exposé par LES DEUX écrans qui affichent
// une audience — le Rôle d'audience (`a.id AS audience_id`) et le panneau
// lecture seule de la fiche dossier (`a.id`) — une seule route sert donc
// les deux interfaces sans dupliquer la logique, demande explicite de
// l'utilisateur (« les 2 possibilités à la fois »). Met à jour `audiences`
// (source de vérité) et sa `role_audience_lignes` liée (colonnes dupliquées
// pour l'affichage du rôle hebdomadaire) dans la même transaction, pour ne
// jamais les laisser diverger.
// body : { date_audience?, heure?, juridiction?, type?, avocat_id?,
//          instructions?, urgente?, nature_procedure?, nature_precision?,
//          dernier_motif_id? } — jamais resultat/motif_renvoi_id/
// prochaine_date/observations, qui restent le rôle exclusif de /retour.
// 23/09/2026 — "dernier_motif_id" (motif de renvoi reporté depuis
// l'audience précédente par /retour, affiché en lecture seule jusqu'ici)
// devient corrigeable : gap trouvé par l'utilisateur (aucun moyen de
// réparer un motif recopié à tort). Traité à part des autres champs, qui
// utilisent tous COALESCE($n, colonne) — un $n absent/NULL y signifie
// "ne pas toucher", ce qui empêche structurellement de jamais EFFACER une
// valeur existante. Ici on veut justement pouvoir la vider (motif faux ->
// aucun motif) : la clé doit donc être présente dans le corps pour être
// appliquée ($10::boolean = "la toucher"), valeur NULL possible.
// "dernier_motif_precision" (texte libre du motif "Autre (préciser)")
// suit le même déclencheur que "dernier_motif_id" -- un seul et même
// geste de correction, pas un champ à part qui pourrait diverger.
router.put("/audiences/:id", requirePermission("audiences.ligne.creer"), async (req, res) => {
  const b = req.body || {};
  const toucheMotif = Object.prototype.hasOwnProperty.call(b, "dernier_motif_id");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const maj = await client.query(
      `UPDATE audiences SET
         date_audience = COALESCE($1, date_audience),
         heure = COALESCE($2, heure),
         juridiction = COALESCE($3, juridiction),
         type = COALESCE($4::type_audience, type),
         avocat_id = COALESCE($5::uuid, avocat_id),
         instructions = COALESCE($6, instructions),
         urgente = COALESCE($7, urgente),
         nature_procedure = COALESCE($8, nature_procedure),
         nature_precision = COALESCE($9, nature_precision),
         dernier_motif_id = CASE WHEN $10::boolean THEN $11::uuid ELSE dernier_motif_id END,
         dernier_motif_precision = CASE WHEN $10::boolean THEN $13 ELSE dernier_motif_precision END
       WHERE id = $12 RETURNING *`,
      [b.date_audience || null, b.heure || null, b.juridiction || null, b.type || null,
       b.avocat_id || null, b.instructions || null, b.urgente ?? null,
       b.nature_procedure || null, b.nature_precision || null,
       toucheMotif, b.dernier_motif_id || null, req.params.id, b.dernier_motif_precision || null]
    );
    if (!maj.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Audience introuvable" }); }
    const a = maj.rows[0];
    await client.query(
      `UPDATE role_audience_lignes SET
         date_prevue = $1, juridiction = $2, type = $3::type_audience, avocat_id = $4
       WHERE audience_id = $5`,
      [a.date_audience, a.juridiction, a.type, a.avocat_id, a.id]
    );
    await client.query("COMMIT");
    res.json(a);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Crée OU DÉPLACE l'audience "suivante" chaînée à `audienceOriginale`
// (renvoi) sur `prochaineDate` — 24/09/2026, extrait de l'ancien corps de
// POST /retour pour être réutilisé par la correction (PUT /retour
// ci-dessous) sans jamais dupliquer l'audience suivante déjà créée : si
// elle existe (audience_prec_id = audienceOriginale.id), on la DÉPLACE
// (nouvelle date + rôle de la semaine cible, recréé si besoin) plutôt que
// d'en recréer une deuxième.
async function synchroniserProchaineAudience(client, audienceOriginale, prochaineDate, creePar) {
  const role = await trouverOuCreerRole(client, lundiDeSemaine(prochaineDate), creePar);
  const existante = await client.query(
    `SELECT a.id, l.id AS ligne_id FROM audiences a
     LEFT JOIN role_audience_lignes l ON l.audience_id = a.id
     WHERE a.audience_prec_id = $1`,
    [audienceOriginale.id]
  );
  if (existante.rows[0]) {
    const a2 = existante.rows[0];
    await client.query(`UPDATE audiences SET date_audience = $1 WHERE id = $2`, [prochaineDate, a2.id]);
    if (a2.ligne_id) {
      await client.query(
        `UPDATE role_audience_lignes SET role_id = $1, date_prevue = $2 WHERE id = $3`,
        [role.id, prochaineDate, a2.ligne_id]
      );
    } else {
      await client.query(
        `INSERT INTO role_audience_lignes (role_id, audience_id, dossier_id, date_prevue, juridiction, type, avocat_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [role.id, a2.id, audienceOriginale.dossier_id, prochaineDate, audienceOriginale.juridiction, audienceOriginale.type, audienceOriginale.avocat_id]
      );
    }
    return { role_id: role.id, ligne_id: a2.ligne_id, audience_id: a2.id, deplacee: true };
  }

  // 21/09/2026 — chaînage vers l'audience précédente (audience_prec_id) et
  // report de son motif de renvoi (dernier_motif_id) : colonnes prévues
  // au schéma depuis longtemps mais jamais câblées (aucune route ne les
  // lisait/écrivait) — permet d'afficher « pourquoi cette audience
  // existe » sans deviner par une jointure heuristique. La nature de la
  // procédure (nature_procedure/precision) est aussi reportée : même
  // affaire, même nature, d'un renvoi à l'autre. 23/09/2026 — idem pour
  // motif_renvoi_precision -> dernier_motif_precision (motif "Autre
  // (préciser)").
  const nouvelleAudience = await client.query(
    `INSERT INTO audiences
       (dossier_id, avocat_id, juridiction, date_audience, type,
        nature_procedure, nature_precision, audience_prec_id, dernier_motif_id,
        dernier_motif_precision, cree_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [audienceOriginale.dossier_id, audienceOriginale.avocat_id, audienceOriginale.juridiction, prochaineDate, audienceOriginale.type,
     audienceOriginale.nature_procedure, audienceOriginale.nature_precision, audienceOriginale.id, audienceOriginale.motif_renvoi_id,
     audienceOriginale.motif_renvoi_precision, creePar]
  );
  const ligne = await client.query(
    `INSERT INTO role_audience_lignes (role_id, audience_id, dossier_id, date_prevue, juridiction, type, avocat_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [role.id, nouvelleAudience.rows[0].id, audienceOriginale.dossier_id, prochaineDate, audienceOriginale.juridiction, audienceOriginale.type, audienceOriginale.avocat_id]
  );
  return { role_id: role.id, ligne_id: ligne.rows[0].id, audience_id: nouvelleAudience.rows[0].id, deplacee: false };
}

// POST /api/roles-audience/audiences/:id/retour — première saisie du
// retour uniquement (voir PUT ci-dessous pour corriger un retour déjà
// enregistré).
// 24/09/2026 — gap signalé par l'utilisateur (« aucune action ou
// constatation de report... de sorte à ce que les rôles des semaines qui
// suivent aient matérialisé ces informations ») : "prochaine_date" devient
// OBLIGATOIRE quand resultat = 'renvoi' — jusqu'ici facultative, rien
// n'empêchait d'enregistrer un renvoi sans reprogrammer l'audience
// suivante nulle part (ni rôle futur, ni fiche dossier), le dossier
// disparaissant alors silencieusement du suivi. Un second appel sur une
// audience déjà pourvue d'un retour est désormais refusé (409) — voir PUT
// /retour pour corriger (jusqu'ici un second POST était accepté et
// dupliquait l'audience suivante déjà créée, bug latent jamais rencontré
// faute d'UI de correction).
// body : { resultat, motif_renvoi_id?, motif_renvoi_precision?, prochaine_date?,
//          observations? }
// Si prochaine_date est fourni, inscrit automatiquement l'audience suivante au rôle
// de la semaine correspondante (renvoi -> compilation du rôle N+1).
router.post("/audiences/:id/retour", requirePermission("audiences.retour.saisir"), async (req, res) => {
  const b = req.body || {};
  if (!b.resultat) return res.status(400).json({ error: "resultat requis" });
  if (b.resultat === "renvoi" && !b.prochaine_date) {
    return res.status(400).json({ error: "La prochaine date est obligatoire pour un renvoi." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existante = await client.query("SELECT resultat FROM audiences WHERE id = $1", [req.params.id]);
    if (!existante.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Audience introuvable" }); }
    if (existante.rows[0].resultat) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Un retour est déjà saisi pour cette audience — utilisez la correction (« Modifier le retour »)." });
    }
    const maj = await client.query(
      `UPDATE audiences SET resultat = $1, motif_renvoi_id = $2, motif_renvoi_precision = $3,
         prochaine_date = $4, observations = $5
       WHERE id = $6 RETURNING *`,
      [b.resultat, b.motif_renvoi_id || null, b.motif_renvoi_precision || null,
       b.prochaine_date || null, b.observations || null, req.params.id]
    );
    const a = maj.rows[0];

    let prochaine = null;
    if (b.prochaine_date) {
      prochaine = await synchroniserProchaineAudience(client, a, b.prochaine_date, req.user.sub);
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

// PUT /api/roles-audience/audiences/:id/retour — corrige un retour déjà
// saisi (24/09/2026, demande explicite de l'utilisateur : « modifiable
// dans Audience du dossier et le Rôle d'audience à la fois » en cas
// d'erreur sur la date/le motif). Si la prochaine date change, l'audience
// déjà créée par le renvoi initial (chaînée via audience_prec_id) est
// DÉPLACÉE vers la nouvelle date/semaine par synchroniserProchaineAudience
// ci-dessus — jamais dupliquée.
// body : { resultat?, motif_renvoi_id?, motif_renvoi_precision?, prochaine_date?,
//          observations? } — tous facultatifs (COALESCE, ne touche que ce
// qui est fourni), sauf motif_renvoi_id/precision qui suivent le même
// déclencheur explicite que dans PUT /audiences/:id (un seul geste, une
// clé absente = "ne pas toucher", présente avec valeur vide = "effacer").
router.put("/audiences/:id/retour", requirePermission("audiences.retour.saisir"), async (req, res) => {
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existante = await client.query("SELECT resultat FROM audiences WHERE id = $1", [req.params.id]);
    if (!existante.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Audience introuvable" }); }
    if (!existante.rows[0].resultat) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Aucun retour encore saisi pour cette audience — utilisez d'abord « Saisir le retour »." });
    }
    const toucheMotif = Object.prototype.hasOwnProperty.call(b, "motif_renvoi_id");
    const maj = await client.query(
      `UPDATE audiences SET
         resultat = COALESCE($1::resultat_audience, resultat),
         motif_renvoi_id = CASE WHEN $2::boolean THEN $3::uuid ELSE motif_renvoi_id END,
         motif_renvoi_precision = CASE WHEN $2::boolean THEN $4 ELSE motif_renvoi_precision END,
         prochaine_date = COALESCE($5, prochaine_date),
         observations = COALESCE($6, observations)
       WHERE id = $7 RETURNING *`,
      [b.resultat || null, toucheMotif, b.motif_renvoi_id || null, b.motif_renvoi_precision || null,
       b.prochaine_date || null, b.observations || null, req.params.id]
    );
    const a = maj.rows[0];
    if (a.resultat === "renvoi" && !a.prochaine_date) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "La prochaine date est obligatoire pour un renvoi." });
    }

    let prochaine = null;
    if (b.prochaine_date) {
      prochaine = await synchroniserProchaineAudience(client, a, b.prochaine_date, req.user.sub);
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

// GET /api/roles-audience/:id/pdf
// 23/09/2026 — remplace l'impression HTML/navigateur (@page landscape,
// suggestion que Safari n'honore pas de façon fiable) par un vrai PDF
// généré côté serveur (voir rolePdf.js), orientation paysage garantie.
// ":id" est l'id de "roles_audience" (celui renvoyé par GET / dans
// "role.id"), pas une date — le front le connaît déjà (role().id).
router.get("/:id/pdf", requirePermission("audiences.consulter"), async (req, res) => {
  try {
    const trouve = await envoyerRolePdf(pool, req.params.id, res);
    if (!trouve) res.status(404).json({ error: "Rôle introuvable" });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
