// JURIA — catégories de dépenses « débours et frais de procédure » = frais de justice (11/11/2026, règle de l'utilisateur).
// Miroir du groupe « debours » de frontend/src/app/core/categories-depense.ts. Ces catégories relèvent de la caisse « frais de
// justice & débours » (ou du circuit normal) : jamais de la petite caisse.
const CATEGORIES_DEBOURS = [
  "vignette_plaidoirie", "frais_procedure", "frais_consignation", "frais_grosse", "frais_expedition",
  "extrait_plumitif", "frais_diligences", "frais_huissier",
];
const estDebours = (code) => CATEGORIES_DEBOURS.includes(code);
module.exports = { CATEGORIES_DEBOURS, estDebours };
