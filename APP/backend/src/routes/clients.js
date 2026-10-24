// JURIA — Clients & KYC
// Registre clients, fiche 360° (KYC, dossiers, originaux confiés, liens),
// suivi des pièces KYC/LBC-FT avec alertes d'expiration.
const express = require("express");
const multer = require("multer");
const { pool } = require("../db");
const { saveObject, readObject, deleteObject, FichierIntrouvableError, enteteContentDisposition } = require("../storage");
const { filtreTypeFichier } = require("../uploadFilter");
const { requirePermission, estAutorise } = require("../permissions");
const { logAudit, diffChamps } = require("../audit");
const { deriverFormule } = require("../periodicite");
const { PERIODICITES_ABONNEMENT, JOIN_ABONNEMENT_FACTURE, SELECT_ABONNEMENT_BRUT, calculerStatutAbonnement } = require("../abonnements");

// Traçabilité "créé par"/"modifié par" (09/10/2026, question explicite de
// l'utilisateur, voir CLAUDE.md) : champs d'identité dont une erreur de
// saisie ou une substitution déguisée a un vrai enjeu KYC/LBC-FT — pas
// l'intégralité des colonnes modifiables (notes/bénéficiaires effectifs
// exclus, moins sensibles et plus sujets à de simples compléments
// d'information sans enjeu de traçabilité).
const CHAMPS_IDENTITE_CLIENT = [
  "denomination", "rccm", "nif", "forme_juridique", "prenom", "nom",
  "nationalite", "email", "telephone", "adresse", "ville", "pays", "kyc_statut",
];

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
              COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client_nom,
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
        `regexp_replace(lower(COALESCE(NULLIF(denomination, ''), TRIM(COALESCE(prenom,'') || ' ' || COALESCE(nom,'')))), '[\\s\\-.,]', '', 'g')
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

// GET /api/clients/meta/abonnements — registre des clients sous
// convention-cadre (09/10/2026, ancrage par CLIENT — remplace l'ancienne
// GET /api/dossiers/meta/abonnements du 05/10/2026, ancrée par erreur sur
// le dossier). Voir CLAUDE.md/HISTORY.md pour l'analyse complète
// (exemples réels BDM/Orabank : une facture périodique unique rémunère
// TOUS les dossiers du client). Même permission que le reste des données
// financières agrégées (factures.consulter), volontairement pas un
// nouveau menu/module : une section de l'écran Facturation. Préfixé
// /meta/ pour ne jamais entrer en collision avec GET /:id ci-dessous.
router.get("/meta/abonnements", async (req, res) => {
  if (!(await estAutorise(req.user.role, "factures.consulter", req.user.sub))) {
    return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT c.id AS client_id, c.abonnement_montant_convenu_xof AS montant_convenu_xof, c.maj_le,
              COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client,
              ${SELECT_ABONNEMENT_BRUT}
       FROM clients c
       ${JOIN_ABONNEMENT_FACTURE}
       WHERE c.abonnement_periodicite IS NOT NULL`
    );
    const aujourdHui = new Date().toISOString().slice(0, 10);
    const enrichies = rows.map((r) => ({ ...r, ...calculerStatutAbonnement(r, aujourdHui) }));
    enrichies.sort((a, b) => {
      // En retard d'abord, puis par prochaine échéance la plus proche.
      const ra = a.abonnement_statut === "en_retard" ? 0 : 1;
      const rb = b.abonnement_statut === "en_retard" ? 0 : 1;
      if (ra !== rb) return ra - rb;
      if (a.abonnement_prochaine_echeance && b.abonnement_prochaine_echeance) {
        return a.abonnement_prochaine_echeance < b.abonnement_prochaine_echeance ? -1 : 1;
      }
      return 0;
    });
    res.json(enrichies);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /api/clients/:id/abonnement — configure/corrige/retire la
// convention-cadre d'un client (09/10/2026). { abonnement_periodicite?,
// abonnement_prochaine_facturation?, montant_convenu? } — périodicité et
// date d'ancrage doivent être fournies ENSEMBLE (même règle que
// PUT /api/echeances-administratives/:id) ou toutes les deux omises pour
// RETIRER la convention (remet tout à NULL, y compris le montant convenu
// — sans convention active, ce montant n'a plus de sens). Gardée par
// clients.modifier (pas une nouvelle action dédiée) — configurer la
// convention d'un client fait partie de l'édition de sa fiche, même
// niveau que le statut KYC ou les liens déjà modifiables sous ce droit.
router.put("/:id/abonnement", requirePermission("clients.modifier"), async (req, res) => {
  const b = req.body || {};
  const periodicite = b.abonnement_periodicite || null;
  const prochaineFacturation = b.abonnement_prochaine_facturation || null;
  if ((periodicite == null) !== (prochaineFacturation == null)) {
    return res.status(400).json({ error: "abonnement_periodicite et abonnement_prochaine_facturation doivent être fournis ensemble (ou tous les deux omis pour retirer la convention)." });
  }
  if (periodicite != null && !PERIODICITES_ABONNEMENT.includes(periodicite)) {
    return res.status(400).json({ error: `Périodicité d'abonnement invalide (attendu : ${PERIODICITES_ABONNEMENT.join(", ")}).` });
  }
  try {
    let jourEcheance = null, moisEcheance = null;
    if (periodicite != null) {
      ({ jourEcheance, moisEcheance } = deriverFormule(prochaineFacturation, periodicite));
    }
    // ⚠️ $6 duplique $1 (periodicite) plutôt que de le réutiliser dans le
    // CASE WHEN ci-dessous — motif de bug déjà documenté sur ce projet
    // (CLAUDE.md) : un même paramètre réemployé dans un contexte non typé
    // (ici "$1 IS NULL" seul, sans colonne typée en face) fait échouer la
    // résolution de type Postgres ("could not determine data type of
    // parameter $1"), confirmé en testant cette route.
    const { rows } = await pool.query(
      `UPDATE clients SET
         abonnement_periodicite = $1,
         abonnement_jour_facturation = $2,
         abonnement_mois_facturation = $3,
         abonnement_montant_convenu_xof = CASE WHEN $6::varchar IS NULL THEN NULL ELSE COALESCE($4, abonnement_montant_convenu_xof) END,
         maj_le = now()
       WHERE id = $5
       RETURNING id, abonnement_periodicite, abonnement_jour_facturation, abonnement_mois_facturation, abonnement_montant_convenu_xof, maj_le`,
      [periodicite, jourEcheance, moisEcheance, b.montant_convenu ?? null, req.params.id, periodicite]
    );
    if (!rows[0]) return res.status(404).json({ error: "Client introuvable" });
    // 25/10/2026 — le mode « Abonnement » d'un dossier est DÉRIVÉ de son client
    // (resoudreModeHonorairesEffectif, dossiers.js) mais n'était appliqué qu'à la
    // création / modification du dossier : un dossier ouvert AVANT la convention
    // gardait son ancien mode (liste déroulante sans « Abonnement », fausses
    // alertes de facturation). Dès qu'une convention est configurée, les dossiers
    // déjà rattachés au client passent donc en « abonnement ». (Retirer la
    // convention ne rétablit pas l'ancien mode, qui n'est pas conservé.)
    let dossiersRattaches = 0;
    if (periodicite != null) {
      const maj = await pool.query(
        "UPDATE dossiers SET mode_honoraires = 'abonnement' WHERE client_id = $1 AND mode_honoraires IS DISTINCT FROM 'abonnement'",
        [req.params.id]
      );
      dossiersRattaches = maj.rowCount;
    }
    await logAudit({
      utilisateurId: req.user.sub, action: "modifier_abonnement_client", entite: "clients",
      entiteId: req.params.id, details: { abonnement_periodicite: periodicite, dossiers_rattaches: dossiersRattaches }, ip: req.ip,
    });
    res.json({ ...rows[0], dossiers_rattaches: dossiersRattaches });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// GET /api/clients/:id — fiche 360° (KYC, dossiers, originaux confiés, liens)
router.get("/:id", async (req, res) => {
  try {
    const cli = await pool.query(
      `SELECT c.*, cp.code AS cree_par_code, cp.prenom || ' ' || cp.nom AS cree_par_nom,
              abf.derniere_facture_le AS abonnement_derniere_facture_le
       FROM clients c
       LEFT JOIN utilisateurs cp ON cp.id = c.cree_par
       ${JOIN_ABONNEMENT_FACTURE}
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!cli.rows[0]) return res.status(404).json({ error: "Client introuvable" });
    // Convention-cadre / abonnement (09/10/2026, ancrage par client — voir
    // CLAUDE.md/HISTORY.md) : statut "à jour/en retard" dérivé, jamais
    // stocké, même mécanisme que GET /api/clients/meta/abonnements.
    Object.assign(cli.rows[0], calculerStatutAbonnement(cli.rows[0], new Date().toISOString().slice(0, 10)));

    // Traçabilité procédurale (09/10/2026, voir CLAUDE.md « Traçabilité
    // procédurale », même patron que GET /api/dossiers/:id) : dernière
    // modification de la fiche identité/KYC, visible par tout collaborateur
    // ayant accès à la fiche, pas seulement le cercle restreint d'Accès &
    // permissions.
    const derniereModif = await pool.query(
      `SELECT j.action, j.horodatage, u.code AS utilisateur_code, u.prenom || ' ' || u.nom AS utilisateur_nom
       FROM journal_audit j
       LEFT JOIN utilisateurs u ON u.id = j.utilisateur_id
       WHERE j.entite = 'clients' AND j.entite_id = $1
       ORDER BY j.horodatage DESC LIMIT 1`,
      [req.params.id]
    );

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
                COALESCE(NULLIF(c2.denomination, ''), c2.prenom || ' ' || c2.nom) AS lie_a_nom
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
                COALESCE(NULLIF(c2.denomination, ''), c2.prenom || ' ' || c2.nom) AS lie_a_nom
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
      derniere_modification: derniereModif.rows[0] || null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/clients
router.post("/", requirePermission("clients.creer"), async (req, res) => {
  const b = req.body || {};
  // Une dénomination vide ('') doit être stockée NULL, pas '' — sinon
  // COALESCE(denomination, prenom||' '||nom), utilisé partout où le nom
  // d'un client est affiché, s'arrête sur cette chaîne vide (COALESCE ne
  // saute que les NULL) et affiche un nom vide au lieu de basculer sur
  // prénom+nom pour une personne physique. Bug trouvé le 22/08/2026 (client
  // créé via ouverture.component.ts, qui envoie denomination:'' par défaut
  // même pour un type physique).
  const denomination = b.denomination === "" ? null : b.denomination;
  try {
    const { rows } = await pool.query(
      `INSERT INTO clients
         (type, denomination, rccm, nif, forme_juridique, prenom, nom,
          nationalite, email, telephone, adresse, ville, pays, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13,'Mali'),$14)
       RETURNING id, type, denomination, nom`,
      [b.type, denomination, b.rccm, b.nif, b.forme_juridique, b.prenom, b.nom,
       b.nationalite, b.email, b.telephone, b.adresse, b.ville, b.pays, req.user.sub]
    );
    // Traçabilité des doublons (12/10/2026) : `ignorer_doublon` n'est envoyé
    // par le frontend que sur le chemin "Créer quand même" (après qu'un
    // avertissement non bloquant de GET /verifier-doublon a déjà été
    // affiché) — permet de retrouver qui a décidé qu'un doublon signalé
    // n'en était pas un, sans jamais bloquer la création elle-même.
    if (b.ignorer_doublon) {
      await logAudit({
        utilisateurId: req.user.sub, action: "ignorer_doublon_client", entite: "clients",
        entiteId: rows[0].id, details: { type: b.type, denomination, nom: b.nom, prenom: b.prenom }, ip: req.ip,
      });
    }
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
    // Traçabilité procédurale (09/10/2026) : photo "avant" sur les champs
    // d'identité suivis (CHAMPS_IDENTITE_CLIENT), pour diffuser avant/après
    // après l'UPDATE.
    const { rows: [avant] } = await pool.query(
      `SELECT ${CHAMPS_IDENTITE_CLIENT.join(", ")} FROM clients WHERE id = $1`,
      [req.params.id]
    );
    if (!avant) return res.status(404).json({ error: "Client introuvable" });

    // date_trunc('milliseconds', ...) des deux côtés : Postgres stocke
    // TIMESTAMPTZ à la microseconde, mais un aller-retour JSON/JS Date perd
    // cette précision (arrondi à la milliseconde) — sans ce troncage, une
    // comparaison d'égalité stricte échouerait presque toujours, y compris
    // pour une écriture parfaitement légitime juste après le chargement.
    const clauseConcurrence = b.maj_le_attendu != null
      ? "AND date_trunc('milliseconds', maj_le) = date_trunc('milliseconds', $17::timestamptz)"
      : "";
    // Même normalisation qu'à la création (voir POST /) : '' -> NULL pour
    // que COALESCE(denomination, prenom||' '||nom) fonctionne à l'affichage.
    const denomination = b.denomination === "" ? null : b.denomination;
    const params = [denomination, b.rccm, b.nif, b.forme_juridique, b.prenom, b.nom,
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
       RETURNING id, kyc_statut, kyc_maj_le, maj_le,
                 denomination, rccm, nif, forme_juridique, prenom, nom,
                 nationalite, email, telephone, adresse, ville, pays`,
      params
    );
    if (!rows[0]) {
      const existe = await pool.query("SELECT 1 FROM clients WHERE id = $1", [req.params.id]);
      if (!existe.rows[0]) return res.status(404).json({ error: "Client introuvable" });
      return res.status(409).json({ error: "Cette fiche a été modifiée entre-temps par quelqu'un d'autre — rechargez avant de réessayer." });
    }
    const changements = diffChamps(avant, rows[0], CHAMPS_IDENTITE_CLIENT);
    if (Object.keys(changements).length) {
      await logAudit({
        utilisateurId: req.user.sub, action: "modifier_client", entite: "clients",
        entiteId: req.params.id, details: { changements }, ip: req.ip,
      });
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
    res.setHeader("Content-Disposition", enteteContentDisposition(rows[0].libelle));
    res.send(buf);
  } catch (e) {
    if (e instanceof FichierIntrouvableError) {
      return res.status(404).json({ error: "Fichier introuvable dans le stockage — probablement déposé avant le 21/08/2026 (perdu lors d'un redéploiement, cf. HISTORY.md) ; à retéléverser." });
    }
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /api/clients/:id/kyc-pieces/:pieceId
// Nettoie aussi l'objet physique du stockage (28/08/2026 — gap signalé par
// l'utilisateur juste après le même correctif sur documents.js : la ligne
// disparaissait mais le fichier restait orphelin dans le bucket/disque).
router.delete("/:id/kyc-pieces/:pieceId", requirePermission("clients.kyc_piece.supprimer"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      "DELETE FROM client_pieces_kyc WHERE id = $1 AND client_id = $2 RETURNING chemin_storage",
      [req.params.pieceId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Pièce introuvable" });
    await deleteObject(rows[0].chemin_storage);
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
// GET /api/clients/:id/liens/verifier-doublon?lie_a_id=&nature=
// (26/09/2026, audit doublons) — signale, sans jamais bloquer, un lien déjà
// enregistré entre ces deux clients avec la même nature.
router.get("/:id/liens/verifier-doublon", requirePermission("clients.modifier"), async (req, res) => {
  const { lie_a_id, nature } = req.query;
  if (!lie_a_id || !nature) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT id, nature FROM client_liens WHERE client_id = $1 AND lie_a_id = $2 AND nature = $3`,
      [req.params.id, lie_a_id, nature]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

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
    // Libellés français (09/10/2026, cohérent avec le même correctif sur
    // DELETE /api/dossiers/:id) — le message affichait jusqu'ici les clés
    // SQL brutes (ex. "1 pieces_kyc").
    const libelles = {
      dossiers: "dossier(s)", dossiers_additionnels: "dossier(s) où ce client est additionnel",
      factures: "facture(s)", pieces_kyc: "pièce(s) KYC", originaux: "original(aux) confié(s)",
      liens: "lien(s) avec un autre client",
    };
    const bloquants = Object.entries(c).filter(([, n]) => Number(n) > 0);
    if (bloquants.length) {
      return res.status(409).json({
        error: `Suppression impossible : ce client est déjà rattaché à ${bloquants.map(([k, n]) => `${n} ${libelles[k] || k}`).join(", ")}.`,
        blocages: bloquants.map(([k, n]) => ({ table: k, libelle: libelles[k] || k, n: Number(n) })),
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
