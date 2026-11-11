// JURIA — relances et alertes périodiques du centre de notifications (lot 2, 07/11/2026). Cloche SEULEMENT : ce job n'envoie
// aucun e-mail. À planifier une fois par jour ouvré (matin) ; jamais le week-end (heures ouvrées : samedi et dimanche ne comptent pas).
//  - dépenses soumises, dépenses engagées à valider après coup, état de charges soumis : en attente depuis plus de 48 h ouvrées
//    → une notification récapitulative par décideur (« N dépenses attendent… »), remplacée chaque jour tant que ça dure ;
//  - tâches en retard : cloche au responsable (une fois), escalade à celui qui l'a confiée après 48 h ouvrées (une fois) ;
//  - état de charges à soumettre à partir du 25 du mois (une fois par mois et par préparateur) ;
//  - petite caisse non dotée pour le mois (à partir du 3, si elle servait le mois précédent) ;
//  - stock de chemises bas (au plus une fois par semaine et par couleur).
const notif = require("../notifications");
const { etatStock } = require("../stockChemises");

async function executerJobNotificationsRelances(pool, maintenant = new Date()) {
  const jourSemaine = maintenant.getUTCDay();
  if (jourSemaine === 0 || jourSemaine === 6) return { week_end: true };
  const bilan = { depenses: 0, apres_coup: 0, etats: 0, taches: 0, escalades: 0, etat_a_soumettre: 0, caisse: 0, stock: 0 };
  const echu = (depuis) => notif.heuresOuvrees(depuis, maintenant) >= 48;
  const decideurs = await notif.titulairesPermission("depenses.decision");

  // 1. Dépenses soumises en attente de décision
  const { rows: soumises } = await pool.query("SELECT id, cree_le FROM depenses WHERE statut = 'soumise' AND cree_le < now() - interval '48 hours'");
  const nSoumises = soumises.filter((d) => echu(d.cree_le)).length;
  if (nSoumises) {
    await notif.notifier({ type: "depenses_en_attente", destinataires: decideurs, ref: "depenses_en_attente", cle: "depenses_en_attente",
      mode: "remplacer", aTraiter: true, charge: { n: nSoumises } });
    bilan.depenses = nSoumises;
  }
  // 2. Dépenses engagées à valider après coup (chaque décideur ne compte pas ses propres engagements)
  const { rows: engagees } = await pool.query(
    "SELECT id, engagee_par, engagee_le FROM depenses WHERE apres_coup_statut = 'a_valider' AND annulee_le IS NULL AND engagee_le < now() - interval '48 hours'");
  const echuesEngagees = engagees.filter((d) => echu(d.engagee_le));
  for (const idDecideur of decideurs) {
    const n = echuesEngagees.filter((d) => d.engagee_par !== idDecideur).length;
    if (n) {
      await notif.notifier({ type: "apres_coup_en_attente", destinataires: [idDecideur], ref: "apres_coup_en_attente", cle: "apres_coup_en_attente",
        mode: "remplacer", aTraiter: true, charge: { n } });
      bilan.apres_coup += n;
    }
  }
  // 3. États de charges soumis qui attendent des décisions
  const { rows: etats } = await pool.query(
    `SELECT e.id, e.mois::text AS mois, e.soumis_le FROM etats_charges e
     WHERE e.statut = 'soumis' AND e.soumis_le < now() - interval '48 hours'
       AND EXISTS (SELECT 1 FROM etats_charges_lignes l WHERE l.etat_id = e.id AND l.decision = 'en_attente')`);
  for (const e of etats.filter((x) => echu(x.soumis_le))) {
    await notif.notifier({ type: "etat_en_attente", destinataires: decideurs, ref: e.id, cle: "etat_en_attente:" + e.id, mode: "remplacer", aTraiter: true, charge: { mois: e.mois } });
    bilan.etats++;
  }
  // 4. Tâches en retard : cloche au responsable (une fois), puis escalade à celui qui l'a confiée (une fois)
  const { rows: taches } = await pool.query(
    `SELECT t.id, t.responsable_id, t.cree_par, t.dossier_id, (t.echeance + 1)::timestamptz AS en_retard_depuis
     FROM taches t WHERE t.statut NOT IN ('termine','annule') AND t.echeance IS NOT NULL AND t.echeance < current_date`);
  for (const t of taches) {
    const dossier = await notif.numeroDossier(t.dossier_id, pool);
    if (t.responsable_id && !(await notif.dejaNotifie("tache_retard", t.id))) {
      await notif.notifier({ type: "tache_retard", destinataires: [t.responsable_id], ref: t.id, aTraiter: true, charge: { dossier } });
      bilan.taches++;
    }
    if (t.cree_par && t.cree_par !== t.responsable_id && echu(t.en_retard_depuis) && !(await notif.dejaNotifie("tache_retard_escalade", t.id))) {
      await notif.notifier({ type: "tache_retard_escalade", destinataires: [t.cree_par], ref: t.id, aTraiter: true, charge: { dossier } });
      bilan.escalades++;
    }
  }
  // 5. État de charges du mois à soumettre (à partir du 25)
  const jourMois = maintenant.getUTCDate();
  const moisCourant = maintenant.toISOString().slice(0, 7);
  if (jourMois >= 25) {
    const { rows: [etat] } = await pool.query("SELECT id, statut, prepare_par FROM etats_charges WHERE mois = $1::date", [moisCourant + "-01"]);
    if (!etat || etat.statut === "en_preparation") {
      const preparateurs = etat && etat.prepare_par
        ? [etat.prepare_par]
        : (await pool.query("SELECT id FROM utilisateurs WHERE actif AND role = 'admin_general'")).rows.map((r) => r.id);
      if (!(await notif.dejaNotifie("etat_a_soumettre", moisCourant, 31))) {
        const crees = await notif.notifier({ type: "etat_a_soumettre", destinataires: preparateurs, ref: moisCourant, aTraiter: true, charge: { mois: moisCourant } });
        bilan.etat_a_soumettre = crees.length;
      }
    }
  }
  // 6. Petite caisse non dotée pour le mois (à partir du 3, seulement si elle servait le mois précédent)
  if (jourMois >= 3) {
    const { rows: [dot] } = await pool.query(
      `SELECT (SELECT count(*) FROM dotations_petite_caisse WHERE caisse = 'petite_caisse' AND date_trunc('month', mois) = date_trunc('month', now())) AS courante,
              (SELECT count(*) FROM dotations_petite_caisse WHERE caisse = 'petite_caisse' AND date_trunc('month', mois) = date_trunc('month', now() - interval '1 month')) AS precedente`);
    if (Number(dot.courante) === 0 && Number(dot.precedente) > 0 && !(await notif.dejaNotifie("caisse_alerte", "non_dotee:" + moisCourant))) {
      const crees = await notif.notifier({ type: "caisse_alerte", destinataires: await notif.titulairesPermissions(["depenses.petite_caisse.doter", "depenses.decision"]),
        ref: "non_dotee:" + moisCourant, charge: { sujet: "non_dotee" } });
      bilan.caisse = crees.length;
    }
  }
  // 7. Stock de chemises bas
  const stockInitialise = (await pool.query("SELECT 1 FROM stock_chemises_mouvements WHERE type = 'initial' LIMIT 1")).rowCount > 0;
  const gestionnaires = await notif.titulairesPermission("stock.chemises.gerer");
  for (const c of stockInitialise ? await etatStock(pool) : []) {
    if (c.bas && !(await notif.dejaNotifie("stock_bas", c.couleur, 7))) {
      await notif.notifier({ type: "stock_bas", destinataires: gestionnaires, ref: c.couleur, charge: { couleur: c.couleur } });
      bilan.stock++;
    }
  }
  return bilan;
}

module.exports = { executerJobNotificationsRelances };
