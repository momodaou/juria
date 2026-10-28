// JURIA — catégories de dépenses, liste unique (28/10/2026) partagée par « Dépenses & caisse » et l'état des charges.
// Les codes correspondent aux valeurs de l'ENUM `categorie_depense` (schema.sql) ; ajouter une catégorie
// = une valeur d'ENUM (importée à part en production) + une ligne ici. Le groupe « debours » est une aide :
// ces catégories concernent le plus souvent un dossier précis (rattachement et refacturation au client).
export type GroupeCategorie = 'cabinet' | 'debours';
export interface CategorieDepense { code: string; libelle: string; groupe: GroupeCategorie; }

export const CATEGORIES_DEPENSE: CategorieDepense[] = [
  { code: 'loyer', libelle: 'Loyer', groupe: 'cabinet' },
  { code: 'eau', libelle: 'Eau', groupe: 'cabinet' },
  { code: 'electricite', libelle: 'Électricité', groupe: 'cabinet' },
  { code: 'nettoyage', libelle: 'Nettoyage', groupe: 'cabinet' },
  { code: 'telephonie', libelle: 'Téléphonie', groupe: 'cabinet' },
  { code: 'telephonie_fixe', libelle: 'Téléphonie fixe', groupe: 'cabinet' },
  { code: 'credit_telephonique', libelle: 'Crédit téléphonique', groupe: 'cabinet' },
  { code: 'internet', libelle: 'Internet', groupe: 'cabinet' },
  { code: 'carburant', libelle: 'Carburant', groupe: 'cabinet' },
  { code: 'transport', libelle: 'Transport', groupe: 'cabinet' },
  { code: 'deplacement', libelle: 'Déplacement (billets)', groupe: 'cabinet' },
  { code: 'hebergement', libelle: 'Hébergement', groupe: 'cabinet' },
  { code: 'restauration', libelle: 'Restauration', groupe: 'cabinet' },
  { code: 'fournitures', libelle: 'Fournitures de bureau', groupe: 'cabinet' },
  { code: 'papeterie', libelle: 'Papeterie', groupe: 'cabinet' },
  { code: 'petit_materiel', libelle: 'Petit matériel et fournitures', groupe: 'cabinet' },
  { code: 'consommables', libelle: 'Consommables', groupe: 'cabinet' },
  { code: 'impressions', libelle: 'Impressions et photocopies', groupe: 'cabinet' },
  { code: 'encres', libelle: 'Encres et toners', groupe: 'cabinet' },
  { code: 'maintenance_informatique', libelle: 'Maintenance informatique', groupe: 'cabinet' },
  { code: 'reparation', libelle: 'Réparation', groupe: 'cabinet' },
  { code: 'entretien', libelle: 'Entretien', groupe: 'cabinet' },
  { code: 'abonnements', libelle: 'Abonnements et documentation', groupe: 'cabinet' },
  { code: 'assurance', libelle: 'Assurances', groupe: 'cabinet' },
  { code: 'frais_bancaires', libelle: 'Frais bancaires', groupe: 'cabinet' },
  { code: 'charges_fiscales_sociales', libelle: 'Charges fiscales et sociales', groupe: 'cabinet' },
  { code: 'vignette_plaidoirie', libelle: 'Vignette de plaidoirie', groupe: 'debours' },
  { code: 'frais_procedure', libelle: 'Frais de procédure', groupe: 'debours' },
  { code: 'frais_consignation', libelle: 'Frais de consignation', groupe: 'debours' },
  { code: 'frais_grosse', libelle: 'Frais de grosse de jugement', groupe: 'debours' },
  { code: 'frais_expedition', libelle: 'Frais d’expédition (courrier, actes, jugements)', groupe: 'debours' },
  { code: 'extrait_plumitif', libelle: 'Extrait de plumitif', groupe: 'debours' },
  { code: 'frais_diligences', libelle: 'Frais de diligences', groupe: 'debours' },
  { code: 'frais_huissier', libelle: 'Frais d’huissier', groupe: 'debours' },
  { code: 'autre', libelle: 'Autre (à préciser)', groupe: 'cabinet' },
];

export const CATEGORIES_CABINET = CATEGORIES_DEPENSE.filter((c) => c.groupe === 'cabinet');
export const CATEGORIES_DEBOURS = CATEGORIES_DEPENSE.filter((c) => c.groupe === 'debours');
export const estDebours = (code: string): boolean => CATEGORIES_DEBOURS.some((c) => c.code === code);
export const libelleCategorieDepense = (code: string): string => CATEGORIES_DEPENSE.find((c) => c.code === code)?.libelle ?? code;
