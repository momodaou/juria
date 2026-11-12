// JURIA — notifications « décompte » du circuit des dépenses (revue du 12/11/2026).
// Une ligne par personne, mise à jour à chaque changement (« N dépenses attendent votre décision ») et fermée quand le décompte
// retombe à zéro. Chaque personne a SON décompte : un associé ne compte jamais ses propres soumissions ni ses propres engagements.
const { pool } = require("./db");
const notif = require("./notifications");
const { libelleCategorie } = require("./categoriesDepense");

const nomDe = (u) => notif.nomAffiche({ nom: [u.prenom, u.nom].filter(Boolean).join(" "), role: u.role });
const joursDepuis = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000));

// Dépenses soumises, en attente de décision des associés (decideurs = titulaires de depenses.decision).
async function majADecider(db = pool) {
  const { rows } = await db.query("SELECT id, soumis_par FROM depenses WHERE statut = 'soumise' AND annulee_le IS NULL");
  const decideurs = await notif.titulairesPermission("depenses.decision", db);
  await notif.decompte({
    type: "depense_soumise", cle: "depenses_a_decider", destinataires: decideurs, db,
    compteur: async (id) => {
      const mes = rows.filter((r) => r.soumis_par !== id);
      return { n: mes.length, ...(mes.length === 1 ? { ref: mes[0].id } : {}) };
    },
  });
}

// Dépenses engagées sur une caisse, à valider après coup par un autre associé.
async function majApresCoup(db = pool) {
  const { rows } = await db.query(
    `SELECT d.id, d.engagee_par, d.montant, d.categorie, d.caisse_procedure, u.prenom, u.nom, u.role
       FROM depenses d JOIN utilisateurs u ON u.id = d.engagee_par
      WHERE d.apres_coup_statut = 'a_valider' AND d.annulee_le IS NULL`);
  const decideurs = await notif.titulairesPermission("depenses.decision", db);
  await notif.decompte({
    type: "depense_apres_coup", cle: "apres_coup_a_valider", destinataires: decideurs, db,
    compteur: async (id) => {
      const mes = rows.filter((r) => r.engagee_par !== id);
      if (mes.length !== 1) return { n: mes.length };
      const d = mes[0];
      return { n: 1, ref: d.id, par: nomDe(d), montant: Number(d.montant), categorie: libelleCategorie(d.categorie).toLowerCase(), caisse: d.caisse_procedure ? "procedure" : "petite_caisse" };
    },
  });
}

// Dépenses validées avec ordre de paiement, à décaisser : l'administration générale et le comptable (première notification).
async function majADecaisser(db = pool) {
  const { rows } = await db.query(
    `SELECT id, COALESCE(ordre_paiement_le, valide_le) AS depuis FROM depenses
      WHERE statut = 'validee' AND ordre_paiement_le IS NOT NULL AND blocage_le IS NULL AND annulee_le IS NULL`);
  const { rows: exec } = await db.query("SELECT id FROM utilisateurs WHERE actif AND role IN ('admin_general','comptable')");
  const permis = await notif.titulairesPermission("depenses.decaisser", db);
  const ids = exec.map((r) => r.id).filter((id) => permis.includes(id));
  await notif.decompte({
    type: "depenses_a_decaisser", cle: "depenses_a_decaisser", destinataires: ids, db,
    compteur: async () => ({ n: rows.length, ...(rows.length === 1 ? { ref: rows[0].id } : {}) }),
  });
}

// Procédures contentieuses qui attendent leur vignette de plaidoirie (jamais de décompte automatique d'un objet numéroté) :
// une ligne « N procédures attendent leur vignette », dont celles en retard (plus de 3 jours ouvrés, ex-rappel fusionné).
async function majVignettes(db = pool) {
  const { rows } = await db.query(
    `SELECT i.id, i.dossier_id, d.numero, i.cree_le
       FROM instances i JOIN dossiers d ON d.id = i.dossier_id
      WHERE d.pole = 'contentieux' AND d.statut NOT IN ('clos','archive') AND i.vignette_dispensee = FALSE
        AND i.cree_le::date >= (SELECT vignettes_suivi_depuis FROM parametres_cabinet WHERE id = 1)
        AND NOT EXISTS (SELECT 1 FROM vignettes_plaidoirie v WHERE v.instance_id = i.id AND v.mouvement = 'utilisation')`);
  const gestionnaires = await notif.titulairesPermission("depenses.vignettes.mouvement", db);
  const enRetard = rows.filter((r) => notif.heuresOuvrees(r.cree_le, new Date()) >= 72);
  await notif.decompte({
    type: "vignette_a_affecter", cle: "vignettes_a_affecter", destinataires: gestionnaires, db,
    compteur: async () => ({
      n: rows.length, en_retard: enRetard.length,
      ...(rows.length === 1 ? { ref: rows[0].id, dossier: rows[0].numero, dossier_id: rows[0].dossier_id } : {}),
    }),
  });
  return { n: rows.length, en_retard: enRetard.length };
}

module.exports = { majADecider, majApresCoup, majADecaisser, majVignettes, nomDe, joursDepuis };
