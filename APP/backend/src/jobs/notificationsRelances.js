// JURIA — relances et alertes périodiques du centre de notifications (revue du 12/11/2026). Cloche SEULEMENT : ce job n'envoie
// aucun e-mail. À planifier une fois par jour ouvré (matin) ; jamais le week-end (heures ouvrées : samedi et dimanche ne comptent pas).
//  - dépenses soumises / dépenses engagées à valider / état de charges soumis en attente depuis plus de 48 h ouvrées : une ligne par
//    décideur, mise à jour chaque matin, niveau Action (plus de critique), ancienneté de la plus ancienne dans le texte ;
//  - dépenses à décaisser sans suite après 3 jours ouvrés : rappel à l'administration générale, au comptable ET aux associés ;
//  - tâches : en retard (une fois), la veille de l'échéance (une fois), escalade 48 h au créateur (critique), et une ligne regroupée
//    « N tâches du cabinet en retard depuis plus de 48 h » pour chaque associé ; diligences : la veille de leur date (une fois) ;
//  - état de charges à soumettre dès le 25 (+ second rappel au dernier jour ouvré du mois) ; caisses non dotées pour le mois ;
//  - stock de chemises bas (ligne regroupée, au plus une remontée par semaine) ; vignettes de plaidoirie en attente (décompte).
const notif = require("../notifications");
const notifD = require("../notificationsDepenses");
const { etatStock } = require("../stockChemises");

const LIBELLE_COULEUR = { bleu: "bleue", dore: "dorée", doré: "dorée", rouge: "rouge", vert: "verte", gris: "grise" };
const joursEntre = (d, maintenant) => Math.max(0, Math.floor((maintenant.getTime() - new Date(d).getTime()) / 86400000));

// Prochain jour ouvré après aujourd'hui (le vendredi : samedi à lundi, pour ne pas manquer un lundi).
function fenetreVeille(maintenant) {
  const d = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate()));
  const debut = new Date(d.getTime() + 86400000), fin = new Date(d.getTime() + (maintenant.getUTCDay() === 5 ? 3 : 1) * 86400000);
  const iso = (x) => x.toISOString().slice(0, 10);
  return { debut: iso(debut), fin: iso(fin) };
}
function estDernierJourOuvre(maintenant) {
  const d = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1, 0)); // dernier jour du mois
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return maintenant.getUTCDate() === d.getUTCDate();
}

async function executerJobNotificationsRelances(pool, maintenant = new Date()) {
  const jourSemaine = maintenant.getUTCDay();
  if (jourSemaine === 0 || jourSemaine === 6) return { week_end: true };
  const bilan = { depenses: 0, apres_coup: 0, a_decaisser: 0, etats: 0, taches: 0, escalades: 0, veilles: 0, cabinet_retard: 0, etat_a_soumettre: 0, caisse: 0, stock: 0, vignettes: 0 };
  const echu = (depuis, h = 48) => notif.heuresOuvrees(depuis, maintenant) >= h;
  const decideurs = await notif.titulairesPermission("depenses.decision");
  const { rows: associesRows } = await pool.query("SELECT id FROM utilisateurs WHERE actif AND role IN ('associe','associe_fondateur')");
  const associes = associesRows.map((r) => r.id);
  const { rows: execRows } = await pool.query("SELECT id FROM utilisateurs WHERE actif AND role IN ('admin_general','comptable')");
  const executants = execRows.map((r) => r.id);

  // 1. Dépenses soumises en attente de décision (chaque décideur ne compte pas ses propres soumissions)
  const { rows: soumises } = await pool.query("SELECT id, soumis_par, cree_le FROM depenses WHERE statut = 'soumise' AND annulee_le IS NULL AND cree_le < now() - interval '48 hours'");
  const echuesSoumises = soumises.filter((d) => echu(d.cree_le));
  for (const id of decideurs) {
    const mes = echuesSoumises.filter((d) => d.soumis_par !== id);
    if (mes.length) {
      await notif.notifier({ type: "depenses_en_attente", destinataires: [id], ref: "depenses_en_attente", cle: "depenses_en_attente", mode: "remplacer", aTraiter: true,
        charge: { n: mes.length, anciennete: Math.max(...mes.map((d) => joursEntre(d.cree_le, maintenant))) } });
      bilan.depenses += mes.length;
    } else await notif.fermerParCle("depenses_en_attente", [id]);
  }
  // 2. Dépenses engagées à valider après coup (chaque décideur ne compte pas ses propres engagements)
  const { rows: engagees } = await pool.query(
    "SELECT id, engagee_par, engagee_le FROM depenses WHERE apres_coup_statut = 'a_valider' AND annulee_le IS NULL AND engagee_le < now() - interval '48 hours'");
  const echuesEngagees = engagees.filter((d) => echu(d.engagee_le));
  for (const id of decideurs) {
    const mes = echuesEngagees.filter((d) => d.engagee_par !== id);
    if (mes.length) {
      await notif.notifier({ type: "apres_coup_en_attente", destinataires: [id], ref: "apres_coup_en_attente", cle: "apres_coup_en_attente", mode: "remplacer", aTraiter: true,
        charge: { n: mes.length, anciennete: Math.max(...mes.map((d) => joursEntre(d.engagee_le, maintenant))) } });
      bilan.apres_coup += mes.length;
    } else await notif.fermerParCle("apres_coup_en_attente", [id]);
  }
  // 3. Dépenses à décaisser sans suite après 3 jours ouvrés : rappel regroupé à ceux qui décaissent ET aux associés (suppléance)
  const { rows: adec } = await pool.query(
    `SELECT id, ordre_paiement_le FROM depenses WHERE statut = 'validee' AND ordre_paiement_le IS NOT NULL AND blocage_le IS NULL AND annulee_le IS NULL
       AND ordre_paiement_le < now() - interval '72 hours'`);
  const enRetardDec = adec.filter((d) => echu(d.ordre_paiement_le, 72));
  const permisDec = await notif.titulairesPermission("depenses.decaisser");
  if (enRetardDec.length) {
    const charge = { n: enRetardDec.length, anciennete: Math.max(...enRetardDec.map((d) => joursEntre(d.ordre_paiement_le, maintenant))), ...(enRetardDec.length === 1 ? { ref: enRetardDec[0].id } : {}) };
    const dests = [...new Set([...executants, ...associes])].filter((id) => permisDec.includes(id));
    for (const id of dests) {
      await notif.notifier({ type: "depenses_a_decaisser", destinataires: [id], cle: "depenses_a_decaisser", mode: "remplacer", aTraiter: true, charge });
    }
    bilan.a_decaisser = enRetardDec.length;
  }
  // 4. États de charges soumis qui attendent des décisions (avancement dans le texte)
  const { rows: etats } = await pool.query(
    `SELECT e.id, e.mois::text AS mois, e.soumis_le,
            count(*) FILTER (WHERE l.decision = 'en_attente')::int AS restantes, count(*)::int AS total
       FROM etats_charges e JOIN etats_charges_lignes l ON l.etat_id = e.id
      WHERE e.statut = 'soumis' AND e.soumis_le < now() - interval '48 hours' GROUP BY e.id HAVING count(*) FILTER (WHERE l.decision = 'en_attente') > 0`);
  for (const e of etats.filter((x) => echu(x.soumis_le))) {
    await notif.notifier({ type: "etat_en_attente", destinataires: decideurs, ref: e.id, cle: "etat_en_attente:" + e.id, mode: "remplacer", aTraiter: true,
      charge: { mois: e.mois, anciennete: joursEntre(e.soumis_le, maintenant), restantes: e.restantes, total: e.total } });
    bilan.etats++;
  }
  // 5. Tâches : en retard (une fois), la veille de l'échéance (une fois), escalade 48 h au créateur (critique, une fois)
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
  const { debut, fin } = fenetreVeille(maintenant);
  const { rows: veilleT } = await pool.query(
    "SELECT id, responsable_id, dossier_id FROM taches WHERE statut NOT IN ('termine','annule') AND responsable_id IS NOT NULL AND echeance BETWEEN $1::date AND $2::date", [debut, fin]);
  for (const t of veilleT) {
    if (await notif.dejaNotifie("tache_veille", t.id)) continue;
    await notif.notifier({ type: "tache_veille", destinataires: [t.responsable_id], ref: t.id, aTraiter: true, charge: { dossier: await notif.numeroDossier(t.dossier_id, pool) } });
    bilan.veilles++;
  }
  // 5 bis. Diligences : la veille de leur date (une fois)
  const { rows: veilleD } = await pool.query(
    "SELECT id, membre_id, dossier_id FROM diligences WHERE statut = 'a_faire' AND membre_id IS NOT NULL AND date_diligence BETWEEN $1::date AND $2::date", [debut, fin]);
  for (const d of veilleD) {
    if (await notif.dejaNotifie("diligence_veille", d.id)) continue;
    await notif.notifier({ type: "diligence_veille", destinataires: [d.membre_id], ref: d.id, aTraiter: true, charge: { dossier: await notif.numeroDossier(d.dossier_id, pool) } });
    bilan.veilles++;
  }
  // 5 ter. Tâches du cabinet en retard depuis plus de 48 h : une ligne d'information regroupée pour chaque associé (tout le cabinet)
  const { rows: retardCabinet } = await pool.query(
    "SELECT (echeance + 1)::timestamptz AS depuis FROM taches WHERE statut NOT IN ('termine','annule') AND echeance IS NOT NULL AND echeance < current_date");
  const nCabinet = retardCabinet.filter((t) => echu(t.depuis)).length;
  for (const id of associes) {
    if (!nCabinet) { await notif.fermerParCle("taches_cabinet_retard", [id]); continue; }
    const charge = { n: nCabinet, ref: "taches_cabinet_retard" };
    const maj = await notif.notifier({ type: "taches_cabinet_retard", destinataires: [id], cle: "taches_cabinet_retard", mode: "maj", charge });
    if (!maj.length) await notif.notifier({ type: "taches_cabinet_retard", destinataires: [id], cle: "taches_cabinet_retard", mode: "remplacer", charge });
    bilan.cabinet_retard = nCabinet;
  }
  // 6. État de charges du mois à soumettre : dès le 25 (premier jour ouvré qui suit), second rappel au dernier jour ouvré du mois
  const jourMois = maintenant.getUTCDate();
  const moisCourant = maintenant.toISOString().slice(0, 7);
  if (jourMois >= 25) {
    const { rows: [etat] } = await pool.query("SELECT id, statut, prepare_par FROM etats_charges WHERE mois = $1::date", [moisCourant + "-01"]);
    if (!etat || etat.statut === "en_preparation") {
      const preparateurs = etat && etat.prepare_par ? [etat.prepare_par] : executants;
      const { rows: [nl] } = etat ? await pool.query("SELECT count(*)::int AS n FROM etats_charges_lignes WHERE etat_id = $1", [etat.id]) : { rows: [{ n: 0 }] };
      const premier = !(await notif.dejaNotifie("etat_a_soumettre", moisCourant, 31));
      let second = false;
      if (!premier && estDernierJourOuvre(maintenant)) {
        const { rows: dejaSecond } = await pool.query(
          "SELECT 1 FROM notifications WHERE type = 'etat_a_soumettre' AND charge->>'ref' = $1 AND charge->>'rappel' = '2' AND cree_le > now() - interval '31 days' LIMIT 1", [moisCourant]);
        second = !dejaSecond.length;
      }
      if (premier || second) {
        const crees = await notif.notifier({ type: "etat_a_soumettre", destinataires: preparateurs, ref: moisCourant, aTraiter: true, cle: "etat_a_soumettre:" + moisCourant, mode: "remplacer",
          charge: { mois: moisCourant, lignes: nl.n, ...(second ? { rappel: "2" } : {}) } });
        bilan.etat_a_soumettre = crees.length;
      }
    }
  }
  // 7. Caisses non dotées pour le mois (à partir du 3, seulement si la caisse servait le mois précédent)
  if (jourMois >= 3) {
    for (const caisse of ["petite_caisse", "procedure"]) {
      const { rows: [dot] } = await pool.query(
        `SELECT (SELECT count(*) FROM dotations_petite_caisse WHERE caisse = $1 AND date_trunc('month', mois) = date_trunc('month', now())) AS courante,
                (SELECT count(*) FROM dotations_petite_caisse WHERE caisse = $1 AND date_trunc('month', mois) = date_trunc('month', now() - interval '1 month')) AS precedente`, [caisse]);
      const ref = "non_dotee:" + caisse + ":" + moisCourant;
      if (Number(dot.courante) === 0 && Number(dot.precedente) > 0 && !(await notif.dejaNotifie("caisse_alerte", ref))) {
        const crees = await notif.notifier({ type: "caisse_alerte", destinataires: await notif.titulairesPermissions(["depenses.petite_caisse.doter", "depenses.decision"]),
          ref, aTraiter: true, cle: "caisse:" + caisse + ":non_dotee", mode: "remplacer", charge: { sujet: "non_dotee", caisse, mois: moisCourant } });
        bilan.caisse += crees.length;
      }
    }
  }
  // 8. Stock de chemises bas : UNE ligne regroupée par couleurs, remontée au plus une fois par semaine ; Action quand une couleur est à zéro
  const stockInitialise = (await pool.query("SELECT 1 FROM stock_chemises_mouvements WHERE type = 'initial' LIMIT 1")).rowCount > 0;
  const gestionnaires = await notif.titulairesPermission("stock.chemises.gerer");
  const bas = (stockInitialise ? await etatStock(pool) : []).filter((c) => c.bas);
  if (!bas.length) await notif.fermerParCle("stock_chemises_bas", gestionnaires);
  else {
    const charge = { ref: "chemises", couleurs: bas.map((c) => ({ couleur: LIBELLE_COULEUR[c.couleur] || c.couleur, quantite: c.quantite, seuil: c.seuil })) };
    const zero = bas.some((c) => c.quantite <= 0);
    const recent = await notif.dejaNotifie("stock_bas", "chemises", 7);
    const opts = { type: "stock_bas", destinataires: gestionnaires, cle: "stock_chemises_bas", charge, niveau: zero ? "action" : "information", aTraiter: zero };
    if (!recent) { await notif.notifier({ ...opts, mode: "remplacer", ref: "chemises" }); bilan.stock++; }
    else await notif.notifier({ ...opts, mode: "maj", ref: "chemises" });
  }
  // 9. Vignettes de plaidoirie en attente (décompte, dont celles en retard depuis plus de 3 jours ouvrés)
  bilan.vignettes = (await notifD.majVignettes(pool)).en_retard;
  return bilan;
}

module.exports = { executerJobNotificationsRelances };
