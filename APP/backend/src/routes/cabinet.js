// JURIA — Cabinet (RH) : équipe et charge de travail, congés, alertes RH,
// pointage, compteur d'heures, bulletins de paie (option légère).
const express = require("express");
const { pool } = require("../db");
const { requirePermission, estAutorise } = require("../permissions");
const router = express.Router();

// GET /api/cabinet/equipe — membres, heures du mois, dossiers actifs, échéance de congé/contrat
// Gardé par cabinet.consulter (29/08/2026) : vue de supervision d'équipe —
// contrairement à congés/présence ci-dessous, laissés en libre-service même
// si le module est masqué du menu pour un profil donné.
router.get("/equipe", requirePermission("cabinet.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.code, u.prenom, u.nom, u.role, u.pole, u.taux_horaire, u.actif,
              u.type_contrat, u.date_fin_essai, u.date_fin_contrat,
              COALESCE(h.total_heures, 0) AS heures_mois,
              (SELECT COUNT(*) FROM dossiers d WHERE d.responsable_id = u.id AND d.statut = 'ouvert') AS dossiers_actifs
       FROM utilisateurs u
       LEFT JOIN v_heures_mensuelles h
              ON h.utilisateur_id = u.id AND h.mois = date_trunc('month', current_date)
       WHERE u.actif = TRUE
       ORDER BY u.prenom`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/cabinet/echeances — fin d'essai, fin de contrat, visite médicale à venir
router.get("/echeances", requirePermission("cabinet.consulter"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT utilisateur_id, prenom, nom, type_echeance, echeance,
              (echeance - current_date) AS jours_restants
       FROM v_echeances_rh
       WHERE echeance >= current_date - interval '7 days'
       ORDER BY echeance`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/cabinet/conges?utilisateur_id=&statut=
router.get("/conges", async (req, res) => {
  const { utilisateur_id, statut } = req.query;
  const params = [];
  const clauses = [];
  if (utilisateur_id) { params.push(utilisateur_id); clauses.push(`c.utilisateur_id = $${params.length}`); }
  if (statut) { params.push(statut); clauses.push(`c.statut = $${params.length}::statut_conge`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.utilisateur_id, c.type, c.date_debut, c.date_fin, c.statut, c.motif,
              u.prenom || ' ' || u.nom AS membre,
              a.prenom || ' ' || a.nom AS approuve_par
       FROM conges c
       JOIN utilisateurs u ON u.id = c.utilisateur_id
       LEFT JOIN utilisateurs a ON a.id = c.approuve_par
       ${where}
       ORDER BY c.date_debut DESC`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/cabinet/conges  { utilisateur_id?, type, date_debut, date_fin, motif? }
// Sans utilisateur_id : demande pour soi-même.
router.post("/conges", requirePermission("cabinet.conge.demander"), async (req, res) => {
  const b = req.body || {};
  if (!b.date_debut || !b.date_fin) return res.status(400).json({ error: "date_debut et date_fin requises" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO conges (utilisateur_id, type, date_debut, date_fin, motif)
       VALUES (COALESCE($1::uuid,$5::uuid),COALESCE($2::type_conge,'annuel'),$3,$4,$6)
       RETURNING id, type, date_debut, date_fin, statut`,
      [b.utilisateur_id || null, b.type, b.date_debut, b.date_fin, req.user.sub, b.motif || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/cabinet/conges/:id — retirer sa propre demande avant décision
// (19/09/2026, gap comblé — jusqu'ici seule la décision associé/RH
// existait, le demandeur ne pouvait pas retirer ni corriger une demande
// faite par erreur). Restreint au demandeur lui-même OU à quelqu'un
// habilité à décider (cabinet.conge.decision) — verrouillé dès qu'une
// décision est prise (statut ≠ 'demande').
router.delete("/conges/:id", requirePermission("cabinet.conge.demander"), async (req, res) => {
  try {
    const { rows: [conge] } = await pool.query("SELECT utilisateur_id, statut FROM conges WHERE id = $1", [req.params.id]);
    if (!conge) return res.status(404).json({ error: "Demande introuvable" });
    const estDemandeur = conge.utilisateur_id === req.user.sub;
    if (!estDemandeur && !(await estAutorise(req.user.role, "cabinet.conge.decision"))) {
      return res.status(403).json({ error: "Seul le demandeur ou une personne habilitée à décider peut retirer cette demande." });
    }
    const { rowCount } = await pool.query("DELETE FROM conges WHERE id = $1 AND statut = 'demande'", [req.params.id]);
    if (!rowCount) return res.status(409).json({ error: "Demande déjà traitée — non retirable." });
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/cabinet/conges/:id/annuler  { motif? } — annuler un congé déjà
// APPROUVÉ (25/09/2026 : la personne renonce, ou erreur de décision).
// Réservé à qui peut décider (cabinet.conge.decision) : un congé approuvé
// engage l'organisation du cabinet. Jamais supprimé (statut 'annule', trace
// de qui a annulé dans approuve_par/approuve_le, motif ajouté).
router.post("/conges/:id/annuler", requirePermission("cabinet.conge.decision"), async (req, res) => {
  const motif = (req.body?.motif || "").trim();
  try {
    const { rows } = await pool.query(
      `UPDATE conges SET statut = 'annule', approuve_par = $1, approuve_le = now(),
         motif = CASE WHEN $2::text = '' THEN motif ELSE concat_ws(' — ', motif, 'Annulé : ' || $2::text) END
       WHERE id = $3 AND statut = 'approuve' RETURNING id, statut`,
      [req.user.sub, motif, req.params.id]
    );
    if (!rows[0]) {
      const existe = await pool.query("SELECT 1 FROM conges WHERE id = $1", [req.params.id]);
      return res.status(existe.rows[0] ? 409 : 404).json({
        error: existe.rows[0] ? "Seul un congé approuvé peut être annulé (déjà annulé entre-temps ?)" : "Demande introuvable",
      });
    }
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/cabinet/conges/:id/decision  { statut: 'approuve'|'refuse' }  (associé/admin)
router.post("/conges/:id/decision", requirePermission("cabinet.conge.decision"), async (req, res) => {
  const { statut } = req.body || {};
  if (!["approuve", "refuse"].includes(statut)) return res.status(400).json({ error: "Statut invalide" });
  try {
    // Garde contre une double décision concurrente sur la même demande.
    const { rows } = await pool.query(
      `UPDATE conges SET statut = $1::statut_conge, approuve_par = $2, approuve_le = now()
       WHERE id = $3 AND statut = 'demande' RETURNING id, statut`,
      [statut, req.user.sub, req.params.id]
    );
    if (!rows[0]) {
      const existe = await pool.query("SELECT 1 FROM conges WHERE id = $1", [req.params.id]);
      return res.status(existe.rows[0] ? 409 : 404).json({
        error: existe.rows[0] ? "Demande déjà traitée (par quelqu'un d'autre entre-temps ?)" : "Demande introuvable",
      });
    }
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/cabinet/presences?utilisateur_id=&mois=YYYY-MM-01
router.get("/presences", async (req, res) => {
  const uid = req.query.utilisateur_id || req.user.sub;
  // Voir le pointage de quelqu'un d'autre exige la vue de supervision RH
  // (25/09/2026 — même contournement ?utilisateur_id= que celui corrigé sur
  // les bulletins le 18/08/2026, jamais repris ici jusqu'à présent).
  if (uid !== req.user.sub && !(await estAutorise(req.user.role, "cabinet.consulter"))) {
    return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
  }
  const mois = req.query.mois || new Date().toISOString().slice(0, 8) + "01";
  try {
    const jours = await pool.query(
      `SELECT date_jour, heure_arrivee, heure_depart, heures
       FROM presences WHERE utilisateur_id = $1 AND date_trunc('month', date_jour) = $2::date
       ORDER BY date_jour DESC`,
      [uid, mois]
    );
    const total = await pool.query(
      `SELECT total_heures, jours_pointes FROM v_heures_mensuelles
       WHERE utilisateur_id = $1 AND mois = $2::date`,
      [uid, mois]
    );
    res.json({ jours: jours.rows, total_heures: total.rows[0]?.total_heures ?? 0, jours_pointes: total.rows[0]?.jours_pointes ?? 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/cabinet/presences  { date_jour?, heure_arrivee?, heure_depart?, heures?, remplacer? }
// Pointage pour soi-même ; upsert sur (utilisateur_id, date_jour).
// 25/09/2026 :
//  - date_jour exposée à l'écran (correction d'un jour passé) — refusée dans
//    le futur ;
//  - remplacer=true : correction, les valeurs fournies remplacent celles du
//    jour (sinon un champ laissé vide ne peut jamais être effacé, COALESCE) ;
//  - heures calculées à partir de l'arrivée/départ quand elles ne sont pas
//    saisies : jusqu'ici l'écran n'envoyait jamais « heures », le compteur
//    mensuel (SUM(heures)) restait donc toujours à 0 h.
const HEURES_CALCULEES = `CASE WHEN heure_arrivee IS NOT NULL AND heure_depart IS NOT NULL AND heure_depart > heure_arrivee
  THEN round((extract(epoch FROM heure_depart - heure_arrivee) / 3600)::numeric, 2) ELSE NULL END`;
router.post("/presences", requirePermission("cabinet.presence.pointer"), async (req, res) => {
  const b = req.body || {};
  const date = b.date_jour || new Date().toISOString().slice(0, 10);
  if (date > new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: "Impossible de pointer une date future." });
  const remplacer = b.remplacer === true;
  try {
    const { rows } = await pool.query(
      `INSERT INTO presences (utilisateur_id, date_jour, heure_arrivee, heure_depart, heures, source)
       VALUES ($1,$2,$3,$4,$5,'saisie')
       ON CONFLICT (utilisateur_id, date_jour) DO UPDATE SET
         heure_arrivee = CASE WHEN $6::boolean THEN EXCLUDED.heure_arrivee ELSE COALESCE(EXCLUDED.heure_arrivee, presences.heure_arrivee) END,
         heure_depart  = CASE WHEN $6::boolean THEN EXCLUDED.heure_depart  ELSE COALESCE(EXCLUDED.heure_depart, presences.heure_depart) END,
         heures        = CASE WHEN $6::boolean THEN EXCLUDED.heures        ELSE COALESCE(EXCLUDED.heures, presences.heures) END
       RETURNING id`,
      [req.user.sub, date, b.heure_arrivee || null, b.heure_depart || null, b.heures ?? null, remplacer]
    );
    // Heures saisies explicitement → respectées ; sinon recalculées.
    const { rows: [p] } = await pool.query(
      `UPDATE presences SET heures = CASE WHEN $2::boolean THEN heures ELSE ${HEURES_CALCULEES} END
       WHERE id = $1 RETURNING id, date_jour, heure_arrivee, heure_depart, heures`,
      [rows[0].id, b.heures !== undefined && b.heures !== null && b.heures !== ""]
    );
    res.status(201).json(p);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/cabinet/presences/:date  (YYYY-MM-DD) — retirer SON pointage
// d'un jour saisi par erreur (25/09/2026). Uniquement le sien.
router.delete("/presences/:date", requirePermission("cabinet.presence.pointer"), async (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return res.status(400).json({ error: "Date invalide" });
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM presences WHERE utilisateur_id = $1 AND date_jour = $2::date", [req.user.sub, req.params.date]
    );
    if (!rowCount) return res.status(404).json({ error: "Aucun pointage ce jour-là" });
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/cabinet/bulletins?utilisateur_id=
// Chacun voit toujours SON PROPRE bulletin sans permission particulière ;
// voir celui de quelqu'un d'autre exige cabinet.bulletins.consulter. Avant
// ce correctif, ?utilisateur_id=<autre> n'était filtré par rien d'autre que
// la valeur par défaut (fausse impression de sécurité).
router.get("/bulletins", async (req, res) => {
  const uid = req.query.utilisateur_id || req.user.sub;
  if (uid !== req.user.sub) {
    const { rows } = await pool.query(
      "SELECT autorise FROM permissions_role WHERE role = $1 AND action_code = 'cabinet.bulletins.consulter'",
      [req.user.role]
    );
    if (!rows[0] || !rows[0].autorise) {
      return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
    }
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, mois, salaire_brut, salaire_net, primes, verse_le
       FROM bulletins_paie WHERE utilisateur_id = $1 ORDER BY mois DESC`,
      [uid]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/cabinet/bulletins  (associé/admin/comptable)
// { utilisateur_id, mois, salaire_brut?, salaire_net?, cotisations_salariales?, cotisations_patronales?, primes?, verse_le? }
router.post("/bulletins", requirePermission("cabinet.bulletin.generer"), async (req, res) => {
  const b = req.body || {};
  if (!b.utilisateur_id || !b.mois) return res.status(400).json({ error: "utilisateur_id et mois requis" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO bulletins_paie
         (utilisateur_id, mois, salaire_brut, salaire_net, cotisations_salariales, cotisations_patronales, primes, verse_le, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (utilisateur_id, mois) DO UPDATE SET
         salaire_brut = EXCLUDED.salaire_brut, salaire_net = EXCLUDED.salaire_net,
         cotisations_salariales = EXCLUDED.cotisations_salariales,
         cotisations_patronales = EXCLUDED.cotisations_patronales,
         primes = EXCLUDED.primes, verse_le = EXCLUDED.verse_le
       RETURNING id, mois, salaire_brut, salaire_net`,
      [b.utilisateur_id, b.mois, b.salaire_brut || null, b.salaire_net || null,
       b.cotisations_salariales || null, b.cotisations_patronales || null,
       b.primes || null, b.verse_le || null, req.user.sub]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
