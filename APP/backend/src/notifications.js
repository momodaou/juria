// JURIA — centre de notifications dans l'application (lot 1, 07/11/2026).
//
// notifier() crée une ligne par destinataire, la pousse en direct (même flux SSE que la messagerie) et ne lève
// JAMAIS d'erreur : une notification est un confort, elle ne doit jamais faire échouer l'action métier.
// Le texte est composé à l'affichage (composerTexte) : la base ne garde que (type, charge, nombre). Depuis la revue du
// 12/11/2026, le texte de la cloche (écran protégé) peut porter un montant ou un nom d'avocat ; la BULLE du système, visible
// de l'extérieur, reste neutre (texteBulle) : jamais de montant, de nom de client ni de contenu.
const { pool } = require("./db");
const bus = require("./messagerie-bus");

// Catalogue : niveau par défaut, délai du repli par e-mail (en jours ouvrés × 24 h : voir heuresOuvrees), texte et lien.
// repliHeures = null : jamais d'e-mail de repli pour ce type.
// Nom de la deuxième caisse (lot D) : un seul endroit à changer.
const NOM_CAISSE_PROCEDURE = "la caisse frais de justice & débours";
const nomCaisse = (c) => (c && c.caisse === "procedure" ? "la caisse frais de justice & débours" : "la petite caisse");
const laCaisse = (c) => (c && c.caisse === "procedure" ? NOM_CAISSE_PROCEDURE : "la petite caisse");

const fcfa = (n) => `${Number(n).toLocaleString("fr-FR")} FCFA`;
const doss = (c) => (c.dossier ? ` — dossier ${c.dossier}` : "");
const lienTache = (c) => (c.ref ? `/plan-action?tache=${c.ref}` : "/plan-action");
const lienDili = (c) => (c.ref ? `/role-audience?diligence=${c.ref}` : "/role-audience");
const lienDepense = (c) => (c.ref ? `/depenses?depense=${c.ref}` : "/depenses");
const lienEtat = (c) => (c.ref ? `/depenses/etat-charges?etat=${c.ref}` : "/depenses/etat-charges");
const jours = (n) => `${n} jour${n > 1 ? "s" : ""}`;
const resultatConflit = (d) => (d === "accepte" ? "accepté" : d === "refuse" ? "refusé" : d === "valide" ? "validé" : "orienté");

// Revue du 12/11/2026 : aucun e-mail de repli automatique (repliHeures absent) ; texte de cloche pouvant porter un montant ou un
// nom d'avocat ; bulle du système (bulle: true) toujours avec un texte neutre (texteBulle) ; texteDeja = ligne « déjà traitée par ».
const CATALOGUE = {
  // --- Tâches et diligences ---
  tache_assignee: { niveau: "action", texte: (c) => (c.par ? `${c.par} vous confie une tâche${doss(c)}.` : `Une tâche vous est confiée${doss(c)}.`), lien: lienTache },
  tache_veille: { niveau: "action", texte: (c) => `Une tâche arrive à échéance demain${doss(c)}.`, lien: lienTache },
  tache_retard: { niveau: "action", texte: (c) => `Une tâche est en retard${doss(c)}.`, lien: lienTache },
  tache_retard_escalade: { niveau: "critique", bulle: true, texteBulle: "Une tâche que vous avez confiée est en retard.", texte: (c) => `Une tâche que vous avez confiée est en retard depuis plus de 48 heures${doss(c)}.`, lien: lienTache },
  taches_cabinet_retard: { niveau: "information", texte: (c) => `${c.n > 1 ? c.n + " tâches du cabinet sont" : "Une tâche du cabinet est"} en retard depuis plus de 48 heures.`, lien: () => "/plan-action?filtre=retard" },
  diligence_assignee: { niveau: "action", texte: (c) => `${c.par ? c.par + " vous confie une diligence" : "Une diligence vous est confiée"}${c.date ? " (le " + jourFr(c.date) + ")" : ""}${doss(c)}.`, lien: lienDili },
  diligence_veille: { niveau: "action", texte: (c) => `Une diligence est prévue demain${doss(c)}.`, lien: lienDili },
  diligence_modifiee: { niveau: "information", texte: (c, n) => (n > 1 ? `${n} diligences qui vous sont confiées ont été reportées ou annulées.` : `${c.par ? c.par + " a " + (c.statut === "annule" ? "annulé" : "reporté") + " une diligence" : "Une diligence qui vous est confiée a été " + (c.statut === "annule" ? "annulée" : "reportée")}${doss(c)}.`), lien: (c, n) => (n > 1 ? "/role-audience" : lienDili(c)) },
  relance_action: { niveau: "action", texte: (c) => `${c.par || "Quelqu'un"} vous relance sur ${c.cible === "diligence" ? "une diligence" : "une tâche"}${doss(c)}${c.mot ? " : « " + c.mot + " »" : "."}`, lien: (c) => (c.cible === "diligence" ? lienDili(c) : lienTache(c)) },
  // --- Délais de procédure ---
  delai_procedure: { niveau: "action", bulle: true, texteBulle: "Un délai de procédure approche.", texte: (c) => (c.jours === 0 ? "Un délai de procédure expire aujourd'hui" : `Un délai de procédure expire dans ${jours(c.jours)}`) + (c.dossier ? ` — dossier ${c.dossier}.` : "."), lien: (c) => (c.dossier_id ? `/dossiers/${c.dossier_id}${c.ref ? "?evenement=" + c.ref : ""}` : "/echeancier") },
  // --- Conflits d'intérêts ---
  conflit_a_decider: { niveau: "action", bulle: true, texteBulle: "Un contrôle de conflit attend votre décision.", texte: () => "Un contrôle de conflit d'intérêts attend votre décision.", texteDeja: (c, d, moi) => (moi ? `Tranché par vous : ${resultatConflit(d.decision)}.` : `Déjà tranché par ${d.par} : ${resultatConflit(d.decision)}.`), lien: (c) => (c.ref ? `/conflits?id=${c.ref}` : "/conflits") },
  conflit_tranche: { niveau: "information", texte: (c) => `${c.par ? c.par + " a tranché" : "Votre contrôle de conflit est tranché"} : ${resultatConflit(c.decision)}.`, lien: (c) => (c.decision === "accepte" ? "/ouverture" : c.ref ? `/conflits?id=${c.ref}` : "/ouverture") },
  // --- Dossiers ---
  dossier_cree: { niveau: "information", texte: (c, n) => (n > 1 ? `${n} nouveaux dossiers ont été créés aujourd'hui.` : `${c.par ? c.par + " a créé un" : "Un"} nouveau dossier${c.par ? "" : " a été créé"}${c.dossier ? " : " + c.dossier : ""}.`), lien: (c, n) => (n <= 1 && c.dossier_id ? `/dossiers/${c.dossier_id}` : "/dossiers") },
  // --- Dépenses (circuit) ---
  depense_soumise: { niveau: "action", bulle: true, texteBulle: "Des dépenses attendent votre décision.", texte: (c) => (c.n > 1 ? `${c.n} dépenses attendent votre décision.` : "Une dépense attend votre décision."), texteDeja: (c, d, moi) => (moi ? "Décidée par vous." : `Déjà décidée par ${d.par}.`), lien: (c) => (c.n > 1 ? "/depenses?statut=soumise" : lienDepense(c)) },
  depenses_en_attente: { niveau: "action", texte: (c) => `${c.n > 1 ? c.n + " dépenses attendent" : "Une dépense attend"} votre décision depuis plus de 48 heures${c.anciennete ? ` (la plus ancienne depuis ${jours(c.anciennete)})` : ""}.`, lien: () => "/depenses?statut=soumise" },
  depense_decidee: { niveau: "information", texte: (c, n) => (c.decision === "validee" ? (n > 1 ? `${n} de vos dépenses ont été validées.` : "Votre dépense a été validée.") : (n > 1 ? `${n} de vos dépenses ont été rejetées.` : `Votre dépense a été rejetée${c.motif ? " : « " + c.motif + " »." : "."}`)), lien: (c, n) => (n > 1 ? "/depenses?onglet=tout" : lienDepense(c)) },
  depenses_a_decaisser: { niveau: "action", texte: (c) => (c.n > 1 ? `${c.n} dépenses validées sont à décaisser${c.anciennete ? ` (la plus ancienne depuis ${jours(c.anciennete)})` : ""}.` : `Une dépense validée est à décaisser${c.anciennete ? ` depuis ${jours(c.anciennete)}` : ""}.`), lien: (c) => (c.n > 1 ? "/depenses?statut=validee" : lienDepense(c)) },
  retro_a_decaisser: { niveau: "action", texte: (c) => (c.n > 1 ? `${c.n} rétrocessions sont à décaisser` : "Une rétrocession est à décaisser") + (c.facture ? ` (facture ${c.facture})` : "") + ".", lien: () => "/retrocessions" },
  depense_decaissee: { niveau: "information", texte: (c, n) => (n > 1 ? `${n} de vos dépenses ont été décaissées.` : c.par ? `${c.par} a décaissé votre dépense.` : "Votre dépense a été décaissée."), lien: (c, n) => (n > 1 ? "/depenses?onglet=tout" : lienDepense(c)) },
  depense_blocage: { niveau: "action", texte: (c) => `Décaissement bloqué${c.montant ? " : " + fcfa(c.montant) : ""}${c.libelle ? ", " + c.libelle : ""}${c.motif ? " : « " + c.motif + " »" : ""}. Nouvel ordre de paiement attendu.`, lien: lienDepense },
  depense_annulee: { niveau: "information", texte: (c, n) => (c.apres_decaissement ? `Une dépense déjà décaissée a été annulée${c.motif ? " : « " + c.motif + " »" : ""} : à régulariser.` : n > 1 ? `${n} dépenses ont été annulées.` : `Une dépense a été annulée${c.motif ? " : « " + c.motif + " »." : "."}`), lien: (c, n) => (n > 1 ? "/depenses?onglet=tout" : lienDepense(c)) },
  // --- Petite caisse et caisse frais de justice ---
  depense_apres_coup: { niveau: "action", texte: (c) => (c.n > 1 ? `${c.n} dépenses engagées sur les caisses attendent votre validation après coup.` : `${c.par || "Un engageur"} a engagé ${c.montant ? fcfa(c.montant) : "une dépense"}${c.categorie ? " (" + c.categorie + ")" : ""} sur ${laCaisse(c)} : validation après coup attendue.`), texteDeja: (c, d, moi) => (moi ? "Validée par vous." : `Déjà validée par ${d.par}.`), lien: (c) => (c.n > 1 ? "/depenses?onglet=caisse&apres_coup=a_valider" : lienDepense(c)) },
  depense_apres_coup_traitee: { niveau: "information", texte: (c, n) => (c.decision === "contestee" ? `Votre dépense${c.montant ? " de " + fcfa(c.montant) : ""}${c.categorie ? " (" + c.categorie + ")" : ""} est contestée${c.motif ? " : « " + c.motif + " »." : "."}` : n > 1 ? `${n} de vos dépenses engagées ont été validées.` : "Votre dépense engagée a été validée."), lien: (c, n) => (n > 1 ? "/depenses?onglet=caisse" : lienDepense(c)) },
  apres_coup_en_attente: { niveau: "action", texte: (c) => `${c.n > 1 ? c.n + " dépenses engagées attendent" : "Une dépense engagée attend"} votre validation après coup depuis plus de 48 heures${c.anciennete ? ` (la plus ancienne depuis ${jours(c.anciennete)})` : ""}.`, lien: () => "/depenses?onglet=caisse&apres_coup=a_valider" },
  caisse_alerte: { niveau: "action", texte: (c) => (c.sujet === "solde_bas" ? `Solde de ${nomCaisse(c)} : ${fcfa(c.solde)} sur ${fcfa(c.dotation)}${c.dotation ? ` (${Math.round((c.solde / c.dotation) * 100)} %)` : ""}.` : c.sujet === "non_dotee" ? `Dotation de ${moisFr(c.mois)} non saisie pour ${nomCaisse(c)}.` : `Écart de ${fcfa(c.ecart)} au rapprochement${c.mois ? " de " + moisFr(c.mois) : ""} de ${nomCaisse(c)}.`), lien: (c) => (c.caisse === "procedure" ? "/depenses?onglet=procedure" : "/depenses?onglet=caisse") },
  caisse_fractionnement: { niveau: "action", texte: (c) => `${c.par || "Un engageur"} a engagé ${c.n || "plusieurs"} dépenses rapprochées sur ${laCaisse(c)} (même bénéficiaire ou même dossier)${c.total ? ", " + fcfa(c.total) + " sur 7 jours" : ""} : à examiner.`, lien: (c) => (c.ref ? `/depenses?depense=${c.ref}` : "/depenses") },
  // --- États mensuels de charges ---
  etat_a_soumettre: { niveau: "action", texte: (c) => (c.lignes > 0 ? `L'état de charges de ${moisFr(c.mois)} est en préparation (${c.lignes} ligne${c.lignes > 1 ? "s" : ""}) : à soumettre aux associés.` : `L'état de charges de ${moisFr(c.mois)} n'est pas encore préparé.`), lien: (c) => (c.mois ? `/depenses/etat-charges?mois=${String(c.mois).slice(0, 7)}` : "/depenses/etat-charges") },
  etat_soumis: { niveau: "action", texte: (c) => (c.decidees > 0 ? `État de charges de ${moisFr(c.mois)} : ${c.decidees} ligne${c.decidees > 1 ? "s" : ""} sur ${c.total} décidée${c.decidees > 1 ? "s" : ""}.` : `L'état de charges de ${moisFr(c.mois)} est soumis : ${c.total || "des"} ligne${c.total > 1 ? "s" : ""}${c.montant ? ", " + fcfa(c.montant) + "," : ""} attend${c.total > 1 ? "ent" : ""} votre décision.`), lien: lienEtat },
  etat_lignes_decidees: { niveau: "information", texte: (c) => (c.decidees >= c.total && c.total > 0 ? `Toutes les lignes de ${moisFr(c.mois)} sont décidées : l'état peut être clos.` : `${moisFr(c.mois).replace(/^./, (x) => x.toUpperCase())} : ${c.decidees} ligne${c.decidees > 1 ? "s" : ""} décidée${c.decidees > 1 ? "s" : ""} sur ${c.total} (${c.approuvees || 0} approuvée${c.approuvees > 1 ? "s" : ""}, ${c.rejetees || 0} rejetée${c.rejetees > 1 ? "s" : ""}, ${c.reportees || 0} reportée${c.reportees > 1 ? "s" : ""}).`), lien: lienEtat },
  etat_clos: { niveau: "information", texte: (c) => `L'état de charges de ${moisFr(c.mois)} est clos${c.total ? " : " + (c.approuvees || 0) + " ligne" + (c.approuvees > 1 ? "s" : "") + " approuvée" + (c.approuvees > 1 ? "s" : "") + (c.montant ? " (" + fcfa(c.montant) + ")" : "") + ", " + (c.rejetees || 0) + " rejetée" + (c.rejetees > 1 ? "s" : "") + ", " + (c.reportees || 0) + " reportée" + (c.reportees > 1 ? "s" : "") + " au mois suivant" : ""}.`, lien: lienEtat },
  etat_rouvert: { niveau: "information", texte: (c) => `L'état de charges de ${moisFr(c.mois)} a été rouvert pour modification : il n'est plus à décider pour le moment.`, lien: lienEtat },
  etat_en_attente: { niveau: "action", texte: (c) => `L'état de charges de ${moisFr(c.mois)} attend vos décisions${c.anciennete ? ` depuis ${jours(c.anciennete)}` : " depuis plus de 48 heures"}${c.restantes ? ` : ${c.restantes} ligne${c.restantes > 1 ? "s" : ""} sur ${c.total} reste${c.restantes > 1 ? "nt" : ""} à décider` : ""}.`, lien: lienEtat },
  // --- Facturation ---
  facturation_impayes: { niveau: "action", texte: (c) => `${c.n > 1 ? c.n + " factures impayées" : "Une facture impayée"} depuis plus de 60 jours${c.montant ? " (" + fcfa(c.montant) + ")" : ""}${c.j90 ? `, dont ${c.j90} depuis plus de 90 jours` : ""}.`, lien: () => "/facturation?statut=impayees" },
  facturation_a_facturer: { niveau: "action", texte: (c) => `${c.n > 1 ? c.n + " dossiers" : "Un dossier"} à facturer${c.toujours_pas ? ` (dont ${c.toujours_pas} toujours pas facturé${c.toujours_pas > 1 ? "s" : ""} depuis plus de 60 jours)` : ""}.`, lien: () => "/dossiers?honoraires=a_relancer" },
  // --- Stock et vignettes ---
  stock_bas: { niveau: "information", texte: (c) => (c.couleurs && c.couleurs.length > 1 ? `Le stock de ${c.couleurs.length} couleurs de chemises est bas : ${c.couleurs.map((x) => x.couleur + " (" + x.quantite + ")").join(", ")}.` : c.couleurs && c.couleurs[0] ? `Stock de chemises ${c.couleurs[0].couleur} bas : ${c.couleurs[0].quantite} restante${c.couleurs[0].quantite > 1 ? "s" : ""} (seuil ${c.couleurs[0].seuil}).` : "Le stock de chemises est bas."), lien: () => "/cabinet" },
  vignette_a_affecter: { niveau: "action", texte: (c) => (c.n > 1 ? `${c.n} procédures attendent leur vignette de plaidoirie${c.en_retard ? `, dont ${c.en_retard} depuis plus de 3 jours` : ""}.` : `Une procédure attend sa vignette de plaidoirie${c.en_retard ? " depuis plus de 3 jours" : ""}${doss(c)}.`), lien: (c) => (c.n <= 1 && c.dossier_id ? `/dossiers/${c.dossier_id}` : "/depenses?onglet=procedure") },
  vignette_stock_bas: { niveau: "information", texte: (c) => `Stock de vignettes de plaidoirie bas${c.stock != null ? ` : ${c.stock} restante${c.stock > 1 ? "s" : ""}${c.seuil != null ? " (seuil " + c.seuil + ")" : ""}` : ""}.`, lien: () => "/depenses?onglet=procedure" },
  // --- Rappel d'activation (cloche) ---
};

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function moisFr(m) {
  const mt = /^(\d{4})-(\d{2})/.exec(String(m || ""));
  return mt ? `${MOIS[Number(mt[2]) - 1]} ${mt[1]}` : "ce mois";
}

const jourFr = (d) => String(d).slice(0, 10).split("-").reverse().join("/");

function composerTexte(n) {
  const def = CATALOGUE[n.type];
  const charge = n.charge || {};
  return def ? def.texte(charge, n.nombre || 1) : "Nouvelle notification.";
}

function composerLien(n) {
  if (n.lien) return n.lien;
  const def = CATALOGUE[n.type];
  return def ? def.lien(n.charge || {}, n.nombre || 1) : null;
}

// Forme envoyée à l'écran (liste et flux en direct).
// Texte de la ligne quand un autre a déjà agi (« Déjà tranché par Me X ») : charge.deja = { par, par_id, decision }.
function composerTexteTraite(n) {
  const def = CATALOGUE[n.type];
  const d = (n.charge || {}).deja;
  if (!def || !d || !def.texteDeja) return null;
  return def.texteDeja(n.charge || {}, d, d.par_id && d.par_id === n.destinataire_id);
}

// Libellé neutre pour la bulle du système (aucun montant, nom de client ni contenu) ; null = pas de bulle pour ce type.
const TEXTE_BULLE_DEFAUT = "Une notification demande votre attention.";
function composerTexteBulle(n) {
  const def = CATALOGUE[n.type];
  if (!def || !def.bulle) return null;
  return typeof def.texteBulle === "function" ? def.texteBulle(n.charge || {}, n.nombre || 1) : (def.texteBulle || TEXTE_BULLE_DEFAUT);
}

function presenter(n) {
  const traite = !!n.traitee_le;
  return {
    id: n.id, type: n.type, niveau: n.niveau, texte: (traite && composerTexteTraite(n)) || composerTexte(n), lien: composerLien(n),
    nombre: n.nombre, a_traiter: n.a_traiter && !n.traitee_le, cree_le: n.cree_le, lue_le: n.lue_le, traitee_le: n.traitee_le,
    texte_bulle: composerTexteBulle(n), rouge: !!(n.charge && n.charge.rouge),
  };
}

// destinataires : tableau d'identifiants (doublons et valeurs vides ignorés). auteurId est toujours exclu (on ne
// prévient jamais quelqu'un de sa propre action). cle : regroupement. ref : référence métier (ex. id de la tâche), utilisée
// pour marquer « traitée » quand l'action est accomplie (traiter()).
async function notifier({ type, destinataires, auteurId = null, charge = {}, ref = null, niveau = null, aTraiter = false, cle = null, lien = null, mode = "incrementer", db = pool }) {
  const def = CATALOGUE[type];
  if (!def) { console.error("Notification : type inconnu", type); return []; }
  try {
    const ids = [...new Set((destinataires || []).filter(Boolean))].filter((id) => id !== auteurId);
    if (!ids.length) return [];
    const { rows: actifs } = await db.query("SELECT id FROM utilisateurs WHERE id = ANY($1::uuid[]) AND actif", [ids]);
    const crees = [];
    const chargeFinale = { ...charge, ...(ref ? { ref: String(ref) } : {}) };
    for (const { id } of actifs) {
      let n = null;
      if (cle && mode === "maj") {
        // Met à jour la ligne ouverte existante SANS la remettre en non lue ni la remonter (avancement d'un état, etc.).
        const { rows: [ex] } = await db.query(
          `UPDATE notifications SET type = $3, niveau = $4, charge = $5::jsonb, lien = $6
           WHERE id = (SELECT id FROM notifications WHERE destinataire_id = $1 AND cle_regroupement = $2 AND traitee_le IS NULL ORDER BY cree_le DESC LIMIT 1)
           RETURNING *`,
          [id, cle, type, niveau || def.niveau, JSON.stringify(chargeFinale), lien]);
        if (ex) { crees.push(ex); await bus.publier(db, [id], { type: "notification", notification: presenter(ex) }); }
        continue;
      }
      if (cle && mode === "remplacer") {
        // Une seule ligne par objet et par personne : on met à jour la dernière, même déjà lue (remise en non lue, en tête).
        const { rows: [ex] } = await db.query(
          `UPDATE notifications SET type = $3, niveau = $4, charge = $5::jsonb, lien = $6, a_traiter = $7, nombre = 1,
                  cree_le = now(), lue_le = NULL, traitee_le = NULL, repli_envoye_le = NULL
           WHERE id = (SELECT id FROM notifications WHERE destinataire_id = $1 AND cle_regroupement = $2 ORDER BY cree_le DESC LIMIT 1)
           RETURNING *`,
          [id, cle, type, niveau || def.niveau, JSON.stringify(chargeFinale), lien, !!aTraiter]);
        n = ex || null;
      }
      if (!n) {
        ({ rows: [n] } = await db.query(
          `INSERT INTO notifications (destinataire_id, type, niveau, charge, lien, cle_regroupement, a_traiter)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
           ON CONFLICT (destinataire_id, cle_regroupement) WHERE cle_regroupement IS NOT NULL AND lue_le IS NULL
           DO UPDATE SET nombre = notifications.nombre + 1, cree_le = now(), charge = EXCLUDED.charge
           RETURNING *`,
          [id, type, niveau || def.niveau, JSON.stringify(chargeFinale), lien, cle, !!aTraiter]));
      }
      crees.push(n);
      await bus.publier(db, [id], { type: "notification", notification: presenter(n) });
    }
    return crees;
  } catch (e) {
    console.error("Notification non créée (action métier non affectée) :", e.message);
    return [];
  }
}

// Marque « traitée » toutes les notifications à traiter d'un type donné pour une référence (la tâche est terminée, le
// conflit est tranché…). Informe aussi les écrans ouverts pour que la marque « à traiter » disparaisse.
async function traiter(types, ref, db = pool, deja = null) {
  try {
    const liste = Array.isArray(types) ? types : [types];
    const { rows } = await db.query(
      `UPDATE notifications SET traitee_le = now(),
              charge = CASE WHEN $3::jsonb IS NULL THEN charge ELSE charge || jsonb_build_object('deja', $3::jsonb) END
       WHERE type = ANY($1::text[]) AND charge->>'ref' = $2 AND a_traiter AND traitee_le IS NULL
       RETURNING *`, [liste, String(ref), deja ? JSON.stringify(deja) : null]);
    for (const r of rows) {
      await bus.publier(db, [r.destinataire_id], { type: "notification_traitee", id: r.id });
      if (deja) await bus.publier(db, [r.destinataire_id], { type: "notification", notification: presenter(r) });
    }
    return rows.length;
  } catch (e) {
    console.error("Notification : marquage « traitée » impossible :", e.message);
    return 0;
  }
}

// Ferme la ligne regroupée d'un décompte quand il retombe à zéro (cle = clé de regroupement).
async function fermerParCle(cle, destinataires, db = pool) {
  try {
    const { rows } = await db.query(
      `UPDATE notifications SET traitee_le = now(), a_traiter = a_traiter
       WHERE cle_regroupement = $1 AND destinataire_id = ANY($2::uuid[]) AND traitee_le IS NULL AND a_traiter RETURNING id, destinataire_id`,
      [cle, destinataires]);
    for (const r of rows) await bus.publier(db, [r.destinataire_id], { type: "notification_traitee", id: r.id });
    return rows.length;
  } catch (e) { console.error("Notification : fermeture impossible :", e.message); return 0; }
}

// Notification « décompte » : chaque personne reçoit UNE ligne « N … » mise à jour (n peut différer d'une personne à l'autre :
// compteur(id) → { n, ...charge }) ; quand n tombe à 0 la ligne est fermée.
async function decompte({ type, cle, destinataires, compteur, aTraiter = true, ref = null, db = pool }) {
  const ids = [...new Set((destinataires || []).filter(Boolean))];
  for (const id of ids) {
    const c = await compteur(id);
    if (!c || !c.n) { await fermerParCle(cle, [id], db); continue; }
    const { n, ...charge } = c;
    await notifier({ type, destinataires: [id], cle, mode: "remplacer", aTraiter, ref, charge: { ...charge, n }, db });
  }
}

// Nom affiché d'une personne dans un texte : « Me X » pour les avocats, le nom seul sinon.
const ROLES_AVOCATS = ["associe", "associe_fondateur", "of_counsel", "collaborateur", "avocat_stagiaire"];
function nomAffiche(user) {
  if (!user || !user.nom) return "Un membre du cabinet";
  const nom = String(user.nom).replace(/^Me\s+/i, "").trim();
  return ROLES_AVOCATS.includes(user.role) ? `Me ${nom}` : nom;
}

// Interrupteur général des e-mails de notification (parametres_cabinet.notifications_email_actif, FALSE par défaut).
async function emailsActifs(db = pool) {
  try {
    const { rows: [r] } = await db.query("SELECT notifications_email_actif AS actif FROM parametres_cabinet WHERE id = 1");
    return !!(r && r.actif);
  } catch (e) { return false; }
}

// Numéro d'un dossier (pour le texte minimal des notifications) ; null si absent.
async function numeroDossier(dossierId, db = pool) {
  if (!dossierId) return null;
  try {
    const { rows: [r] } = await db.query("SELECT numero FROM dossiers WHERE id = $1", [dossierId]);
    return r ? r.numero : null;
  } catch (e) { return null; }
}

// Une notification de ce type pour cette référence existe-t-elle déjà (n'importe quel destinataire, depuis `jours` jours) ?
// Sert aux alertes qui ne doivent partir qu'une fois (solde bas du mois, stock bas…).
async function dejaNotifie(type, ref, jours = 3650, db = pool) {
  const { rows } = await db.query(
    "SELECT 1 FROM notifications WHERE type = $1 AND charge->>'ref' = $2 AND cree_le > now() - ($3 || ' days')::interval LIMIT 1", [type, String(ref), String(jours)]);
  return rows.length > 0;
}

// Union de plusieurs permissions (ex. ceux qui dotent la petite caisse et ceux qui décident).
async function titulairesPermissions(codes, db = pool) {
  const ids = new Set();
  for (const c of codes) for (const id of await titulairesPermission(c, db)) ids.add(id);
  return [...ids];
}

// Titulaires d'une permission de la Matrice (comptes actifs).
async function titulairesPermission(code, db = pool) {
  const { rows } = await db.query(
    `SELECT u.id FROM utilisateurs u JOIN permissions_role pr ON pr.role = u.role AND pr.action_code = $1 AND pr.autorise = TRUE
     WHERE u.actif`, [code]);
  return rows.map((r) => r.id);
}

// Nombre d'heures « ouvrées » entre deux instants : les samedis et dimanches (UTC, fuseau de Bamako) ne comptent pas.
function heuresOuvrees(debut, fin) {
  let h = 0;
  const d0 = new Date(debut).getTime(), d1 = new Date(fin).getTime();
  for (let t = d0; t < d1; t += 3600000) {
    const jour = new Date(t).getUTCDay();
    if (jour !== 0 && jour !== 6) h += Math.min(3600000, d1 - t) / 3600000;
  }
  return h;
}

// Bouton « Relancer » (tâche ou diligence). Peuvent relancer : le créateur de l'action, le responsable du dossier et les
// associés (associé, associé-fondateur) ; jamais soi-même ; pas pour une action déjà finie ; au plus une relance toutes les
// 4 heures par action. La relance est tracée au journal d'audit. Renvoie { statut, corps } pour la route.
const { logAudit } = require("./audit");
async function relancer({ cible, id, action, mot, user, ip, email = false, db = pool }) {
  // action : { executant_id, cree_par, dossier_id, dossier_responsable_id, termine }
  if (action.termine) return { statut: 409, corps: { error: "Cette action est déjà terminée ou annulée." } };
  if (!action.executant_id) return { statut: 409, corps: { error: "Personne n'est chargé de cette action." } };
  if (action.executant_id === user.sub) return { statut: 400, corps: { error: "Vous ne pouvez pas vous relancer vous-même." } };
  const autorise = action.cree_par === user.sub || action.dossier_responsable_id === user.sub || ["associe", "associe_fondateur"].includes(user.role);
  if (!autorise) return { statut: 403, corps: { error: "Seuls le créateur de l'action, le responsable du dossier et les associés peuvent relancer." } };
  const { rows: [recente] } = await db.query(
    `SELECT 1 FROM journal_audit WHERE action = 'relancer_action' AND entite_id = $1::uuid AND horodatage > now() - interval '4 hours'`, [id]);
  if (recente) return { statut: 429, corps: { error: "Une relance a déjà été envoyée il y a moins de 4 heures." } };
  const texte = mot ? String(mot).trim().slice(0, 200) : "";
  // Une seule ligne par action et par personne : la relance REMPLACE la ligne d'origine (remise en non lue, en tête).
  await notifier({
    type: "relance_action", destinataires: [action.executant_id], auteurId: user.sub, ref: id, aTraiter: true, cle: "action:" + id, mode: "remplacer",
    charge: { cible, dossier: await numeroDossier(action.dossier_id, db), par: nomAffiche(user), mot: texte || undefined },
  });
  if (email) await envoyerEmailRelance([action.executant_id], "Vous avez été relancé(e) sur une action dans JURIA.", db);
  await logAudit({ utilisateurId: user.sub, action: "relancer_action", entite: cible === "diligence" ? "diligences" : "taches", entiteId: id,
    details: { dossier_id: action.dossier_id || null, executant_id: action.executant_id, avec_mot: !!texte }, ip });
  return { statut: 200, corps: { ok: true } };
}

// E-mail de relance, à la demande de la personne qui relance (case « Envoyer aussi par e-mail », décochée par défaut) : respecte
// l'interrupteur général des e-mails de notification ; texte générique, sans nom ni contenu. Jamais bloquant.
async function envoyerEmailRelance(ids, texte, db = pool) {
  try {
    if (!(await emailsActifs(db))) return 0;
    const { rows } = await db.query("SELECT email, prenom FROM utilisateurs WHERE actif AND id = ANY($1::uuid[]) AND email IS NOT NULL AND email <> ''", [ids]);
    const mailer = require("./mailer");
    const base = process.env.FRONTEND_URL || "https://juria-web-552099340909.europe-west1.run.app";
    let n = 0;
    for (const u of rows) {
      const r = await mailer.envoyerEmail({ to: u.email, subject: "JURIA : une relance vous attend",
        html: `<p>Bonjour ${u.prenom},</p><p>${texte}</p><p><a href="${base}">Ouvrir JURIA</a></p><p style="color:#888;font-size:12px">Message automatique — ne pas répondre.</p>` });
      if (r && r.envoye !== false) n++;
    }
    return n;
  } catch (e) { console.error("E-mail de relance impossible (non bloquant) :", e.message); return 0; }
}

// « Relancer les associés » : le créateur d'une demande en attente (conflit, dépense soumise, dépense engagée) renvoie la
// notification aux titulaires de la décision. Une seule ligne par objet et par personne : la relance remplace la ligne
// d'origine ; au plus une relance toutes les 4 heures par objet ; tracée au journal d'audit ; texte générique, sans noms.
async function relancerAssocies({ type, ref, cle, destinataires, charge = {}, user, ip, email = false, entite, miseAJour = null, db = pool }) {
  const { rows: [recente] } = await db.query(
    `SELECT 1 FROM journal_audit WHERE action = 'relancer_associes' AND entite_id = $1::uuid AND horodatage > now() - interval '4 hours'`, [ref]);
  if (recente) return { statut: 429, corps: { error: "Une relance a déjà été envoyée il y a moins de 4 heures." } };
  const ids = (destinataires || []).filter((id) => id && id !== user.sub);
  if (!ids.length) return { statut: 409, corps: { error: "Personne à relancer." } };
  if (miseAJour) await miseAJour(ids);
  else await notifier({ type, destinataires: ids, auteurId: user.sub, ref, aTraiter: true, cle, mode: "remplacer", charge });
  if (email) await envoyerEmailRelance(ids, "Une demande attend votre décision dans JURIA.", db);
  await logAudit({ utilisateurId: user.sub, action: "relancer_associes", entite, entiteId: ref, details: { type: type || null, avec_email: !!email }, ip });
  return { statut: 200, corps: { ok: true } };
}

module.exports = { relancerAssocies, envoyerEmailRelance, fermerParCle, decompte, nomAffiche, composerTexteBulle, moisFr, dejaNotifie, titulairesPermissions, emailsActifs, relancer, CATALOGUE, notifier, traiter, numeroDossier, titulairesPermission, presenter, composerTexte, heuresOuvrees };
