// JURIA — moyens d'encaissement (20/10/2026). Une seule liste pour tout
// JURIA, et pour chaque moyen les références qui lui sont propres, validées
// côté serveur. Le catalogue est servi tel quel à l'écran, qui construit le
// formulaire d'après lui (aucune liste de champs dupliquée côté frontend).
// Le virement de l'étranger est une variante du virement ; la caisse ne
// reçoit jamais de règlement client ; les espèces sont déposées en banque.

const BANQUES = ["fonctionnement", "carpa"];

const OPERATEURS_MM = ["orange_money", "moov_money", "wave", "sama_money"];

const T = { texte: "texte", date: "date", tel: "tel" };
const champ = (cle, libelle, type = T.texte, requis = false) => ({ cle, libelle, type, requis });

const MOYENS = [
  { code: "virement", libelle: "Virement", famille: "virement", comptes: "banque",
    champs: [champ("date_valeur", "Date de valeur", T.date), champ("numero_operation", "N° de l'opération")] },
  { code: "virement_etranger", libelle: "Virement de l'étranger", famille: "virement", comptes: "banque", frais: true,
    champs: [champ("pays_emetteur", "Pays de l'émetteur", T.texte, true), champ("banque_emettrice", "Banque de l'émetteur", T.texte, true),
      champ("code_swift", "Code SWIFT de l'opération"), champ("date_valeur", "Date de valeur", T.date), champ("numero_operation", "N° de l'opération")] },
  { code: "cheque", libelle: "Chèque", famille: "cheque", comptes: "banque",
    champs: [champ("numero_cheque", "N° du chèque", T.texte, true), champ("banque_emettrice", "Banque émettrice", T.texte, true),
      champ("tireur", "Nom du tireur"), champ("date_cheque", "Date du chèque", T.date), champ("date_remise", "Date de remise en banque", T.date)] },
  { code: "especes", libelle: "Espèces", famille: "especes", comptes: "banque",
    champs: [champ("numero_recu", "N° du reçu délivré")] },
  ...[["orange_money", "Orange Money"], ["moov_money", "Moov Money"], ["wave", "Wave"], ["sama_money", "Sama Money"]].map(([code, libelle]) => ({
    code, libelle, famille: "mobile", comptes: "mobile", frais: true,
    champs: [champ("id_transaction", "Identifiant de la transaction", T.texte, true), champ("numero_emetteur", "Numéro de l'émetteur", T.tel)],
  })),
  ...[["western_union", "Western Union"], ["moneygram", "MoneyGram"]].map(([code, libelle]) => ({
    code, libelle, famille: "transfert", comptes: "banque_ou_mobile", frais: true,
    champs: [champ("code_retrait", "Code de retrait", T.texte, true), champ("expediteur", "Nom de l'expéditeur"), champ("pays_origine", "Pays d'origine")],
  })),
];
const PAR_CODE = Object.fromEntries(MOYENS.map((m) => [m.code, m]));

// Anciennes valeurs de l'ENUM, encore lisibles dans l'historique.
const LIBELLES_ANCIENS = { mobile_money: "Mobile money (ancien)", autre: "Autre (ancien)" };
const libelleMoyen = (code) => (PAR_CODE[code] ? PAR_CODE[code].libelle : LIBELLES_ANCIENS[code] || code);

// Comptes de réception acceptés pour un moyen.
async function comptesEligibles(db, moyen) {
  const params = [];
  let filtre;
  if (moyen.comptes === "banque") { params.push(BANQUES); filtre = "type = ANY($1::type_compte[])"; }
  else if (moyen.comptes === "mobile") { params.push(moyen.code); filtre = "type = 'mobile_money' AND operateur::text = $1"; }
  else { params.push([...BANQUES, "mobile_money"]); filtre = "type = ANY($1::type_compte[])"; }
  const { rows } = await db.query(`SELECT id, intitule FROM comptes_bancaires WHERE actif = TRUE AND ${filtre} ORDER BY intitule`, params);
  return rows;
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);

// Valide un règlement (moyen, références, frais, compte) et renvoie les valeurs
// prêtes à enregistrer, ou { erreur }. `compteParDefaut` : compte indiqué sur la
// facture, retenu s'il convient au moyen choisi.
async function preparerReglement(db, b, { montant, compteParDefaut = null } = {}) {
  const moyen = PAR_CODE[b.mode];
  if (!moyen) return { erreur: "Moyen de paiement invalide : choisissez dans la liste." };

  const src = b.references && typeof b.references === "object" ? b.references : {};
  const references = {};
  for (const c of moyen.champs) {
    const v = src[c.cle] == null ? "" : String(src[c.cle]).trim();
    if (!v) { if (c.requis) return { erreur: `${c.libelle} : champ requis pour ${moyen.libelle}.` }; continue; }
    if (c.type === T.date && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { erreur: `${c.libelle} : date invalide.` };
    if (c.type === T.tel && !/^[+\d][\d\s.\-]{5,19}$/.test(v)) return { erreur: `${c.libelle} : numéro invalide.` };
    references[c.cle] = v;
  }

  let frais = 0;
  if (moyen.frais && b.frais_retenus != null && b.frais_retenus !== "") {
    frais = Math.round(Number(b.frais_retenus));
    if (!(frais >= 0)) return { erreur: "Les frais retenus doivent être positifs ou nuls." };
    if (montant != null && frais > montant) return { erreur: "Les frais retenus ne peuvent pas dépasser le montant payé." };
  }

  const eligibles = await comptesEligibles(db, moyen);
  let compteId = b.compte_id || null;
  if (compteId) {
    if (!eligibles.some((c) => c.id === compteId)) return { erreur: "Ce compte ne peut pas recevoir ce moyen de paiement." };
  } else if (moyen.code !== "especes") {
    if (compteParDefaut && eligibles.some((c) => c.id === compteParDefaut)) compteId = compteParDefaut;
    else if (eligibles.length === 1) compteId = eligibles[0].id;
    // Plusieurs comptes possibles et aucun indiqué : l'écran impose le choix ; le
    // serveur accepte « non précisé » (appels hors écran, historique).

  }

  // Espèces : en attente de dépôt tant qu'aucun compte de dépôt n'est indiqué.
  let depotStatut = null; let dateDepot = null;
  if (moyen.code === "especes") {
    if (compteId) {
      depotStatut = "depose";
      dateDepot = b.date_depot || b.date_paiement || aujourdhui();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateDepot))) return { erreur: "Date de dépôt invalide." };
    } else depotStatut = "en_attente";
  }
  return { valeurs: { compte_id: compteId, references, frais_retenus: frais, depot_statut: depotStatut, date_depot: dateDepot } };
}

// Texte court repris dans l'ancienne colonne `reference` (listes, exports).
function referenceCourte(references) {
  const ordre = ["numero_operation", "numero_cheque", "id_transaction", "code_retrait", "numero_recu", "code_swift"];
  for (const k of ordre) if (references[k]) return references[k];
  return null;
}

module.exports = { MOYENS, PAR_CODE, OPERATEURS_MM, libelleMoyen, comptesEligibles, preparerReglement, referenceCourte };
