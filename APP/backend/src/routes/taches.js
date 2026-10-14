// JURIA — Tâches internes (plan d'action)
const express = require("express");
const { pool } = require("../db");
const { requirePermission } = require("../permissions");
const { logAudit } = require("../audit");
const router = express.Router();

// Délégation d'une tâche (Bloc D, 10/10/2026, diagnostic "instruction
// avocat -> collaborateur" — voir CLAUDE.md) : même esprit que
// verifierImputationResponsable() de dossiers.js (30/08/2026), appliqué ici
// aux tâches. L'auto-assignation (responsable = appelant) reste toujours
// libre pour tous, quel que soit le rôle — seule la délégation à QUELQU'UN
// D'AUTRE est restreinte :
// - un avocat (associé, fondateur, Of Counsel, avocat stagiaire,
//   collaborateur avocat) peut confier n'importe quel type de tâche à
//   n'importe qui ;
// - un juriste (collaborateur non-avocat) peut confier une tâche
//   uniquement à un stagiaire non-avocat ou à l'assistante, et uniquement
//   pour des types de tâches administratives/support (pas recherche/
//   rédaction/revue/appel client, considérés comme du travail juridique
//   réservé aux avocats pour déléguer) ;
// - tout autre profil ne peut pas confier de tâche à quelqu'un d'autre.
const ROLES_AVOCAT_TACHE = ["associe", "associe_fondateur", "of_counsel", "avocat_stagiaire", "collaborateur"];
const TYPES_DELEGABLES_JURISTE = ["depot", "facturation", "relance", "collecte_pieces", "autre"];
const PROFILS_DELEGABLES_PAR_JURISTE = ["stagiaire", "assistante"];

async function verifierDelegationTache(poolOuClient, responsableId, type, roleAppelant, appelantId) {
  if (!responsableId || responsableId === appelantId) return null;
  if (ROLES_AVOCAT_TACHE.includes(roleAppelant)) return null;
  if (roleAppelant === "juriste") {
    const { rows: [resp] } = await poolOuClient.query("SELECT role FROM utilisateurs WHERE id = $1", [responsableId]);
    const typeEffectif = type || "autre";
    if (resp && PROFILS_DELEGABLES_PAR_JURISTE.includes(resp.role) && TYPES_DELEGABLES_JURISTE.includes(typeEffectif)) {
      return null;
    }
    return "Un collaborateur non-avocat ne peut confier une tâche qu'à un stagiaire non-avocat ou à l'assistante, et uniquement pour des tâches administratives (dépôt, facturation, relance, collecte de pièces, autre).";
  }
  return "Seuls les avocats peuvent confier une tâche à quelqu'un d'autre (les collaborateurs non-avocats ne le peuvent que pour certaines tâches administratives, vers un stagiaire non-avocat ou l'assistante).";
}

// GET /api/taches?dossier_id=...  |  ?mine=1  (mes tâches)  |  ?anciennes=true
//
// Terminées/annulées masquées par défaut au-delà de 30 jours (13/09/2026,
// demande explicite de l'utilisateur — même esprit que "masquer/archiver"
// sur la messagerie, mais une seule règle partagée : une tâche est un
// objet du cabinet, pas une conversation privée, pas besoin d'un état par
// personne). Rien n'est jamais supprimé ni réellement caché : ?anciennes=true
// les fait toutes réapparaître, exactement comme le rappel "Discussions
// masquées". Corrige au passage un vrai bug latent : avant ce filtre, le
// LIMIT global (toutes tâches confondues, trié par échéance croissante)
// pouvait laisser d'anciennes tâches terminées évincer des tâches actives
// plus récentes une fois le volume total dépassé.
router.get("/", requirePermission("taches.consulter"), async (req, res) => {
  const { dossier_id, mine, anciennes } = req.query;
  const params = [];
  const conditions = [];
  if (dossier_id) { params.push(dossier_id); conditions.push(`t.dossier_id = $${params.length}`); }
  // 14/10/2026 — "mine" couvre désormais aussi ce que l'appelant a confié
  // à quelqu'un d'autre (cree_par), pas seulement ce qui lui est assigné :
  // sert la vue par défaut "Mes tâches" du Plan d'action (gap du
  // 14/10/2026, voir CLAUDE.md) — un juriste doit y retrouver ce qu'il a
  // délégué, pas seulement ses propres tâches. Sans effet pour un profil
  // qui ne délègue jamais (cree_par = responsable_id dans ce cas).
  else if (mine) { params.push(req.user.sub); conditions.push(`(t.responsable_id = $${params.length} OR t.cree_par = $${params.length})`); }
  if (anciennes !== "true") {
    conditions.push(`(t.statut NOT IN ('termine','annule') OR t.maj_le >= now() - interval '30 days')`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.titre, t.type, t.priorite, t.statut, t.echeance, t.validation_requise,
              t.description, t.dossier_id, t.responsable_id, d.numero AS dossier_numero,
              d.intitule AS dossier_intitule,
              u.prenom || ' ' || u.nom AS responsable,
              t.cree_par, cp.prenom || ' ' || cp.nom AS cree_par_nom
       FROM taches t
       LEFT JOIN dossiers d ON d.id = t.dossier_id
       LEFT JOIN utilisateurs u ON u.id = t.responsable_id
       LEFT JOIN utilisateurs cp ON cp.id = t.cree_par
       ${where}
       ORDER BY t.echeance NULLS LAST, t.cree_le DESC
       LIMIT 300`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/taches  { dossier_id?, titre, type?, priorite?, echeance?, responsable_id?, validation_requise?, description? }
router.post("/", requirePermission("taches.creer"), async (req, res) => {
  const b = req.body || {};
  if (!b.titre) return res.status(400).json({ error: "titre requis" });
  try {
    const responsableResolu = b.responsable_id || req.user.sub;
    const erreurDelegation = await verifierDelegationTache(pool, responsableResolu, b.type, req.user.role, req.user.sub);
    if (erreurDelegation) return res.status(403).json({ error: erreurDelegation });
    const { rows } = await pool.query(
      `INSERT INTO taches
         (dossier_id, titre, type, priorite, statut, echeance, responsable_id, validation_requise, description, cree_par)
       VALUES ($1,$2,COALESCE($3::type_tache,'autre'),COALESCE($4::priorite_tache,'normale'),'a_faire',$5,
               COALESCE($6::uuid,$9::uuid),COALESCE($7,false),$8,$9)
       RETURNING id, titre, statut, priorite, echeance, dossier_id, responsable_id`,
      [b.dossier_id || null, b.titre, b.type, b.priorite, b.echeance || null,
       b.responsable_id || null, b.validation_requise, b.description || null, req.user.sub]
    );
    // 10/10/2026 — Bloc A du diagnostic "instruction avocat -> collaborateur"
    // (voir CLAUDE.md) : les tâches n'étaient tracées nulle part dans
    // journal_audit, contrairement aux audiences.
    await logAudit({
      utilisateurId: req.user.sub, action: "creer_tache", entite: "taches", entiteId: rows[0].id,
      details: { dossier_id: rows[0].dossier_id, titre: rows[0].titre, responsable_id: rows[0].responsable_id },
      ip: req.ip,
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/taches/:id  { statut }
// 10/10/2026 — Bloc A du diagnostic "instruction avocat -> collaborateur"
// (voir CLAUDE.md) : cette route acceptait "termine" sans jamais vérifier
// `validation_requise`, ni renseigner `valide_par`/`valide_le` — un
// contournement complet de la validation cochée à la création (seule
// POST /:id/valider le fait correctement). Désormais bloquée (409) pour
// TOUT statut='termine' sur une tâche validation_requise=true, quel que
// soit le rôle de l'appelant (même un associé habilité à valider doit
// passer par /valider, pour que valide_par/valide_le soient toujours
// renseignés quand la validation a été demandée).
router.put("/:id", requirePermission("taches.statut.modifier"), async (req, res) => {
  const { statut } = req.body || {};
  const permis = ["a_faire", "en_cours", "a_valider", "termine", "annule"];
  if (!permis.includes(statut)) return res.status(400).json({ error: "statut invalide" });
  try {
    const { rows: [avant] } = await pool.query(
      "SELECT statut, validation_requise, dossier_id FROM taches WHERE id = $1",
      [req.params.id]
    );
    if (!avant) return res.status(404).json({ error: "Tâche introuvable" });
    if (statut === "termine" && avant.validation_requise) {
      return res.status(409).json({
        error: "Cette tâche nécessite une validation — utilisez « Valider » plutôt que de la clôturer directement.",
      });
    }
    const { rows } = await pool.query(
      "UPDATE taches SET statut = $1 WHERE id = $2 RETURNING id, statut",
      [statut, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Tâche introuvable" });
    if (avant.statut !== statut) {
      await logAudit({
        utilisateurId: req.user.sub, action: "modifier_statut_tache", entite: "taches", entiteId: req.params.id,
        details: { dossier_id: avant.dossier_id, avant: avant.statut, apres: statut }, ip: req.ip,
      });
    }
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /api/taches/:id/details  { titre?, echeance?, responsable_id?, priorite?, type?, description? }
// Correction d'une tâche (25/09/2026) — jusqu'ici seul le statut était
// modifiable : une faute de frappe, une échéance ou un responsable erroné
// obligeait à annuler puis recréer la tâche. Route distincte de PUT /:id
// (statut) : corriger le contenu relève de la même habilitation que créer
// (taches.creer), pas du simple déplacement de carte. Verrouillé une fois
// la tâche terminée ou annulée. echeance: null explicite = retirer l'échéance.
router.put("/:id/details", requirePermission("taches.creer"), async (req, res) => {
  const b = req.body || {};
  if (b.titre !== undefined && !String(b.titre).trim()) return res.status(400).json({ error: "titre requis" });
  try {
    const { rows: [avant] } = await pool.query(
      "SELECT titre, echeance, responsable_id, priorite, type, description, dossier_id, statut FROM taches WHERE id = $1",
      [req.params.id]
    );
    if (avant) {
      const responsableCible = b.responsable_id !== undefined ? b.responsable_id : avant.responsable_id;
      const typeCible = b.type || avant.type;
      const erreurDelegation = await verifierDelegationTache(pool, responsableCible, typeCible, req.user.role, req.user.sub);
      if (erreurDelegation) return res.status(403).json({ error: erreurDelegation });
    }
    const { rows } = await pool.query(
      `UPDATE taches SET
         titre = COALESCE($1, titre),
         echeance = CASE WHEN $3::boolean THEN $2::date ELSE echeance END,
         responsable_id = COALESCE($4::uuid, responsable_id),
         priorite = COALESCE($5::priorite_tache, priorite),
         type = COALESCE($6::type_tache, type),
         description = COALESCE($8, description)
       WHERE id = $7 AND statut NOT IN ('termine','annule')
       RETURNING id, titre, echeance, responsable_id, priorite, type, statut, description, dossier_id`,
      [b.titre ? String(b.titre).trim() : null, b.echeance || null, b.echeance !== undefined,
       b.responsable_id || null, b.priorite || null, b.type || null, req.params.id, b.description ?? null]
    );
    if (!rows[0]) {
      const existe = await pool.query("SELECT 1 FROM taches WHERE id = $1", [req.params.id]);
      return res.status(existe.rows[0] ? 409 : 404).json({
        error: existe.rows[0] ? "Tâche terminée ou annulée — réactivez-la avant de la modifier." : "Tâche introuvable",
      });
    }
    if (avant) {
      const champs = ["titre", "echeance", "responsable_id", "priorite", "type", "description"];
      const changements = {};
      for (const c of champs) {
        const v1 = avant[c] ?? null, v2 = rows[0][c] ?? null;
        if (String(v1) !== String(v2)) changements[c] = { avant: v1, apres: v2 };
      }
      if (Object.keys(changements).length) {
        await logAudit({
          utilisateurId: req.user.sub, action: "modifier_details_tache", entite: "taches", entiteId: req.params.id,
          details: { dossier_id: rows[0].dossier_id, changements }, ip: req.ip,
        });
      }
    }
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/taches/:id/valider  (réservé aux associés)
router.post("/:id/valider", requirePermission("taches.valider"), async (req, res) => {
  try {
    // Garde contre la double validation concurrente : voir retrocessions.js
    // pour le même motif.
    const { rows } = await pool.query(
      `UPDATE taches SET statut = 'termine', valide_par = $1, valide_le = now()
       WHERE id = $2 AND statut <> 'termine' RETURNING id, statut, dossier_id`,
      [req.user.sub, req.params.id]
    );
    if (!rows[0]) {
      const existe = await pool.query("SELECT 1 FROM taches WHERE id = $1", [req.params.id]);
      return res.status(existe.rows[0] ? 409 : 404).json({
        error: existe.rows[0] ? "Tâche déjà validée (par quelqu'un d'autre entre-temps ?)" : "Tâche introuvable",
      });
    }
    await logAudit({
      utilisateurId: req.user.sub, action: "valider_tache", entite: "taches", entiteId: rows[0].id,
      details: { dossier_id: rows[0].dossier_id }, ip: req.ip,
    });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
