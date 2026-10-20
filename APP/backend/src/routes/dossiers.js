// JURIA — routes Dossiers
const express = require("express");
const { pool } = require("../db");
const { requirePermission, estAutorise } = require("../permissions");
const { saveObject } = require("../storage");
// Réutilise le moteur de fusion de modèles de l'Atelier d'actes (13/09/2026)
// pour générer la lettre de mission automatiquement à l'ouverture — voir
// genererLettreMissionAuto() plus bas. Pas de dépendance circulaire :
// actes.js ne requiert pas dossiers.js.
const { construireContexte, applatirContexte, fusionner } = require("./actes");
const { SELECT_STATUT_FACTURATION, JOIN_STATUT_FACTURATION } = require("../facturationDiscipline");
const { SELECT_INSTANCE_ACTUELLE, JOIN_INSTANCE_ACTUELLE } = require("../instanceActuelle");
const { estDocumentVisible, chargerContexteDossier } = require("../confidentialiteDocuments");
const { logAudit, diffChamps } = require("../audit");
const { envoyerEmail } = require("../mailer");
const { deduireChemise } = require("../stockChemises");
const router = express.Router();

// Traçabilité procédurale (09/10/2026, voir CLAUDE.md) : champs dont une
// erreur de saisie peut avoir un impact réel sur une procédure (délai,
// qualification, responsable, juridiction…) — journalisés avec leur
// valeur avant/après, pas l'intégralité des colonnes modifiables.
const CHAMPS_PROCEDURAUX_DOSSIER = [
  "responsable_id", "statut", "phase", "statut_procedure", "statut_procedure_precision",
  "juridiction", "numero_role", "objet", "montant_litige", "montant_litige_sens",
  "mode_honoraires", "client_id",
];

// Discipline de facturation — Bloc A (18/09/2026, voir CLAUDE.md/HISTORY.md
// pour la synthèse de conception complète). Montant convenu réservé aux
// modes où un chiffre ferme a du sens à l'ouverture. 'abonnement' retiré
// le 09/10/2026 : le montant convenu d'une convention-cadre vit désormais
// sur `clients` (une seule somme pour tous les dossiers du client), plus
// sur chaque dossier individuellement — voir le chantier "ancrage par
// client" dans schema.sql/abonnements.js.
const MODES_MONTANT_CONVENU = ["forfait", "consultation"];

// Clients contractuels / abonnement — ancrage par CLIENT (09/10/2026,
// revu depuis le 05/10/2026, voir CLAUDE.md/HISTORY.md pour l'analyse
// complète demandée par l'utilisateur, exemples réels BDM/Orabank).
// Un dossier n'a plus SA PROPRE périodicité : `mode_honoraires` devient
// un indicateur ENTIÈREMENT DÉRIVÉ de l'état du CLIENT auquel il
// appartient — si ce client a une convention-cadre active
// (clients.abonnement_periodicite non nul), tout dossier qui lui est
// rattaché est automatiquement considéré "abonnement", sans jamais le
// choisir manuellement ; sinon ce mode reste inaccessible (il faut
// d'abord configurer la convention sur la fiche client). Retourne le
// mode effectif (string) ou lève une erreur avec .status.
async function resoudreModeHonorairesEffectif(clientId, modeDemande) {
  const { rows: [client] } = await pool.query(
    "SELECT abonnement_periodicite FROM clients WHERE id = $1",
    [clientId]
  );
  const clientSousConvention = !!(client && client.abonnement_periodicite);
  if (clientSousConvention) return "abonnement";
  if (modeDemande === "abonnement") {
    const e = new Error("Mode « Abonnement » réservé aux clients sous convention-cadre — configurez-la d'abord sur la fiche client.");
    e.status = 400;
    throw e;
  }
  return modeDemande;
}

// Génère automatiquement le brouillon de lettre de mission à l'ouverture
// (modèle 'lettre_mission' déjà seedé dans modeles_actes) et le lie au
// dossier. Exceptions actées avec l'utilisateur : abonnement (convention-
// cadre déjà signée en amont) et success fee quand le client est déjà
// sous convention active (même convention-cadre couvrant ce volet au
// résultat — vérifié directement sur `clients`, pas sur un dossier
// "sentinelle" depuis le 09/10/2026). Jamais bloquant : une erreur ici
// est journalisée mais n'empêche pas la création du dossier (principe
// directeur de la note de conception — la formalisation ne doit jamais
// retarder l'ouverture).
async function genererLettreMissionAuto(dossierId, modeHonoraires, clientId, auteurId) {
  if (modeHonoraires === "abonnement") return null;
  if (modeHonoraires === "success_fee") {
    const { rows: [client] } = await pool.query(
      `SELECT abonnement_periodicite FROM clients WHERE id = $1`,
      [clientId]
    );
    if (client && client.abonnement_periodicite) return null;
  }
  try {
    const { rows: [modele] } = await pool.query(
      "SELECT nom, categorie, corps FROM modeles_actes WHERE code = 'lettre_mission' AND actif = TRUE"
    );
    if (!modele) return null;
    const avocat = await pool.query("SELECT prenom || ' ' || nom AS nom FROM utilisateurs WHERE id = $1", [auteurId]);
    const ctx = await construireContexte(dossierId, avocat.rows[0]?.nom || "");
    if (!ctx) return null;
    const texte = fusionner(modele.corps, applatirContexte(ctx));
    const nom = `${modele.nom} — ${ctx.dossier.numero}`;
    const dest = `${dossierId}/${Date.now()}_${nom}.txt`.replace(/\s+/g, "_");
    const chemin = await saveObject(Buffer.from(texte, "utf-8"), dest, "text/plain");
    const { rows: [doc] } = await pool.query(
      `INSERT INTO documents (dossier_id, nom, categorie, statut, chemin_storage, type_mime, taille_octets, auteur_id, ocr_texte)
       VALUES ($1,$2,$3,'brouillon',$4,'text/plain',$5,$6,$7)
       RETURNING id`,
      [dossierId, nom, modele.categorie, chemin, Buffer.byteLength(texte, "utf-8"), auteurId, texte]
    );
    await pool.query("UPDATE dossiers SET lettre_mission_document_id = $1 WHERE id = $2", [doc.id, dossierId]);
    return doc.id;
  } catch (e) {
    console.error("Génération automatique de la lettre de mission échouée (non bloquant) :", e);
    return null;
  }
}

// Notification générale à la création d'un dossier (13/10/2026, demande
// explicite de l'utilisateur) — porte à la connaissance des associés
// CHAQUE dossier créé par quelqu'un d'autre qu'eux, par principe
// d'accountability (pas une autorisation, rien n'est bloqué). Volontairement
// par RÔLE directement (associe/associe_fondateur), pas par une permission
// du catalogue : il ne s'agit pas d'un droit qu'on pourrait vouloir retirer
// à un associé via la Matrice, mais de la notion même de qui dirige le
// cabinet. Hors chemin critique, même patron que genererLettreMissionAuto
// ci-dessus (try/catch interne, jamais bloquant).
// Administrateur général (13/10/2026, précision explicite de l'utilisateur
// après la 1ʳᵉ passe) : reçoit UNIQUEMENT cette notification générale de
// création — jamais les e-mails/décisions de conflits.js, qui restent
// réservés à conflits.decision (« pas les notif d'autorisation de
// création »). Motif donné : suivi transverse des dossiers créés non
// encore facturés (réclamations), rôle distinct de celui des associés —
// elle est donc notifiée de TOUT dossier créé par quelqu'un d'autre
// qu'elle-même, y compris par un associé (contrairement au volet associés
// ci-dessous, qui reste muet entre associés).
// ⚠️ Associé-fondateur SUSPENDU de ce volet (13/10/2026, demande explicite
// de l'utilisateur — « mettre les notif et autorisation ouvertes à
// associé fondateur (uniquement lui) pour l'instant en suspend. On verra
// après le déblocage »), motif externe à JURIA, non précisé. Ne reçoit
// donc plus cette notification (seul `associe` classique la reçoit) — ne
// PAS réactiver `associe_fondateur` ici sans demande explicite future.
// Le reste du comportement (associé classique silencieux entre pairs,
// admin_general toujours notifiée) est inchangé.
async function notifierAssociesNouveauDossier(dossierId, numero, intitule, createurId, createurRole) {
  const rolesDestinataires = [];
  if (!["associe", "associe_fondateur"].includes(createurRole)) {
    rolesDestinataires.push("associe");
  }
  if (createurRole !== "admin_general") {
    rolesDestinataires.push("admin_general");
  }
  if (!rolesDestinataires.length) return;
  try {
    const { rows: dests } = await pool.query(
      `SELECT email, prenom FROM utilisateurs WHERE actif = TRUE AND role = ANY($1::role_utilisateur[])`,
      [rolesDestinataires]
    );
    if (!dests.length) return;
    const { rows: [createur] } = await pool.query(
      "SELECT prenom, nom, code FROM utilisateurs WHERE id = $1", [createurId]
    );
    const nomCreateur = createur ? `${createur.prenom} ${createur.nom} (${createur.code})` : "un collaborateur";
    const base = process.env.FRONTEND_URL || "https://juria-web-552099340909.europe-west1.run.app";
    const lien = `${base}/dossiers/${dossierId}`;
    for (const d of dests) {
      await envoyerEmail({
        to: d.email,
        subject: `Nouveau dossier créé — ${numero}`,
        html: `<p>Bonjour ${d.prenom},</p>
               <p><strong>${nomCreateur}</strong> vient de créer le dossier
               <strong>${numero}</strong> — ${intitule}.</p>
               <p><a href="${lien}">Voir la fiche du dossier</a></p>`,
      });
    }
  } catch (e) {
    console.error("Notification de nouveau dossier échouée (non bloquant) :", e);
  }
}

// Responsable dossier réservé aux avocats (12/09/2026, demande explicite de
// l'utilisateur) : seul un statut d'avocat peut porter la responsabilité
// déontologique d'un dossier — un juriste ou un stagiaire non-avocat peut y
// travailler (voir dossier_intervenants plus bas) mais pas en être le
// responsable, quel que soit qui fait la désignation (même un associé ne
// peut plus désigner un juriste). Contrôle NON rétroactif — décision
// explicite : les dossiers déjà en base avec un responsable non-avocat
// (autorisé par l'ancienne règle, voir ci-dessous) restent tels quels
// jusqu'à leur prochaine modification, pas de correction forcée en masse.
const ROLES_AVOCAT = ["associe", "associe_fondateur", "of_counsel", "avocat_stagiaire", "collaborateur"];

async function verifierResponsableEstAvocat(poolOuClient, responsableId) {
  if (!responsableId) return null;
  const { rows: [resp] } = await poolOuClient.query("SELECT role FROM utilisateurs WHERE id = $1", [responsableId]);
  if (resp && !ROLES_AVOCAT.includes(resp.role)) {
    return "Le responsable d'un dossier doit être un avocat (Associé, Associé-fondateur, Of Counsel, Avocat stagiaire, Collaborateur). Un juriste ou un stagiaire non-avocat peut être ajouté comme intervenant sur le dossier, pas comme responsable.";
  }
  return null;
}

// Imputation d'un dossier à un profil d'avocat subordonné : réservée aux
// avocats associés (30/08/2026, précision explicite de l'utilisateur —
// « seul l'avocat associé peut imputer un dossier à un profil » — sur tout
// dossier, classique ou pro bono). Un collaborateur peut toujours CRÉER un
// dossier (dossiers.creer reste ouvert), mais ne peut pas se désigner —
// ni désigner un autre profil subordonné — comme responsable : ce choix
// doit venir d'un compte associé. Narrowé le 12/09/2026 (11→3 statuts,
// juriste/stagiaire retirés) : ces deux profils sont désormais interdits
// comme responsable pour TOUT appelant (voir verifierResponsableEstAvocat
// ci-dessus) — ce contrôle-ci ne concerne plus que les vrais statuts
// avocat subordonnés à un associé (Of Counsel/collaborateur/avocat
// stagiaire), pour lesquels le contrôle par appelant reste pertinent.
const PROFILS_SUBORDONNES = ["of_counsel", "collaborateur", "avocat_stagiaire"];

// Vérifie l'imputation du responsable proposé ; renvoie un message d'erreur
// (à répondre en 403) ou null si c'est autorisé. `poolOuClient` accepte
// aussi bien le pool que le client d'une transaction en cours.
async function verifierImputationResponsable(poolOuClient, responsableId, roleAppelant) {
  if (!responsableId) return null;
  const { rows: [resp] } = await poolOuClient.query("SELECT role FROM utilisateurs WHERE id = $1", [responsableId]);
  if (resp && PROFILS_SUBORDONNES.includes(resp.role) && !["associe", "associe_fondateur"].includes(roleAppelant)) {
    return "Seul un avocat associé peut attribuer un dossier à ce profil (Of Counsel, collaborateur, avocat stagiaire).";
  }
  return null;
}

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
// "audiences" ajoutée le 11/09/2026 : même ON DELETE CASCADE que
// documents/temps/evenements/taches (trouvé en construisant le panneau
// audiences de la fiche dossier ci-dessous), mais absente de cette liste
// jusqu'ici — un dossier avec de vraies audiences déjà tenues pouvait être
// supprimé sans avertissement, les perdant silencieusement comme les
// autres tables de cette liste étaient déjà protégées de le faire.
const TABLES_ACTIVITE_DOSSIER = [
  "documents", "temps", "factures", "communications", "retrocessions", "evenements", "taches",
  "dossier_parties", "instances", "dossier_clients_additionnels", "audiences",
];

// Libellés français des tables ci-dessus (09/10/2026, gap signalé par
// l'utilisateur : le message d'erreur de suppression affichait les noms de
// table bruts — « 2 dossier_parties, 1 instances » — illisibles pour un
// utilisateur final). Purement cosmétique, la logique de blocage ne change
// pas.
const LIBELLES_TABLES_ACTIVITE = {
  documents: "pièce(s) GED", temps: "entrée(s) de temps passé", factures: "facture(s)",
  communications: "communication(s)", retrocessions: "rétrocession(s)", evenements: "échéance(s)",
  taches: "tâche(s)", dossier_parties: "partie(s) au dossier", instances: "instance(s)",
  dossier_clients_additionnels: "client(s) additionnel(s)", audiences: "audience(s)",
};

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

// GET /api/dossiers/meta/abonnements — DÉPLACÉE le 09/10/2026 vers
// GET /api/clients/meta/abonnements (clients.js). L'ancrage par dossier
// est remplacé par un ancrage par client (voir abonnements.js/CLAUDE.md) —
// cette route n'aurait plus de sens ici.

// GET /api/dossiers?statut=&responsable=&q=&masquer_archives=
// masquer_archives (20/08/2026, diagnostic utilisateur) : ces filtres
// existaient déjà côté API mais n'étaient jamais exposés à l'écran — la
// liste mélangeait systématiquement dossiers actifs et archivés, sans
// colonne Statut ni vue "mes dossiers". `statut` et `masquer_archives`
// sont mutuellement exclusifs côté écran (l'un ou l'autre), tous deux
// combinables avec `responsable` (dont "mes dossiers" n'est qu'un cas
// particulier — le responsable connecté).
router.get("/", async (req, res) => {
  const { statut, responsable, q, masquer_archives, client_id } = req.query;
  const cond = [];
  const params = [];
  if (statut) { params.push(statut); cond.push(`d.statut = $${params.length}`); }
  else if (masquer_archives === "true") { cond.push(`d.statut <> 'archive'`); }
  if (responsable) { params.push(responsable); cond.push(`d.responsable_id = $${params.length}`); }
  if (q) { params.push(`%${q}%`); cond.push(`(d.intitule ILIKE $${params.length} OR d.numero ILIKE $${params.length})`); }
  // Filtre client_id ajouté le 06/09/2026 pour le lien "Voir tous les
  // dossiers de ce client" depuis la fiche client (navigation inter-modules).
  // ⚠️ Limitation connue : ne couvre que le client principal (dossiers.client_id),
  // pas les clients additionnels (dossier_clients_additionnels) — cohérent
  // avec le principal usage (fiche client → ses dossiers).
  if (client_id) { params.push(client_id); cond.push(`d.client_id = $${params.length}`); }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.numero, d.intitule, d.objet, d.statut, d.phase, d.urgence, d.pro_bono,
              d.code_matiere, d.couleur_chemise, d.date_ouverture,
              d.client_id, COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client,
              u.prenom || ' ' || u.nom AS responsable,
              ${SELECT_HONORAIRES},
              ${SELECT_STATUT_FACTURATION},
              ${SELECT_INSTANCE_ACTUELLE}
       FROM dossiers d
       JOIN clients c ON c.id = d.client_id
       JOIN utilisateurs u ON u.id = d.responsable_id
       ${JOIN_HONORAIRES}
       ${JOIN_STATUT_FACTURATION}
       ${JOIN_INSTANCE_ACTUELLE}
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

// GET /api/dossiers/verifier-doublon?client_id=&code_matiere=
// (09/10/2026, comble un gap de l'audit doublons du 26/09/2026 qui avait
// couvert parties/instances/clients/rôle d'audience/dépenses/rétrocessions
// mais jamais la création d'un dossier lui-même — découvert en pratique :
// CX-SOC-2026-0002/0003, même affaire ouverte deux fois pour le même
// client). Signale, sans jamais bloquer (même principe que
// clients.verifier-doublon) : resserré sur la même matière si elle est déjà
// choisie à l'écran, sinon tous les dossiers déjà ouverts pour ce client.
//
// 12/10/2026 — élargi : le contrôle d'origine ne comparait que le
// `client_id` exact, donc incapable de repérer le cas en réalité le plus
// piégeux — un même client déjà saisi DEUX FOIS en fiches distinctes (ex.
// « Cabinet CADET » dupliqué, trouvé et nettoyé le 01/10/2026), chacune
// avec son propre dossier. Rapproche désormais aussi par nom de client
// normalisé (même règle espace/tiret/casse que clients.verifier-doublon),
// pas seulement par `client_id` strict. `meme_client` distingue les deux
// cas pour que l'écran adapte son message (même client exact vs. nom très
// proche sur une fiche différente — à vérifier côté Clients & KYC).
router.get("/verifier-doublon", async (req, res) => {
  const { client_id, code_matiere } = req.query;
  if (!client_id) return res.json([]);
  try {
    const params = [client_id];
    let matiereClause = "";
    if (code_matiere) {
      params.push(code_matiere);
      matiereClause = ` AND d.code_matiere = $${params.length}`;
    }
    const { rows } = await pool.query(
      `WITH cible AS (
         SELECT regexp_replace(lower(COALESCE(NULLIF(denomination, ''), TRIM(COALESCE(prenom,'') || ' ' || COALESCE(nom,'')))), '[\\s\\-.,]', '', 'g') AS nom_norm
         FROM clients WHERE id = $1
       )
       SELECT d.id, d.numero, d.intitule, d.objet, d.statut, d.date_ouverture,
              (d.client_id = $1) AS meme_client,
              COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client_nom
       FROM dossiers d
       JOIN clients c ON c.id = d.client_id
       CROSS JOIN cible
       WHERE (
         d.client_id = $1
         OR (
           cible.nom_norm <> ''
           AND regexp_replace(lower(COALESCE(NULLIF(c.denomination, ''), TRIM(COALESCE(c.prenom,'') || ' ' || COALESCE(c.nom,'')))), '[\\s\\-.,]', '', 'g') = cible.nom_norm
         )
       )${matiereClause}
       ORDER BY d.date_ouverture DESC LIMIT 10`,
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
              COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client_nom,
              u.prenom || ' ' || u.nom AS responsable_nom,
              cp.code AS cree_par_code, cp.prenom || ' ' || cp.nom AS cree_par_nom,
              ${SELECT_HONORAIRES},
              ${SELECT_STATUT_FACTURATION}
       FROM dossiers d
       JOIN clients c ON c.id = d.client_id
       JOIN utilisateurs u ON u.id = d.responsable_id
       LEFT JOIN utilisateurs cp ON cp.id = d.cree_par
       ${JOIN_HONORAIRES}
       ${JOIN_STATUT_FACTURATION}
       WHERE d.id = $1`,
      [id]
    );
    if (!d.rows[0]) return res.status(404).json({ error: "Dossier introuvable" });
    // Clients contractuels / abonnement (09/10/2026) : le détail de la
    // convention (périodicité, dernière facture, prochaine échéance) ne
    // vit plus que sur la fiche CLIENT — ici, mode_honoraires='abonnement'
    // + client_id suffisent au frontend pour afficher un simple renvoi
    // vers la fiche client, voir CLAUDE.md/HISTORY.md.

    const parties = await pool.query(
      "SELECT id, role, denomination, conseil FROM dossier_parties WHERE dossier_id = $1",
      [id]
    );
    // Intervenants (12/09/2026, gap comblé) : la table existait depuis le
    // premier schéma, lue uniquement par facturePdf.js (« Dossier suivi
    // par ») via sa propre requête — jamais exposée à l'écran ni
    // modifiable. Distinct du responsable (dossiers.responsable_id,
    // réservé aux avocats) : un intervenant peut être n'importe quel
    // statut (juriste, stagiaire, autre avocat en soutien…), pluralité
    // libre.
    const intervenants = await pool.query(
      `SELECT u.id AS utilisateur_id, u.prenom || ' ' || u.nom AS nom, u.role AS statut, di.role_dossier
       FROM dossier_intervenants di JOIN utilisateurs u ON u.id = di.utilisateur_id
       WHERE di.dossier_id = $1
       ORDER BY u.prenom, u.nom`,
      [id]
    );
    // Clients additionnels (18/08/2026) : un dossier peut désormais
    // comporter plusieurs identités clientes (personnes physiques ou
    // morales) en plus du client principal (dossiers.client_id, inchangé).
    const clientsAdditionnels = await pool.query(
      `SELECT c.id, COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS nom, c.type
       FROM dossier_clients_additionnels dca JOIN clients c ON c.id = dca.client_id
       WHERE dca.dossier_id = $1`,
      [id]
    );
    // Instances (19/08/2026) : table déjà présente en base (degré/
    // juridiction/n° de rôle par degré — 1re instance, appel, cassation…)
    // mais jamais branchée à aucune route jusqu'ici.
    // v.numero_vignette (08/10/2026) : la vignette qui marque l'entrée en
    // procédure du cabinet sur CETTE instance, voir POST .../vignette
    // ci-dessous — au plus une par instance (contrainte d'unicité en base).
    const instances = await pool.query(
      `SELECT i.id, i.degre, i.juridiction, i.numero_role, i.date_debut, i.decision, i.statut_partie, i.statut_partie_precision,
              v.numero_vignette
       FROM instances i
       LEFT JOIN vignettes_plaidoirie v ON v.instance_id = i.id AND v.mouvement = 'utilisation'
       WHERE i.dossier_id = $1 ORDER BY i.date_debut NULLS LAST, i.cree_le`,
      [id]
    );
    // Discipline de facturation — Bloc A : le montant convenu avec le
    // client est confidentiel, visible seulement du cercle déjà réservé
    // aux données chiffrées (factures.consulter) et des personnes
    // effectivement affectées à CE dossier (responsable + intervenants) —
    // masqué pour tout autre profil consultant la fiche. Première règle
    // de ce type dans JURIA (jusqu'ici les permissions sont par rôle, pas
    // par affectation à un dossier précis).
    const affecte = d.rows[0].responsable_id === req.user.sub
      || intervenants.rows.some((i) => i.utilisateur_id === req.user.sub);
    const peutVoirMontant = affecte || (await estAutorise(req.user.role, "factures.consulter", req.user.sub));
    const dossier = { ...d.rows[0] };
    if (!peutVoirMontant) dossier.montant_convenu_xof = null;

    // Traçabilité procédurale (09/10/2026) : "dernière modification" visible
    // par tout collaborateur ayant accès à la fiche — pas seulement le
    // cercle restreint de l'Accès & permissions (/api/acces/audit) — pour
    // prévenir un mélange d'informations entre collaborateurs sur CE dossier,
    // pas seulement le constater après coup. Agrège les écritures touchant
    // le dossier lui-même ET ses sous-entités procédurales (instances,
    // parties, audiences, échéances) via details.dossier_id.
    const derniereModif = await pool.query(
      `SELECT j.action, j.entite, j.horodatage, u.code AS utilisateur_code,
              u.prenom || ' ' || u.nom AS utilisateur_nom
       FROM journal_audit j
       LEFT JOIN utilisateurs u ON u.id = j.utilisateur_id
       WHERE (j.entite = 'dossiers' AND j.entite_id = $1)
          OR (j.entite IN ('dossier_instances', 'dossier_parties', 'audiences', 'evenements')
              AND j.details->>'dossier_id' = $1::text)
       ORDER BY j.horodatage DESC LIMIT 1`,
      [id]
    );

    res.json({
      ...dossier, parties: parties.rows, intervenants: intervenants.rows,
      clients_additionnels: clientsAdditionnels.rows, instances: instances.rows,
      derniere_modification: derniereModif.rows[0] || null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /api/dossiers/:id/lettre-mission-retour  { retour_le? }
// Discipline de facturation — Bloc A : suivi du retour signé de la lettre
// de mission, purement informatif (n'entre dans aucun calcul, ne bloque
// jamais rien — cohérent avec le principe directeur de la note de
// conception). Version simple pour ce premier jet : action manuelle plutôt
// que branchée sur un type de courrier dédié du Registre du courrier (un
// raffinement possible plus tard, pas nécessaire pour que le suivi soit
// déjà utile). Réutilise la permission déjà existante courriers.creer,
// plutôt qu'un nouveau code de permission pour un geste aussi ponctuel.
router.put("/:id/lettre-mission-retour", requirePermission("courriers.creer"), async (req, res) => {
  const retourLe = req.body?.retour_le || new Date().toISOString().slice(0, 10);
  try {
    const { rows } = await pool.query(
      "UPDATE dossiers SET lettre_mission_retour_le = $1 WHERE id = $2 RETURNING id, lettre_mission_retour_le",
      [retourLe, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Dossier introuvable" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// GET /api/dossiers/:id/evenements  -> délais & audiences du dossier
router.get("/:id/evenements", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, precision, titre, date_echeance, statut, responsable_id,
              (date_echeance::date - current_date) AS jours_restants
       FROM evenements WHERE dossier_id = $1
       ORDER BY (statut = 'a_venir') DESC, date_echeance`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/dossiers/:id/connexes — dossiers partageant la même partie
// adverse (10/10/2026, demande explicite de l'utilisateur après discussion
// sur le traitement de 2 procédures liées — ex. saisie-revendication
// conservatoire + injonction de délivrer facturées séparément, donc
// restées 2 dossiers distincts malgré le lien juridique).
//
// ⚠️ « Même client » RETIRÉ le 13/10/2026 (constat utilisateur, dossier
// BDM : 7 dossiers affichés « connexes » entre eux alors que leurs parties
// adverses sont toutes différentes). Vérifié sur ce cas réel : BDM SA a 8
// dossiers indépendants, chacun déclenchait le panneau via `meme_client`
// seul — un signal beaucoup plus faible que ce que « connexe » suggère
// (être le même client ne veut pas dire que deux affaires sont liées
// juridiquement). Cette information existe déjà, à sa vraie place : la
// fiche client affiche « Voir N dossiers » (06-07/09/2026) — pas besoin de
// la dupliquer ici. Seule « même partie adverse » reste, le signal qui a
// motivé la fonctionnalité à l'origine.
//
// Calculé à la volée (pas de colonne/table à tenir à jour — aucune saisie
// supplémentaire à retenir, même philosophie que "Dossiers dormants"/
// "Doublons potentiels" ailleurs dans l'appli) ; normalisation espace/
// tiret/virgule insensible déjà utilisée pour les doublons/conflits de ce
// fichier et de clients.js — même limite assumée ailleurs : un
// rapprochement par nom, pas une identité garantie.
router.get("/:id/connexes", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `WITH noms_parties_dossier AS (
         SELECT DISTINCT regexp_replace(lower(denomination), '[\\s\\-.,]', '', 'g') AS nom
         FROM dossier_parties WHERE dossier_id = $1 AND denomination IS NOT NULL
       )
       SELECT d.id, d.numero, d.intitule, d.statut
       FROM dossiers d
       WHERE d.id <> $1
         AND EXISTS (
           SELECT 1 FROM dossier_parties dp
           WHERE dp.dossier_id = d.id AND dp.denomination IS NOT NULL
             AND regexp_replace(lower(dp.denomination), '[\\s\\-.,]', '', 'g') IN (SELECT nom FROM noms_parties_dossier)
         )
       ORDER BY d.numero
       LIMIT 50`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/dossiers/:id/audiences  -> historique des audiences du dossier
// (11/09/2026, gap comblé : la fiche dossier n'avait jusqu'ici aucune
// visibilité sur ses propres audiences, contrairement à documents/
// factures/temps/tâches/courriers — Rôle d'audience étant un agenda
// hebdomadaire, il ne peut pas être filtré par dossier comme les autres
// modules ; ce panneau en lecture seule sur la fiche dossier comble ce
// manque autrement).
router.get("/:id/audiences", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.date_audience, a.type, a.juridiction, a.heure, a.avocat_id, a.instructions,
              a.resultat, a.resultat_precision, a.urgente, a.prochaine_date, a.prochaine_heure, a.observations,
              a.decision_document_id, dd.nom AS decision_document_nom, dd.type_mime AS decision_document_mime,
              mr.libelle AS motif_renvoi, u.prenom || ' ' || u.nom AS avocat_nom
       FROM audiences a
       LEFT JOIN motifs_renvoi mr ON mr.id = a.motif_renvoi_id
       LEFT JOIN utilisateurs u ON u.id = a.avocat_id
       LEFT JOIN documents dd ON dd.id = a.decision_document_id
       WHERE a.dossier_id = $1
       ORDER BY a.date_audience DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/dossiers/:id/documents?vue=client  -> pièces (GED) du dossier
// `vue=client` : appelé par l'aperçu Portail client (« Documents partagés »)
// — seuls les documents au niveau de confidentialité par défaut ('dossier')
// y apparaissent, jamais 'interne'/'equipe'/'restreint' (28/09/2026, voir
// confidentialiteDocuments.js).
router.get("/:id/documents", async (req, res) => {
  const vueClient = req.query.vue === "client";
  try {
    const { rows } = await pool.query(
      `SELECT id, nom, categorie, version, statut, confidentialite, cree_le
       FROM documents WHERE dossier_id = $1 ORDER BY cree_le DESC`,
      [req.params.id]
    );
    const contexte = await chargerContexteDossier(pool, req.params.id);
    const visibles = rows.filter((d) => estDocumentVisible(d.confidentialite, contexte, req.user, vueClient));
    res.json(visibles);
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
//
// 30/08/2026 (précision de l'utilisateur) : un collaborateur peut SAISIR
// un dossier pro bono, mais uniquement sur instruction d'un associé —
// seuls les associés ont droit au pro bono (le quota est compté par
// responsable). Le système ne peut pas vérifier une instruction verbale ;
// la traduction retenue est de vérifier ce qui EST vérifiable : le
// responsable attribué à un dossier pro bono doit être un associé
// (associe/associe_fondateur), quel que soit le rôle de la personne qui
// soumet le formulaire. dossiers.pro_bono.declarer reste un premier
// filtre (qui a le droit de seulement tenter l'opération), la vérification
// du responsable est la garde qui compte vraiment.
router.post("/", requirePermission("dossiers.creer"), async (req, res) => {
  const b = req.body || {};
  const proBono = !!b.pro_bono;
  try {
    // Discipline de facturation — Bloc A : mode d'honoraires obligatoire
    // (aucune valeur par défaut silencieuse), sauf si le client est déjà
    // sous convention-cadre active — le mode devient alors "abonnement"
    // automatiquement (voir resoudreModeHonorairesEffectif, 09/10/2026).
    // « Autre » exige sa précision libre, montant convenu verrouillé aux
    // modes où il a du sens.
    let modeEffectif;
    try {
      modeEffectif = await resoudreModeHonorairesEffectif(b.client_id, b.mode_honoraires || null);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    if (!modeEffectif) {
      return res.status(400).json({ error: "Mode d'honoraires requis (choisir « Autre » et préciser si non déterminé à ce stade)." });
    }
    if (modeEffectif === "autre" && !b.mode_honoraires_precision?.trim()) {
      return res.status(400).json({ error: "Précision requise pour le mode d'honoraires « Autre »." });
    }
    if (b.montant_convenu != null && !MODES_MONTANT_CONVENU.includes(modeEffectif)) {
      return res.status(400).json({ error: "Montant convenu non applicable à ce mode d'honoraires (réservé à forfait/consultation)." });
    }

    const erreurAvocat = await verifierResponsableEstAvocat(pool, b.responsable_id);
    if (erreurAvocat) return res.status(400).json({ error: erreurAvocat });
    const erreurImputation = await verifierImputationResponsable(pool, b.responsable_id, req.user.role);
    if (erreurImputation) return res.status(403).json({ error: erreurImputation });

    if (proBono) {
      if (!(await estAutorise(req.user.role, "dossiers.pro_bono.declarer", req.user.sub))) {
        return res.status(403).json({ error: "Non autorisé à déclarer un dossier pro bono" });
      }
      const { rows: [resp] } = await pool.query("SELECT role FROM utilisateurs WHERE id = $1", [b.responsable_id]);
      if (!resp || !["associe", "associe_fondateur"].includes(resp.role)) {
        return res.status(400).json({ error: "Un dossier pro bono doit être attribué à un avocat associé (seuls les associés ont droit au pro bono)." });
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
          montant_litige, montant_litige_sens, montant_litige_sens_precision, mode_honoraires, urgence, responsable_id, pro_bono,
          objet, statut_procedure, statut_procedure_precision, intermediaire,
          code_matiere, couleur_chemise, date_ouverture_origine,
          mode_honoraires_precision, montant_convenu_xof, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::sens_montant_litige,'indetermine'),$9,$10,COALESCE($11::urgence_niveau,'moyenne'),$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING id, numero, intitule, pro_bono, code_matiere, couleur_chemise`,
      [numero, b.intitule, b.client_id, b.pole, b.matiere, b.juridiction,
       b.montant_litige, b.montant_litige_sens || null, b.montant_litige_sens_precision || null, modeEffectif, b.urgence, b.responsable_id, proBono,
       b.objet || null, b.statut_procedure || null, b.statut_procedure_precision || null, b.intermediaire || null,
       codeMatiere, couleurChemise, b.date_ouverture_origine || null,
       modeEffectif === "autre" ? b.mode_honoraires_precision.trim() : null,
       MODES_MONTANT_CONVENU.includes(modeEffectif) ? (b.montant_convenu ?? null) : null,
       req.user.sub]
    );

    // Stock de chemises (20/10/2026) : une chemise sort du stock à la création.
    await deduireChemise(pool, rows[0], req.user.sub);

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

    // Intervenant(s) (12/09/2026, alignement sur le patron déjà suivi par
    // parties_adverses/clients_additionnels ci-dessus — demande explicite
    // de l'utilisateur : la désignation à la création est tout aussi
    // légitime que la gestion après coup, pas l'un ou l'autre).
    // b.intervenants = tableau de {utilisateur_id, role_dossier?}.
    const intervenantsInitiaux = Array.isArray(b.intervenants) ? b.intervenants.filter((i) => i && i.utilisateur_id) : [];
    for (const it of intervenantsInitiaux) {
      await pool.query(
        `INSERT INTO dossier_intervenants (dossier_id, utilisateur_id, role_dossier)
         VALUES ($1,$2,COALESCE($3,'collaborateur')) ON CONFLICT DO NOTHING`,
        [rows[0].id, it.utilisateur_id, it.role_dossier || null]
      );
    }

    // Instance initiale (19/08/2026) : degré + juridiction choisis à
    // l'ouverture (pertinent surtout pour un dossier contentieux) —
    // branche pour la première fois la table `instances`, déjà en base
    // mais jusqu'ici jamais utilisée nulle part.
    if (b.instance_initiale && (b.instance_initiale.degre || b.instance_initiale.juridiction)) {
      await pool.query(
        `INSERT INTO instances (dossier_id, degre, juridiction, numero_role, statut_partie, statut_partie_precision)
         VALUES ($1, COALESCE($2::degre_instance,'premiere_instance'), $3, $4, $5::statut_partie_instance, $6)`,
        [rows[0].id, b.instance_initiale.degre || null, b.instance_initiale.juridiction || null,
         b.instance_initiale.numero_role || null, b.instance_initiale.statut_partie || null,
         b.instance_initiale.statut_partie_precision || null]
      );
    }

    // Lettre de mission automatique (Bloc A) — hors chemin critique :
    // exécutée après la création, son échec éventuel n'empêche jamais la
    // réponse 201 (le dossier existe déjà à ce stade).
    const lettreMissionId = await genererLettreMissionAuto(rows[0].id, modeEffectif, b.client_id, req.user.sub);
    await notifierAssociesNouveauDossier(rows[0].id, rows[0].numero, b.intitule, req.user.sub, req.user.role);

    // Traçabilité des doublons (12/10/2026) : `ignorer_doublon` n'est envoyé
    // par le frontend que sur le chemin "Créer quand même" (après qu'un
    // avertissement non bloquant de GET /verifier-doublon a déjà été
    // affiché) — même principe que routes/clients.js.
    if (b.ignorer_doublon) {
      await logAudit({
        utilisateurId: req.user.sub, action: "ignorer_doublon_dossier", entite: "dossiers",
        entiteId: rows[0].id, details: { client_id: b.client_id, code_matiere: codeMatiere }, ip: req.ip,
      });
    }

    res.status(201).json({ ...rows[0], lettre_mission_document_id: lettreMissionId });
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
    if (b.statut === "archive" && !(await estAutorise(req.user.role, "dossiers.archiver", req.user.sub))) {
      return res.status(403).json({ error: "Non autorisé à archiver un dossier" });
    }

    // Réattribution du responsable — même garde qu'à la création
    // (30/08/2026) : seul un associé peut imputer le dossier à un profil
    // subordonné. Un dossier pro bono va plus loin : le responsable doit
    // TOUJOURS être un associé, quel que soit l'appelant (règle déjà en
    // place à la création, étendue ici à la réattribution).
    if (b.responsable_id) {
      const erreurAvocat = await verifierResponsableEstAvocat(pool, b.responsable_id);
      if (erreurAvocat) return res.status(400).json({ error: erreurAvocat });
      const erreurImputation = await verifierImputationResponsable(pool, b.responsable_id, req.user.role);
      if (erreurImputation) return res.status(403).json({ error: erreurImputation });
      const { rows: [actuelProBono] } = await pool.query("SELECT pro_bono FROM dossiers WHERE id = $1", [req.params.id]);
      if (actuelProBono?.pro_bono) {
        const { rows: [resp] } = await pool.query("SELECT role FROM utilisateurs WHERE id = $1", [b.responsable_id]);
        if (!resp || !["associe", "associe_fondateur"].includes(resp.role)) {
          return res.status(400).json({ error: "Un dossier pro bono doit être attribué à un avocat associé (seuls les associés ont droit au pro bono)." });
        }
      }
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

    // Traçabilité procédurale : photo "avant" sur les seuls champs suivis
    // (CHAMPS_PROCEDURAUX_DOSSIER), pour diffuser avant/après après l'UPDATE
    // sans dépendre de ce que le RETURNING choisit de renvoyer. Chargée ici
    // (avant le calcul du mode effectif ci-dessous) car elle porte déjà
    // client_id/mode_honoraires, nécessaires à ce calcul si le corps de la
    // requête ne les fournit pas.
    const { rows: [avant] } = await pool.query(
      `SELECT ${CHAMPS_PROCEDURAUX_DOSSIER.join(", ")}, couleur_chemise FROM dossiers WHERE id = $1`,
      [req.params.id]
    );
    if (!avant) return res.status(404).json({ error: "Dossier introuvable" });

    // Discipline de facturation — Bloc A : mode d'honoraires EFFECTIF
    // recalculé seulement si cette mise à jour touche mode_honoraires
    // et/ou client_id (changer l'un ou l'autre peut changer l'éligibilité
    // à la convention-cadre du client, voir resoudreModeHonorairesEffectif,
    // 09/10/2026) — sinon mode_honoraires n'est pas touché (COALESCE garde
    // la valeur actuelle), pas de recalcul sur une simple édition d'un
    // autre champ. Repli sur le mode déjà en base pour le verrou du
    // montant convenu ci-dessous, qu'il ait été recalculé ou non.
    let modeEffectif = null;
    if (b.mode_honoraires != null || b.client_id != null) {
      try {
        modeEffectif = await resoudreModeHonorairesEffectif(b.client_id ?? avant.client_id, b.mode_honoraires ?? avant.mode_honoraires);
      } catch (err) {
        return res.status(err.status || 400).json({ error: err.message });
      }
    }
    if (b.montant_convenu != null && !MODES_MONTANT_CONVENU.includes(modeEffectif ?? avant.mode_honoraires)) {
      return res.status(400).json({ error: "Montant convenu non applicable à ce mode d'honoraires (réservé à forfait/consultation)." });
    }

    const clauseConcurrence = b.maj_le_attendu != null
      ? "AND date_trunc('milliseconds', maj_le) = date_trunc('milliseconds', $26::timestamptz)"
      : "";
    const params = [b.intitule, b.pole, b.matiere, b.juridiction, b.montant_litige,
      modeEffectif, b.urgence, b.responsable_id, b.phase, b.statut, b.objet, b.numero_role,
      b.statut_procedure, b.statut_procedure_precision, b.intermediaire,
      b.code_matiere ? b.code_matiere.toUpperCase() : null, couleurRegeneree, numeroRegenere,
      b.client_id || null,
      b.montant_litige_sens || null,
      b.montant_litige_sens_precision || null,
      b.date_ouverture_origine || null,
      b.mode_honoraires_precision ?? null,
      b.montant_convenu ?? null,
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
         montant_litige_sens = COALESCE($20::sens_montant_litige, montant_litige_sens),
         montant_litige_sens_precision = COALESCE($21, montant_litige_sens_precision),
         date_ouverture_origine = COALESCE($22::date, date_ouverture_origine),
         mode_honoraires_precision = COALESCE($23, mode_honoraires_precision),
         montant_convenu_xof = COALESCE($24, montant_convenu_xof),
         maj_le = now()
       WHERE id = $25 ${clauseConcurrence}
       RETURNING id, numero, intitule, statut, phase, code_matiere, couleur_chemise, client_id, maj_le,
                 responsable_id, statut_procedure, statut_procedure_precision, juridiction,
                 numero_role, objet, montant_litige, montant_litige_sens, mode_honoraires`,
      params
    );
    if (!rows[0]) {
      const existe = await pool.query("SELECT 1 FROM dossiers WHERE id = $1", [req.params.id]);
      if (!existe.rows[0]) return res.status(404).json({ error: "Dossier introuvable" });
      return res.status(409).json({ error: "Ce dossier a été modifié entre-temps par quelqu'un d'autre — rechargez avant de réessayer." });
    }
    // Qualification de la matière (IND gris → couleur physique) : la chemise sort
    // du stock une seule fois (idempotent), jamais pour un simple changement de couleur.
    if (avant && avant.couleur_chemise !== rows[0].couleur_chemise) {
      await deduireChemise(pool, rows[0], req.user.sub, "Qualification de la matière");
    }
    const changements = diffChamps(avant, rows[0], CHAMPS_PROCEDURAUX_DOSSIER);
    if (Object.keys(changements).length) {
      await logAudit({
        utilisateurId: req.user.sub, action: "modifier_dossier", entite: "dossiers",
        entiteId: req.params.id, details: { changements }, ip: req.ip,
      });
    }
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/dossiers/:id/pro-bono — comble un gap signalé par l'utilisateur
// (21/09/2026) : pro_bono est volontairement exclu du PUT général ci-dessus
// (voir son commentaire) pour ne jamais contourner la permission/le quota
// prévus à la création — mais ça laissait alors AUCUN moyen de corriger une
// erreur de saisie ou de reclasser un dossier après coup. Route dédiée qui
// reproduit exactement les mêmes contrôles que POST / (permission, quota,
// responsable associé) plutôt qu'un PUT libre.
// ⚠️ Piège identifié avant d'écrire cette route (relevé explicitement par
// l'utilisateur, « il faut que ça reflète le quota, pas un contournement ») :
// le quota de POST / compare `date_ouverture` au mois COURANT — correct
// seulement parce qu'à la création `date_ouverture` vaut toujours
// aujourd'hui. Ici, on peut activer le pro bono sur un dossier ancien : le
// quota doit donc être évalué sur le mois d'OUVERTURE de CE dossier (sa
// cohorte), pas sur le mois courant — sinon on compterait/bloquerait par
// rapport au mauvais mois, ou on contournerait silencieusement le quota du
// mois réel d'ouverture.
router.put("/:id/pro-bono", requirePermission("dossiers.pro_bono.declarer"), async (req, res) => {
  const proBono = !!req.body?.pro_bono;
  try {
    const { rows: [d] } = await pool.query(
      "SELECT responsable_id, pro_bono, date_ouverture FROM dossiers WHERE id = $1",
      [req.params.id]
    );
    if (!d) return res.status(404).json({ error: "Dossier introuvable" });
    if (d.pro_bono === proBono) {
      return res.status(409).json({
        error: proBono ? "Ce dossier est déjà pro bono." : "Ce dossier n'est déjà pas pro bono.",
      });
    }
    if (proBono) {
      const { rows: [resp] } = await pool.query("SELECT role FROM utilisateurs WHERE id = $1", [d.responsable_id]);
      if (!resp || !["associe", "associe_fondateur"].includes(resp.role)) {
        return res.status(400).json({ error: "Un dossier pro bono doit être attribué à un avocat associé (seuls les associés ont droit au pro bono)." });
      }
      const { rows: [p] } = await pool.query("SELECT quota_pro_bono_mensuel FROM parametres_cabinet WHERE id = 1");
      const { rows: [c] } = await pool.query(
        `SELECT count(*) AS n FROM dossiers
         WHERE pro_bono AND responsable_id = $1
           AND date_trunc('month', date_ouverture) = date_trunc('month', $2::date)
           AND id <> $3`,
        [d.responsable_id, d.date_ouverture, req.params.id]
      );
      if (Number(c.n) >= p.quota_pro_bono_mensuel) {
        return res.status(409).json({
          error: `Quota pro bono mensuel atteint pour ce responsable, pour le mois d'ouverture de ce dossier (${p.quota_pro_bono_mensuel}/mois)`,
        });
      }
    }
    await pool.query("UPDATE dossiers SET pro_bono = $1 WHERE id = $2", [proBono, req.params.id]);
    await logAudit({
      utilisateurId: req.user.sub, action: "basculer_pro_bono", entite: "dossiers", entiteId: req.params.id,
      details: { changements: { pro_bono: { avant: d.pro_bono, apres: proBono } } }, ip: req.ip,
    });
    res.json({ pro_bono: proBono });
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
    // La lettre de mission auto-générée à l'ouverture (Bloc A, 18/09/2026)
    // ne doit pas, à elle seule, empêcher la suppression d'un dossier
    // fraîchement créé par erreur — sinon cette voie de secours
    // deviendrait morte pour la quasi-totalité des dossiers (elle se
    // génère automatiquement dès qu'un mode d'honoraires facturable est
    // choisi). Exclue explicitement de ce comptage ; tout AUTRE document
    // (pièce déposée, acte généré séparément…) continue de bloquer.
    const compteurs = await Promise.all(
      TABLES_ACTIVITE_DOSSIER.map((t) =>
        t === "documents"
          ? pool.query(
              `SELECT count(*) AS n FROM documents
               WHERE dossier_id = $1 AND id IS DISTINCT FROM (SELECT lettre_mission_document_id FROM dossiers WHERE id = $1)`,
              [id]
            )
          : pool.query(`SELECT count(*) AS n FROM ${t} WHERE dossier_id = $1`, [id])
      )
    );
    const bloquants = TABLES_ACTIVITE_DOSSIER
      .map((t, i) => ({ table: t, libelle: LIBELLES_TABLES_ACTIVITE[t] || t, n: Number(compteurs[i].rows[0].n) }))
      .filter((x) => x.n > 0);
    if (bloquants.length) {
      // `blocages` structuré (09/10/2026) en plus du texte — permet au
      // frontend d'offrir « Archiver à la place » directement depuis
      // l'échec de suppression, sans reparser le message.
      return res.status(409).json({
        error: `Suppression impossible : ce dossier contient déjà ${bloquants.map((x) => `${x.n} ${x.libelle}`).join(", ")}. Utilisez l'archivage à la place.`,
        blocages: bloquants.map(({ table, libelle, n }) => ({ table, libelle, n })),
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
// GET /api/dossiers/:id/instances/verifier-doublon?degre=&juridiction=
// (26/09/2026, audit doublons) — signale, sans jamais bloquer, une instance
// déjà enregistrée pour ce dossier au même degré et la même juridiction. Un
// vrai doublon existe (ressaisie manuelle), mais un 2e passage identique
// reste parfois légitime (réouverture) — jamais bloqué en dur.
router.get("/:id/instances/verifier-doublon", requirePermission("dossiers.instances.gerer"), async (req, res) => {
  const { degre, juridiction } = req.query;
  if (!degre) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT id, degre, juridiction, date_debut FROM instances
       WHERE dossier_id = $1 AND degre = $2::degre_instance
         AND ($3::varchar IS NULL OR juridiction ILIKE $3)`,
      [req.params.id, degre, juridiction || null]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/:id/instances", requirePermission("dossiers.instances.gerer"), async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await pool.query(
      `INSERT INTO instances (dossier_id, degre, juridiction, numero_role, date_debut, statut_partie, statut_partie_precision)
       VALUES ($1, COALESCE($2::degre_instance,'premiere_instance'), $3, $4, $5, $6::statut_partie_instance, $7)
       RETURNING id, degre, juridiction, numero_role, date_debut, decision, statut_partie, statut_partie_precision`,
      [req.params.id, b.degre || null, b.juridiction || null, b.numero_role || null, b.date_debut || null,
       b.statut_partie || null, b.statut_partie_precision || null]
    );
    await logAudit({
      utilisateurId: req.user.sub, action: "creer_instance", entite: "dossier_instances", entiteId: rows[0].id,
      details: { dossier_id: req.params.id, instance: rows[0] }, ip: req.ip,
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/dossiers/:id/instances/:instanceId — compléter une instance au
// fil du temps (n° de rôle obtenu après coup, décision rendue…).
const CHAMPS_PROCEDURAUX_INSTANCE = [
  "juridiction", "numero_role", "date_debut", "decision", "statut_partie", "statut_partie_precision",
];

router.put("/:id/instances/:instanceId", requirePermission("dossiers.instances.gerer"), async (req, res) => {
  const b = req.body || {};
  try {
    const { rows: [avant] } = await pool.query(
      `SELECT ${CHAMPS_PROCEDURAUX_INSTANCE.join(", ")} FROM instances WHERE id = $1 AND dossier_id = $2`,
      [req.params.instanceId, req.params.id]
    );
    if (!avant) return res.status(404).json({ error: "Instance introuvable" });
    const { rows } = await pool.query(
      `UPDATE instances SET
         juridiction = COALESCE($1, juridiction),
         numero_role = COALESCE($2, numero_role),
         date_debut = COALESCE($3, date_debut),
         decision = COALESCE($4, decision),
         statut_partie = COALESCE($5::statut_partie_instance, statut_partie),
         statut_partie_precision = COALESCE($6, statut_partie_precision)
       WHERE id = $7 AND dossier_id = $8
       RETURNING id, degre, juridiction, numero_role, date_debut, decision, statut_partie, statut_partie_precision`,
      [b.juridiction || null, b.numero_role || null, b.date_debut || null, b.decision || null,
       b.statut_partie || null, b.statut_partie_precision || null,
       req.params.instanceId, req.params.id]
    );
    const changements = diffChamps(avant, rows[0], CHAMPS_PROCEDURAUX_INSTANCE);
    if (Object.keys(changements).length) {
      await logAudit({
        utilisateurId: req.user.sub, action: "modifier_instance", entite: "dossier_instances",
        entiteId: req.params.instanceId, details: { dossier_id: req.params.id, changements }, ip: req.ip,
      });
    }
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/dossiers/:id/instances/:instanceId — retirer une instance
// ajoutée par erreur (19/09/2026, gap comblé — jusqu'ici aucun moyen de
// corriger un degré/statut mal saisi autrement que par une nouvelle
// instance à côté). Même patron que DELETE /:id/parties/:partieId.
router.delete("/:id/instances/:instanceId", requirePermission("dossiers.instances.gerer"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      "DELETE FROM instances WHERE id = $1 AND dossier_id = $2 RETURNING *",
      [req.params.instanceId, req.params.id]
    );
    if (rows[0]) {
      await logAudit({
        utilisateurId: req.user.sub, action: "supprimer_instance", entite: "dossier_instances",
        entiteId: req.params.instanceId, details: { dossier_id: req.params.id, instance: rows[0] }, ip: req.ip,
      });
    }
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/dossiers/:id/instances/:instanceId/vignette (08/10/2026, voir
// CLAUDE.md/HISTORY.md pour l'analyse complète menée avec l'utilisateur) —
// enregistre la vignette de plaidoirie qui marque l'entrée en procédure du
// cabinet sur CETTE instance précise (jamais l'audience, jamais le dossier
// en général) : constitution, assignation, requête, conclusions, mémoire
// en défense — une seule fois par instance (contrainte d'unicité en base,
// vérifiée aussi ici pour un message clair plutôt qu'une erreur SQL brute).
// Condition de décaissement UNIFORME, sans distinction de mode d'honoraires
// (classique/abonnement/pro bono) : le mode d'honoraires du dossier doit
// être renseigné — pas de facture exigée (décision explicite de
// l'utilisateur, 08/10/2026, pour ne pas créer de dépendance circulaire
// avec la facturation).
router.post("/:id/instances/:instanceId/vignette", requirePermission("depenses.vignettes.mouvement"), async (req, res) => {
  const b = req.body || {};
  const numero = Number(b.numero_vignette);
  if (!Number.isInteger(numero) || numero <= 0 || numero > 9999999) {
    return res.status(400).json({ error: "numero_vignette requis : un numéro de 7 chiffres au maximum" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [dossier] } = await client.query(
      "SELECT pole, mode_honoraires, pro_bono FROM dossiers WHERE id = $1 FOR UPDATE", [req.params.id]
    );
    if (!dossier) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Dossier introuvable" }); }
    if (dossier.pole !== "contentieux") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Une vignette de plaidoirie ne concerne qu'un dossier contentieux." });
    }
    if (!dossier.mode_honoraires) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Le mode d'honoraires du dossier doit être renseigné avant d'enregistrer une vignette." });
    }
    const { rows: [instance] } = await client.query(
      "SELECT id FROM instances WHERE id = $1 AND dossier_id = $2", [req.params.instanceId, req.params.id]
    );
    if (!instance) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Instance introuvable" }); }
    const dejaUtilisee = await client.query(
      "SELECT 1 FROM vignettes_plaidoirie WHERE instance_id = $1 AND mouvement = 'utilisation'", [req.params.instanceId]
    );
    if (dejaUtilisee.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Une vignette a déjà été enregistrée pour cette instance." });
    }
    const numeroDejaUtilise = await client.query(
      "SELECT 1 FROM vignettes_plaidoirie WHERE numero_vignette = $1 AND mouvement = 'utilisation'", [numero]
    );
    if (numeroDejaUtilise.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Ce numéro de vignette a déjà été enregistré sur une autre instance." });
    }
    const stock = await client.query("SELECT stock FROM v_stock_vignettes");
    if ((stock.rows[0]?.stock ?? 0) <= 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Stock de vignettes épuisé — enregistrez d'abord un approvisionnement (Dépenses & caisse)." });
    }
    const refacturee = !dossier.pro_bono;
    const { rows: [vignette] } = await client.query(
      `INSERT INTO vignettes_plaidoirie (mouvement, quantite, dossier_id, instance_id, numero_vignette, refacturee, cree_par)
       VALUES ('utilisation', 1, $1, $2, $3, $4, $5)
       RETURNING id`,
      [req.params.id, req.params.instanceId, numero, refacturee, req.user.sub]
    );
    // Si ce numéro provient d'un approvisionnement avec plage connue, le
    // marque consommé dans le pool — sinon simple saisie libre, sans effet
    // (numéros jamais préenregistrés pour cet achat).
    await client.query(
      "UPDATE vignettes_numeros_stock SET disponible = FALSE, utilisation_id = $1 WHERE numero = $2 AND disponible = TRUE",
      [vignette.id, numero]
    );
    const { rows: [depense] } = await client.query(
      `INSERT INTO depenses (type, categorie, libelle, montant, date_depense, statut, dossier_id, refacturable_client, cree_par)
       VALUES ('ponctuelle', 'vignette_plaidoirie', $1, 10000, current_date, 'decaissee', $2, $3, $4)
       RETURNING id`,
      [`Vignette de plaidoirie n°${numero}`, req.params.id, refacturee, req.user.sub]
    );
    await client.query("UPDATE vignettes_plaidoirie SET depense_id = $1 WHERE id = $2", [depense.id, vignette.id]);
    await client.query("COMMIT");
    res.status(201).json({ id: vignette.id, numero_vignette: numero, depense_id: depense.id, refacturee });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// POST/PUT/DELETE /api/dossiers/:id/parties — rectifier les parties adverses
// après la création (20/08/2026, demande utilisateur : gap signalé — seule
// l'ouverture (POST /) permettait jusqu'ici de les saisir, aucune route ne
// permettait de corriger une erreur de saisie ensuite). Même patron que
// les clients additionnels/instances ci-dessus. `dossier_parties` (déjà en
// base) n'est pas une fiche client — aucun champ KYC n'y est rattaché, ces
// routes ne touchent jamais la table `clients`/`client_pieces_kyc`.
// GET /api/dossiers/:id/parties/verifier-doublon?role=&denomination=
// (26/09/2026, audit doublons) — signale, sans jamais bloquer, une partie
// déjà enregistrée sur ce dossier avec le même rôle et un nom identique à
// l'espace/tiret près (même normalisation que GET /api/clients/verifier-doublon).
router.get("/:id/parties/verifier-doublon", requirePermission("dossiers.parties.gerer"), async (req, res) => {
  const { role, denomination } = req.query;
  if (!denomination) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT id, role, denomination FROM dossier_parties
       WHERE dossier_id = $1 AND ($2::role_partie IS NULL OR role = $2::role_partie)
         AND regexp_replace(lower(denomination), '[\\s\\-.,]', '', 'g')
           = regexp_replace(lower($3), '[\\s\\-.,]', '', 'g')`,
      [req.params.id, role || null, denomination]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

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
    await logAudit({
      utilisateurId: req.user.sub, action: "creer_partie", entite: "dossier_parties", entiteId: rows[0].id,
      details: { dossier_id: req.params.id, partie: rows[0] }, ip: req.ip,
    });
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
    const { rows: [avant] } = await pool.query(
      "SELECT role, denomination, conseil FROM dossier_parties WHERE id = $1 AND dossier_id = $2",
      [req.params.partieId, req.params.id]
    );
    if (!avant) return res.status(404).json({ error: "Partie introuvable" });
    const { rows } = await pool.query(
      `UPDATE dossier_parties SET
         role = COALESCE($1::role_partie, role),
         denomination = COALESCE($2, denomination),
         conseil = COALESCE($3, conseil)
       WHERE id = $4 AND dossier_id = $5
       RETURNING id, role, denomination, conseil`,
      [b.role || null, b.denomination || null, b.conseil || null, req.params.partieId, req.params.id]
    );
    const changements = diffChamps(avant, rows[0], ["role", "denomination", "conseil"]);
    if (Object.keys(changements).length) {
      await logAudit({
        utilisateurId: req.user.sub, action: "modifier_partie", entite: "dossier_parties",
        entiteId: req.params.partieId, details: { dossier_id: req.params.id, changements }, ip: req.ip,
      });
    }
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

router.delete("/:id/parties/:partieId", requirePermission("dossiers.parties.gerer"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      "DELETE FROM dossier_parties WHERE id = $1 AND dossier_id = $2 RETURNING *",
      [req.params.partieId, req.params.id]
    );
    if (rows[0]) {
      await logAudit({
        utilisateurId: req.user.sub, action: "supprimer_partie", entite: "dossier_parties",
        entiteId: req.params.partieId, details: { dossier_id: req.params.id, partie: rows[0] }, ip: req.ip,
      });
    }
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/dossiers/:id/intervenants  { utilisateur_id, role_dossier? }
// Ajoute un intervenant (12/09/2026, gap comblé — voir plus haut) —
// n'importe quel statut, pas seulement avocat, contrairement au
// responsable. `role_dossier` texte libre (ex. « Juriste en soutien »),
// 'collaborateur' par défaut si omis (comportement d'origine du schéma).
// ON CONFLICT : réinscrire une personne déjà intervenante met simplement à
// jour son role_dossier plutôt que d'échouer sur la clé composite.
router.post("/:id/intervenants", requirePermission("dossiers.intervenants.gerer"), async (req, res) => {
  const { utilisateur_id, role_dossier } = req.body || {};
  if (!utilisateur_id) return res.status(400).json({ error: "utilisateur_id requis" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO dossier_intervenants (dossier_id, utilisateur_id, role_dossier)
       VALUES ($1,$2,COALESCE($3,'collaborateur'))
       ON CONFLICT (dossier_id, utilisateur_id) DO UPDATE SET role_dossier = EXCLUDED.role_dossier
       RETURNING dossier_id, utilisateur_id, role_dossier`,
      [req.params.id, utilisateur_id, role_dossier || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/dossiers/:id/intervenants/:utilisateurId
router.delete("/:id/intervenants/:utilisateurId", requirePermission("dossiers.intervenants.gerer"), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM dossier_intervenants WHERE dossier_id = $1 AND utilisateur_id = $2",
      [req.params.id, req.params.utilisateurId]
    );
    if (!rowCount) return res.status(404).json({ error: "Intervenant introuvable sur ce dossier" });
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
