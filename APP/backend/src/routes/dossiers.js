// JURIA — routes Dossiers
const express = require("express");
const { pool } = require("../db");
const { requirePermission, estAutorise } = require("../permissions");
const router = express.Router();

// Statut honoraires (anti-dissimulation, ajout 18/08/2026) : un dossier
// pro bono a son propre plancher (frais de procédure minimum) ; un dossier
// classique a un plancher d'honoraires. Comparaison faite en XOF via
// factures.montant_ttc_xof (déjà calculé pour toute devise à l'émission —
// pas de reconversion à faire ici, couvre nativement le "ou son équivalent
// en devise" de la règle métier). Un abonnement (contrat-cadre) n'a pas de
// notion de seuil par dossier individuel dans le schéma actuel : exempté
// plutôt que mal évalué.
const SELECT_HONORAIRES = `
  fh.cumul_xof,
  CASE WHEN d.mode_honoraires = 'abonnement' THEN 'abonnement'
       WHEN fh.cumul_xof = 0 THEN 'sans_honoraires'
       WHEN fh.cumul_xof < (CASE WHEN d.pro_bono THEN p.frais_procedure_pro_bono_min_xof ELSE p.honoraires_min_xof END)
         THEN 'sous_seuil'
       ELSE 'atteint'
  END AS statut_honoraires,
  (CASE WHEN d.pro_bono THEN p.frais_procedure_pro_bono_min_xof ELSE p.honoraires_min_xof END) AS honoraires_seuil_xof
`;
const JOIN_HONORAIRES = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(f.montant_ttc_xof), 0) AS cumul_xof
    FROM factures f WHERE f.dossier_id = d.id AND f.statut <> 'annulee'
  ) fh ON true
  CROSS JOIN parametres_cabinet p
`;

// GET /api/dossiers?statut=&responsable=&q=
router.get("/", async (req, res) => {
  const { statut, responsable, q } = req.query;
  const cond = [];
  const params = [];
  if (statut) { params.push(statut); cond.push(`d.statut = $${params.length}`); }
  if (responsable) { params.push(responsable); cond.push(`d.responsable_id = $${params.length}`); }
  if (q) { params.push(`%${q}%`); cond.push(`(d.intitule ILIKE $${params.length} OR d.numero ILIKE $${params.length})`); }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.numero, d.intitule, d.statut, d.phase, d.urgence, d.pro_bono,
              d.client_id, COALESCE(c.denomination, c.prenom || ' ' || c.nom) AS client,
              u.prenom || ' ' || u.nom AS responsable,
              ${SELECT_HONORAIRES}
       FROM dossiers d
       JOIN clients c ON c.id = d.client_id
       JOIN utilisateurs u ON u.id = d.responsable_id
       ${JOIN_HONORAIRES}
       ${where}
       ORDER BY d.maj_le DESC
       LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/dossiers/:id  -> dossier enrichi (client, responsable, parties, équipe)
router.get("/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const d = await pool.query(
      `SELECT d.*,
              COALESCE(c.denomination, c.prenom || ' ' || c.nom) AS client_nom,
              u.prenom || ' ' || u.nom AS responsable_nom,
              ${SELECT_HONORAIRES}
       FROM dossiers d
       JOIN clients c ON c.id = d.client_id
       JOIN utilisateurs u ON u.id = d.responsable_id
       ${JOIN_HONORAIRES}
       WHERE d.id = $1`,
      [id]
    );
    if (!d.rows[0]) return res.status(404).json({ error: "Dossier introuvable" });

    const parties = await pool.query(
      "SELECT id, role, denomination, conseil FROM dossier_parties WHERE dossier_id = $1",
      [id]
    );
    const equipe = await pool.query(
      `SELECT u.prenom || ' ' || u.nom AS nom, di.role_dossier
       FROM dossier_intervenants di JOIN utilisateurs u ON u.id = di.utilisateur_id
       WHERE di.dossier_id = $1`,
      [id]
    );
    res.json({ ...d.rows[0], parties: parties.rows, equipe: equipe.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/dossiers/:id/evenements  -> délais & audiences du dossier
router.get("/:id/evenements", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, titre, date_echeance, statut,
              (date_echeance::date - current_date) AS jours_restants
       FROM evenements WHERE dossier_id = $1 ORDER BY date_echeance`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/dossiers/:id/documents  -> pièces (GED) du dossier
router.get("/:id/documents", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nom, categorie, version, statut, confidentialite, cree_le
       FROM documents WHERE dossier_id = $1 ORDER BY cree_le DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/dossiers
// pro_bono=true est un cas à part : exige la permission dédiée
// dossiers.pro_bono.declarer (pas dossiers.creer, ouverte à tous) et est
// bloqué au-delà du quota mensuel/responsable — sans ce blocage, marquer
// n'importe quel dossier "pro bono" deviendrait une échappatoire triviale
// au seuil d'honoraires classique.
router.post("/", requirePermission("dossiers.creer"), async (req, res) => {
  const b = req.body || {};
  const proBono = !!b.pro_bono;
  try {
    if (proBono) {
      if (!(await estAutorise(req.user.role, "dossiers.pro_bono.declarer"))) {
        return res.status(403).json({ error: "Non autorisé à déclarer un dossier pro bono" });
      }
      const { rows: [p] } = await pool.query(
        "SELECT quota_pro_bono_mensuel FROM parametres_cabinet WHERE id = 1"
      );
      const { rows: [c] } = await pool.query(
        `SELECT count(*) AS n FROM dossiers
         WHERE pro_bono AND responsable_id = $1
           AND date_trunc('month', date_ouverture) = date_trunc('month', current_date)`,
        [b.responsable_id]
      );
      if (Number(c.n) >= p.quota_pro_bono_mensuel) {
        return res.status(409).json({
          error: `Quota pro bono mensuel atteint pour ce responsable (${p.quota_pro_bono_mensuel}/mois)`,
        });
      }
    }
    // Référencement automatique (AFF-AA-XXX) si non fourni — même patron que
    // la numérotation des factures (factures.js). Jusqu'ici cette route
    // exigeait un numero fourni par l'appelant alors qu'aucun écran
    // frontend ne le générait, gap comblé en construisant le formulaire
    // d'ouverture (ouverture.component.ts).
    const yy = new Date().getFullYear().toString().slice(2);
    const cpt = await pool.query("SELECT count(*) + 1 AS n FROM dossiers WHERE numero LIKE $1", [`AFF-${yy}-%`]);
    const numero = b.numero || `AFF-${yy}-${String(cpt.rows[0].n).padStart(3, "0")}`;

    const { rows } = await pool.query(
      `INSERT INTO dossiers
         (numero, intitule, client_id, pole, matiere, juridiction,
          montant_litige, mode_honoraires, urgence, responsable_id, pro_bono)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::urgence_niveau,'moyenne'),$10,$11)
       RETURNING id, numero, intitule, pro_bono`,
      [numero, b.intitule, b.client_id, b.pole, b.matiere, b.juridiction,
       b.montant_litige, b.mode_honoraires, b.urgence, b.responsable_id, proBono]
    );

    // Parties adverses saisies au contrôle des conflits (étape 1 du
    // formulaire d'ouverture) : jusqu'ici aucune route ne les enregistrait
    // nulle part, elles disparaissaient après le contrôle — gap signalé
    // par l'utilisateur. b.parties_adverses = tableau de dénominations.
    const partiesAdverses = Array.isArray(b.parties_adverses) ? b.parties_adverses.filter(Boolean) : [];
    for (const denomination of partiesAdverses) {
      await pool.query(
        "INSERT INTO dossier_parties (dossier_id, role, denomination) VALUES ($1,'adverse',$2)",
        [rows[0].id, denomination]
      );
    }

    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/dossiers/:id — jusqu'ici AUCUNE route ne permettait de modifier
// un dossier après sa création (gap signalé par l'utilisateur : « on
// n'arrive pas à faire de modification une fois quelque chose validée »).
// Même patron de verrouillage optimiste que PUT /api/clients/:id
// (maj_le_attendu, troncage milliseconde des deux côtés) — cohérence
// demandée entre les deux écrans. `pro_bono` volontairement exclu : sa
// déclaration passe par sa propre logique (permission + quota) dans
// POST /, un PUT libre la contournerait.
router.put("/:id", requirePermission("dossiers.modifier"), async (req, res) => {
  const b = req.body || {};
  try {
    const clauseConcurrence = b.maj_le_attendu != null
      ? "AND date_trunc('milliseconds', maj_le) = date_trunc('milliseconds', $14::timestamptz)"
      : "";
    const params = [b.intitule, b.pole, b.matiere, b.juridiction, b.montant_litige,
      b.mode_honoraires, b.urgence, b.responsable_id, b.phase, b.statut, b.objet, b.numero_role,
      req.params.id];
    if (b.maj_le_attendu != null) params.push(b.maj_le_attendu);

    const { rows } = await pool.query(
      `UPDATE dossiers SET
         intitule = COALESCE($1, intitule),
         pole = COALESCE($2::pole_cabinet, pole),
         matiere = COALESCE($3, matiere),
         juridiction = COALESCE($4, juridiction),
         montant_litige = COALESCE($5, montant_litige),
         mode_honoraires = COALESCE($6::mode_honoraires, mode_honoraires),
         urgence = COALESCE($7::urgence_niveau, urgence),
         responsable_id = COALESCE($8, responsable_id),
         phase = COALESCE($9::phase_procedurale, phase),
         statut = COALESCE($10::statut_dossier, statut),
         objet = COALESCE($11, objet),
         numero_role = COALESCE($12, numero_role),
         maj_le = now()
       WHERE id = $13 ${clauseConcurrence}
       RETURNING id, numero, intitule, statut, phase, maj_le`,
      params
    );
    if (!rows[0]) {
      const existe = await pool.query("SELECT 1 FROM dossiers WHERE id = $1", [req.params.id]);
      if (!existe.rows[0]) return res.status(404).json({ error: "Dossier introuvable" });
      return res.status(409).json({ error: "Ce dossier a été modifié entre-temps par quelqu'un d'autre — rechargez avant de réessayer." });
    }
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
