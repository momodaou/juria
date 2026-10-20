// JURIA — comptes du cabinet (20/10/2026) : deux familles seulement, avec des
// champs propres à chacune. « Banque » (usage fonctionnement ou CARPA) et
// « Mobile money ». Les anciens types espèces / virement étranger restent en
// base (historique) mais ne se créent plus : la caisse n'est pas un compte de
// réception, et un virement de l'étranger est une variante du virement.

const TYPES_BANQUE = ["fonctionnement", "carpa"];
const TYPES_ACTIFS = [...TYPES_BANQUE, "mobile_money"];
const OPERATEURS = ["orange_money", "moov_money", "wave", "sama_money", "autre"];

const texte = (v) => (v == null ? null : String(v).trim() || null);

// Numéro de portefeuille : 8 chiffres au Mali, +223 / 00223 acceptés. Stocké « 70 00 00 00 ».
function normaliserTelephone(v) {
  const brut = String(v || "").replace(/[\s.\-]/g, "").replace(/^\+?223/, "").replace(/^00223/, "");
  if (!/^\d{8}$/.test(brut)) return null;
  return brut.replace(/(\d{2})(?=\d)/g, "$1 ");
}

// Valide et normalise un compte complet ; renvoie { erreur } ou { valeurs }.
function validerCompte(b) {
  const type = b.type;
  if (!TYPES_ACTIFS.includes(type)) {
    return { erreur: "Type de compte invalide : choisissez Banque (fonctionnement ou CARPA) ou Mobile money." };
  }
  const intitule = texte(b.intitule);
  if (!intitule) return { erreur: "L'intitulé est requis." };
  const afficher = b.afficher_sur_factures === undefined || b.afficher_sur_factures === null ? true : !!b.afficher_sur_factures;

  if (type === "mobile_money") {
    if (!OPERATEURS.includes(b.operateur)) return { erreur: "L'opérateur est requis pour un compte mobile money." };
    const tel = normaliserTelephone(b.telephone);
    if (!tel) return { erreur: "Numéro de portefeuille invalide : 8 chiffres attendus (ex. 70 00 00 00)." };
    return { valeurs: {
      intitule, type, operateur: b.operateur, telephone: tel, afficher_sur_factures: afficher,
      banque: null, numero: null, code_banque: null, code_guichet: null, cle_rib: null, iban: null, bic: null,
    } };
  }

  const banque = texte(b.banque);
  const numero = texte(b.numero);
  if (!banque) return { erreur: "Le nom de la banque est requis." };
  if (!numero) return { erreur: "Le numéro de compte est requis." };
  const iban = texte(b.iban) ? String(b.iban).replace(/\s+/g, "").toUpperCase() : null;
  if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return { erreur: "IBAN invalide (ex. ML03 D008 0101 …)." };
  const bic = texte(b.bic) ? String(b.bic).replace(/\s+/g, "").toUpperCase() : null;
  if (bic && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(bic)) return { erreur: "BIC invalide (8 ou 11 caractères)." };
  const cle = texte(b.cle_rib);
  if (cle && !/^[A-Za-z0-9]{1,3}$/.test(cle)) return { erreur: "Clé RIB invalide (1 à 3 caractères)." };
  return { valeurs: {
    intitule, type, banque, numero, iban, bic, cle_rib: cle,
    code_banque: texte(b.code_banque), code_guichet: texte(b.code_guichet),
    operateur: null, telephone: null, afficher_sur_factures: afficher,
  } };
}

module.exports = { TYPES_ACTIFS, TYPES_BANQUE, OPERATEURS, normaliserTelephone, validerCompte };
