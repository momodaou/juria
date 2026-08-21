// JURIA — routes Dossiers
const express = require("express");
const { pool } = require("../db");
const { requirePermission, estAutorise } = require("../permissions");
const router = express.Router();

// Statut honoraires — pro bono uniquement (ajout 18/08/2026, seuil
// classique abandonné le même jour à la demande de l'utilisateur : plus
// aucune contrainte d'honoraires sur un dossier non pro bono). Comparaison
// faite en XOF via factures.montant_ttc_xof (déjà calculé pour toute
// devise à l'émission). NULL pour un dossier non pro bono — le frontend
// n'affiche alors simplement rien pour cette colonne.
const SELECT_HONORAIRES = `
  fh.cumul_xof,
  CASE WHEN NOT d.pro_bono THEN NULL
       WHEN fh.cumul_xof = 0 THEN 'sans_honoraires'
       WHEN fh.cumul_xof < p.frais_procedure_pro_bono_min_xof THEN 'sous_seuil'
       ELSE 'atteint'
  END AS statut_honoraires,
  (CASE WHEN d.pro_bono THEN p.frais_procedure_pro_bono_min_xof ELSE NULL END) AS honoraires_seuil_xof
`;
const JOIN_HONORAIRES = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(f.montant_ttc_xof), 0) AS cumul_xof
    FROM factures f WHERE f.dossier_id = d.id AND f.statut <> 'annulee'
  ) fh ON true
  CROSS JOIN parametres_cabinet p
`;

// Tables portant une donnée "réelle" sur un dossier — si l'une d'elles a au
// moins une ligne, la suppression est refusée (l'archivage devient la
// seule voie). Toutes ont ON DELETE CASCADE en base (documents, temps,
// evenements, taches, mais aussi dossier_parties/instances/clients
// additionnels) : sans ce contrôle applicatif, DELETE FROM dossiers
// effacerait silencieusement des pièces GED, du temps facturable, des
// audiences planifiées, etc.
// dossier_parties/instances/dossier_clients_additionnels ajoutées le
// 20/08/2026 (diagnostic utilisateur) : un dossier "à l'ouverture" avec
// déjà une partie/instance/client additionnel saisi pouvait jusqu'ici être
// supprimé sans avertissement, perdant silencieusement ces informations —
// pas de la même nature que documents/factures/etc., mais un travail de
// saisie réel tout de même.
const TABLES_ACTIVITE_DOSSIER = [
  "documents", "temps", "factures", "communications", "retrocessions", "evenements", "taches",
  "dossier_parties", "instances", "dossier_clients_additionnels",
];

// Référencement des dossiers (ajout 19/08/2026) — Guide de référencement
// des dossiers, JFC Avocats : [TYPE]-[MATIÈRE]-[ANNÉE]-[N° d'ordre], ex.
// CX-CIV-2026-0048. Compteur remis à 0001 chaque année, PAR type+matière
// (pas global) — le LIKE incluant l'année suffit à obtenir ce reset
// automatiquement d'une année sur l'autre.
const TYPE_CODE = { conseil: "CS", contentieux: "CX" };

async function genererNumero(pool, pole, codeMatiere) {
  const typeCode = TYPE_CODE[pole] || "CX";
  const annee = String(new Date().getFullYear());
  const { rows } = await pool.query(
    "SELECT count(*) + 1 AS n FROM dossiers WHERE numero LIKE $1",
    [`${typeCode}-${codeMatiere}-${annee}-%`]
  );
  return `${typeCode}-${codeMatiere}-${annee}-${String(rows[0].n).padStart(4, "0")}`;
}

// Couleur de chemise physique déduite de (matière, type) — Guide §6,
// déjà seedée dans codes_matiere.couleur.
async function couleurPour(pool, pole, codeMatiere) {
  const { rows } = await pool.query(
    "SELECT couleur FROM codes_matiere WHERE code = $1 AND type = $2::pole_cabinet",
    [codeMatiere, pole]
  );
  return rows[0] ? rows[0].couleur : null;
}

// GET /api/dossiers/meta/codes-matiere?pole=conseil|contentieux — référentiel
// des codes matière (Guide de référencement §3), pour les listes déroulantes
// de création/édition. Préfixé /meta/ pour ne jamais entrer en collision
// avec GET /:id (Express ferait autrement correspondre "/codes-matiere"
// à :id, ce préfixe l'évite quel que soit l'ordre d'enregistrement).
router.get("/meta/codes-matiere", async (req, res) => {
  const { pole } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT code, type, libelle, couleur FROM codes_matiere
       ${pole ? "WHERE type = $1::pole_cabinet" : ""}
       ORDER BY (code = 'IND'), (code = 'AUT'), libelle`,
      pole ? [pole] : []
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/dossiers?statut=&responsable=&q=&masquer_archives=
// masquer_archives (20/08/2026, diagnostic utilisateur) : ces filtres
// existaient déjà côté API mais n'étaient jamais exposés à l'écran — la
// liste mélangeait systématiquement dossiers actifs et archivés, sans
// colonne Statut ni vue "mes dossiers". `statut` et `masquer_archives`
// sont mutuellement exclusifs côté écran (l'un ou l'autre), tous deux
// combinables avec `responsable` (dont "mes dossiers" n'est qu'un cas
// particulier — le responsable connecté).
router.get("/", async (req, res) => {
  const { statut, responsable, q, masquer_archives } = req.query;
  const cond = [];
  const params = [];
  if (statut) { params.push(statut); cond.push(`d.statut = $${params.length}`); }
  else if (masquer_archives === "true") { cond.push(`d.statut <> 'archive'`); }
  if (responsable) { params.push(responsable); cond.push(`d.responsable_id = $${params.length}`); }
  if (q) { params.push(`%${q}%`); cond.push(`(d.intitule ILIKE $${params.length} OR d.numero ILIKE $${params.length})`); }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.numero, d.intitule, d.statut, d.phase, d.urgence, d.pro_bono,
              d.code_matiere, d.couleur_chemise,
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
    // Clients additionnels (18/08/2026) : un dossier peut désormais
    // comporter plusieurs identités clientes (personnes physiques ou
    // morales) en plus du client principal (dossiers.client_id, inchangé).
    const clientsAdditionnels = await pool.query(
      `SELECT c.id, COALESCE(c.denomination, c.prenom || ' ' || c.nom) AS nom, c.type
       FROM dossier_clients_additionnels dca JOIN clients c ON c.id = dca.client_id
       WHERE dca.dossier_id = $1`,
      [id]
    );
    // Instances (19/08/2026) : table déjà présente en base (degré/
    // juridiction/n° de rôle par degré — 1re instance, appel, cassation…)
    // mais jamais branchée à aucune route jusqu'ici.
    const instances = await pool.query(
      "SELECT id, degre, juridiction, numero_role, date_debut, decision FROM instances WHERE dossier_id = $1 ORDER BY date_debut NULLS LAST, cree_le",
      [id]
    );
    res.json({
      ...d.rows[0], parties: parties.rows, equipe: equipe.rows,
      clients_additionnels: clientsAdditionnels.rows, instances: instances.rows,
    });
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
    // Référencement automatique selon le Guide de référencement des
    // dossiers (JFC Avocats) si non fourni : [TYPE]-[MATIÈRE]-[ANNÉE]-[N°],
    // ex. CX-CIV-2026-0048. Sans matière choisie, IND ("chemise neutre à
    // qualifier") est le repli explicitement prévu par le guide — jamais
    // un prefix générique inventé comme c'était le cas jusqu'ici
    // ("AFF-AA-XXX", sans rapport avec le guide adopté).
    const codeMatiere = (b.code_matiere || "IND").toUpperCase();
    const numero = b.numero || await genererNumero(pool, b.pole, codeMatiere);
    const couleurChemise = await couleurPour(pool, b.pole, codeMatiere);

    const { rows } = await pool.query(
      `INSERT INTO dossiers
         (numero, intitule, client_id, pole, matiere, juridiction,
          montant_litige, mode_honoraires, urgence, responsable_id, pro_bono,
          objet, statut_procedure, statut_procedure_precision, intermediaire,
          code_matiere, couleur_chemise)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::urgence_niveau,'moyenne'),$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id, numero, intitule, pro_bono, code_matiere, couleur_chemise`,
      [numero, b.intitule, b.client_id, b.pole, b.matiere, b.juridiction,
       b.montant_litige, b.mode_honoraires, b.urgence, b.responsable_id, proBono,
       b.objet || null, b.statut_procedure || null, b.statut_procedure_precision || null, b.intermediaire || null,
       codeMatiere, couleurChemise]
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

    // Clients additionnels (18/08/2026) : un même dossier peut comporter
    // plusieurs identités clientes — b.clients_additionnels = tableau de
    // client_id existants, en plus du client principal ci-dessus.
    const clientsAdditionnels = Array.isArray(b.clients_additionnels) ? b.clients_additionnels.filter(Boolean) : [];
    for (const clientId of clientsAdditionnels) {
      await pool.query(
        "INSERT INTO dossier_clients_additionnels (dossier_id, client_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [rows[0].id, clientId]
      );
    }

    // Instance initiale (19/08/2026) : degré + juridiction choisis à
    // l'ouverture (pertinent surtout pour un dossier contentieux) —
    // branche pour la première fois la table `instances`, déjà en base
    // mais jusqu'ici jamais utilisée nulle part.
    if (b.instance_initiale && (b.instance_initiale.degre || b.instance_initiale.juridiction)) {
      await pool.query(
        `INSERT INTO instances (dossier_id, degre, juridiction, numero_role)
         VALUES ($1, COALESCE($2::degre_instance,'premiere_instance'), $3, $4)`,
        [rows[0].id, b.instance_initiale.degre || null, b.instance_initiale.juridiction || null,
         b.instance_initiale.numero_role || null]
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
// `client_id` (client principal) ajouté le 20/08/2026 — jusqu'ici le seul
// moyen de faire évoluer les identités clientes d'un dossier après sa
// création était les clients ADDITIONNELS (POST/DELETE /:id/clients), le
// client principal restait figé à sa valeur de création (gap signalé par
// l'utilisateur : nom de client saisissable/modifiable au formulaire de
// dossier partout, y compris en édition).
router.put("/:id", requirePermission("dossiers.modifier"), async (req, res) => {
  const b = req.body || {};
  try {
    // Archiver (statut='archive') exige en plus dossiers.archiver — un
    // droit d'édition générale ne doit pas suffire à clore un dossier.
    if (b.statut === "archive" && !(await estAutorise(req.user.role, "dossiers.archiver"))) {
      return res.status(403).json({ error: "Non autorisé à archiver un dossier" });
    }

    // Requalification depuis IND (Guide de référencement §3) : seul cas où
    // la référence, normalement stable et immuable (exigence explicite du
    // guide), est reconstruite — un dossier référencé provisoirement en
    // IND ("chemise neutre à qualifier") reçoit sa référence définitive
    // dès que sa matière réelle est connue. Tout autre changement de
    // matière laisse le numero inchangé.
    let numeroRegenere = null;
    let couleurRegeneree = null;
    if (b.code_matiere) {
      const actuel = await pool.query("SELECT code_matiere, pole FROM dossiers WHERE id = $1", [req.params.id]);
      if (!actuel.rows[0]) return res.status(404).json({ error: "Dossier introuvable" });
      const codeMatiere = b.code_matiere.toUpperCase();
      const pole = b.pole || actuel.rows[0].pole;
      if (actuel.rows[0].code_matiere === "IND" && codeMatiere !== "IND") {
        numeroRegenere = await genererNumero(pool, pole, codeMatiere);
      }
      couleurRegeneree = await couleurPour(pool, pole, codeMatiere);
    }

    const clauseConcurrence = b.maj_le_attendu != null
      ? "AND date_trunc('milliseconds', maj_le) = date_trunc('milliseconds', $21::timestamptz)"
      : "";
    const params = [b.intitule, b.pole, b.matiere, b.juridiction, b.montant_litige,
      b.mode_honoraires, b.urgence, b.responsable_id, b.phase, b.statut, b.objet, b.numero_role,
      b.statut_procedure, b.statut_procedure_precision, b.intermediaire,
      b.code_matiere ? b.code_matiere.toUpperCase() : null, couleurRegeneree, numeroRegenere,
      b.client_id || null,
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
         statut_procedure = COALESCE($13, statut_procedure),
         statut_procedure_precision = COALESCE($14, statut_procedure_precision),
         intermediaire = COALESCE($15, intermediaire),
         code_matiere = COALESCE($16, code_matiere),
         couleur_chemise = COALESCE($17, couleur_chemise),
         numero = COALESCE($18, numero),
         client_id = COALESCE($19, client_id),
         maj_le = now()
       WHERE id = $20 ${clauseConcurrence}
       RETURNING id, numero, intitule, statut, phase, code_matiere, couleur_chemise, client_id, maj_le`,
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

// DELETE /api/dossiers/:id — suppression volontairement limitée aux
// dossiers "à l'ouverture", sans activité réelle enregistrée. Un dossier
// clôturé se ferme par archivage (PUT statut='archive'), pas par
// suppression — voir TABLES_ACTIVITE_DOSSIER plus haut.
router.delete("/:id", requirePermission("dossiers.supprimer"), async (req, res) => {
  const id = req.params.id;
  try {
    const compteurs = await Promise.all(
      TABLES_ACTIVITE_DOSSIER.map((t) =>
        pool.query(`SELECT count(*) AS n FROM ${t} WHERE dossier_id = $1`, [id])
      )
    );
    const bloquants = TABLES_ACTIVITE_DOSSIER
      .map((t, i) => ({ table: t, n: Number(compteurs[i].rows[0].n) }))
      .filter((x) => x.n > 0);
    if (bloquants.length) {
      return res.status(409).json({
        error: `Suppression impossible : activité déjà enregistrée (${bloquants.map((x) => `${x.n} ${x.table}`).join(", ")}). Utilisez l'archivage à la place.`,
      });
    }
    const del = await pool.query("DELETE FROM dossiers WHERE id = $1 RETURNING id", [id]);
    if (!del.rows[0]) return res.status(404).json({ error: "Dossier introuvable" });
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST/DELETE /api/dossiers/:id/clients — clients additionnels (18/08/2026).
router.post("/:id/clients", requirePermission("dossiers.clients_additionnels.gerer"), async (req, res) => {
  const { client_id } = req.body || {};
  if (!client_id) return res.status(400).json({ error: "client_id requis" });
  try {
    await pool.query(
      "INSERT INTO dossier_clients_additionnels (dossier_id, client_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [req.params.id, client_id]
    );
    res.status(201).json({ dossier_id: req.params.id, client_id });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

router.delete("/:id/clients/:clientId", requirePermission("dossiers.clients_additionnels.gerer"), async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM dossier_clients_additionnels WHERE dossier_id = $1 AND client_id = $2",
      [req.params.id, req.params.clientId]
    );
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/dossiers/:id/instances — ajouter un degré (ex. passage en
// appel après une première instance). Table `instances` déjà en base
// (voir GET /:id) mais jamais utilisée avant ce jour.
router.post("/:id/instances", requirePermission("dossiers.instances.gerer"), async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await pool.query(
      `INSERT INTO instances (dossier_id, degre, juridiction, numero_role, date_debut)
       VALUES ($1, COALESCE($2::degre_instance,'premiere_instance'), $3, $4, $5)
       RETURNING id, degre, juridiction, numero_role, date_debut, decision`,
      [req.params.id, b.degre || null, b.juridiction || null, b.numero_role || null, b.date_debut || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/dossiers/:id/instances/:instanceId — compléter une instance au
// fil du temps (n° de rôle obtenu après coup, décision rendue…).
router.put("/:id/instances/:instanceId", requirePermission("dossiers.instances.gerer"), async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE instances SET
         juridiction = COALESCE($1, juridiction),
         numero_role = COALESCE($2, numero_role),
         date_debut = COALESCE($3, date_debut),
         decision = COALESCE($4, decision)
       WHERE id = $5 AND dossier_id = $6
       RETURNING id, degre, juridiction, numero_role, date_debut, decision`,
      [b.juridiction || null, b.numero_role || null, b.date_debut || null, b.decision || null,
       req.params.instanceId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Instance introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST/PUT/DELETE /api/dossiers/:id/parties — rectifier les parties adverses
// après la création (20/08/2026, demande utilisateur : gap signalé — seule
// l'ouverture (POST /) permettait jusqu'ici de les saisir, aucune route ne
// permettait de corriger une erreur de saisie ensuite). Même patron que
// les clients additionnels/instances ci-dessus. `dossier_parties` (déjà en
// base) n'est pas une fiche client — aucun champ KYC n'y est rattaché, ces
// routes ne touchent jamais la table `clients`/`client_pieces_kyc`.
router.post("/:id/parties", requirePermission("dossiers.parties.gerer"), async (req, res) => {
  const b = req.body || {};
  if (!b.denomination) return res.status(400).json({ error: "denomination requise" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO dossier_parties (dossier_id, role, denomination, conseil)
       VALUES ($1, COALESCE($2::role_partie,'adverse'), $3, $4)
       RETURNING id, role, denomination, conseil`,
      [req.params.id, b.role || null, b.denomination, b.conseil || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

router.put("/:id/parties/:partieId", requirePermission("dossiers.parties.gerer"), async (req, res) => {
  const b = req.body || {};
  try {
    // role ajouté le 20/08/2026 (diagnostic utilisateur) — jusqu'ici la
    // seule route de correction ne permettait de revoir que le nom/conseil,
    // pas de qualifier une partie autrement qu'« adverse » (rôle imposé à
    // la création). Cast explicite ::role_partie — motif de bug récurrent
    // du projet sur un COALESCE face à une colonne ENUM (voir CLAUDE.md).
    const { rows } = await pool.query(
      `UPDATE dossier_parties SET
         role = COALESCE($1::role_partie, role),
         denomination = COALESCE($2, denomination),
         conseil = COALESCE($3, conseil)
       WHERE id = $4 AND dossier_id = $5
       RETURNING id, role, denomination, conseil`,
      [b.role || null, b.denomination || null, b.conseil || null, req.params.partieId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Partie introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

router.delete("/:id/parties/:partieId", requirePermission("dossiers.parties.gerer"), async (req, res) => {
  try {
    await pool.query("DELETE FROM dossier_parties WHERE id = $1 AND dossier_id = $2", [req.params.partieId, req.params.id]);
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
