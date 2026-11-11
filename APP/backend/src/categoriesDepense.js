// JURIA — catalogues de natures de dépenses par caisse (11/11/2026, révisé après les observations de l'utilisateur).
// Miroir de frontend/src/app/core/categories-depense.ts. Chaque caisse a SON catalogue, sans mélange :
//  · petite caisse = charges courantes du cabinet ;
//  · caisse « frais de justice & débours » = frais de procédure, toujours liés à un dossier.
// Les débours et frais de procédure sont des frais de justice : jamais sur la petite caisse. La vignette de plaidoirie
// n'appartient à aucune caisse : sa dépense naît à l'affectation à une instance (jamais saisie à l'achat du lot).
const CATEGORIES_DEBOURS = [
  "vignette_plaidoirie", "frais_procedure", "frais_consignation", "frais_grosse", "frais_expedition",
  "extrait_plumitif", "frais_diligences", "frais_huissier",
  "frais_greffe", "timbres_enregistrement", "extraits_pieces", "traduction", "annonces_legales",
];
const estDebours = (code) => CATEGORIES_DEBOURS.includes(code);

const CATALOGUE_PETITE_CAISSE = [
  "transport", "deplacement", "carburant", "restauration", "frais_reception", "boissons", "fournitures", "consommables",
  "papeterie", "impressions", "encres", "petit_materiel", "reparation", "produits_entretien", "desodorisants",
  "credit_telephonique", "entretien_vehicule",
];
const CATALOGUE_PROCEDURE = [
  "frais_greffe", "frais_grosse", "frais_consignation", "extrait_plumitif", "frais_huissier", "frais_diligences",
  "frais_procedure", "frais_expedition", "timbres_enregistrement", "extraits_pieces", "traduction", "annonces_legales",
];

// Frais de greffe : on précise lequel (choix obligatoire). La liste peut s'enrichir ; « autre » demande un libellé explicite.
const PRECISIONS_GREFFE = [
  "expedition_simple", "acte_appel", "proces_verbal_enquete", "cedule_citation", "permis_citer", "copies", "certificats", "autre",
];
// Renvoie un message d'erreur, ou null. La précision n'est exigée que pour les frais de greffe.
function verifierPrecisionNature(categorie, precision) {
  if (categorie !== "frais_greffe") return null;
  if (!precision) return "Précisez le frais de greffe concerné (expédition simple, acte d'appel, copies, certificats…).";
  if (!PRECISIONS_GREFFE.includes(precision)) return "Précision de frais de greffe inconnue.";
  return null;
}

module.exports = {
  CATEGORIES_DEBOURS, estDebours, CATALOGUE_PETITE_CAISSE, CATALOGUE_PROCEDURE, PRECISIONS_GREFFE, verifierPrecisionNature,
};
