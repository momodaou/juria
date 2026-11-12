// JURIA — catégories de dépenses, liste unique (28/10/2026) partagée par « Dépenses & caisse » et l'état des charges.
// Les codes correspondent aux valeurs de l'ENUM `categorie_depense` (schema.sql) ; ajouter une catégorie
// = une valeur d'ENUM (importée à part en production) + une ligne ici. Le groupe « debours » est une aide :
// ces catégories concernent le plus souvent un dossier précis (rattachement et refacturation au client).
export type GroupeCategorie = 'cabinet' | 'debours' | 'travaux';
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
  { code: 'frais_reception', libelle: 'Frais de réception / visiteurs', groupe: 'cabinet' },
  { code: 'boissons', libelle: 'Eau potable et boissons du cabinet', groupe: 'cabinet' },
  { code: 'produits_entretien', libelle: 'Produits d’entretien et de nettoyage', groupe: 'cabinet' },
  { code: 'desodorisants', libelle: 'Désodorisants et déodorants', groupe: 'cabinet' },
  { code: 'entretien_vehicule', libelle: 'Entretien du véhicule (lavage, petites pièces)', groupe: 'cabinet' },
  { code: 'fournitures', libelle: 'Petites fournitures de bureau', groupe: 'cabinet' },
  { code: 'papeterie', libelle: 'Papeterie', groupe: 'cabinet' },
  { code: 'petit_materiel', libelle: 'Petits matériels et autres fournitures', groupe: 'cabinet' },
  { code: 'consommables', libelle: 'Consommables de bureau', groupe: 'cabinet' },
  { code: 'impressions', libelle: 'Impressions et photocopies', groupe: 'cabinet' },
  { code: 'encres', libelle: 'Cartouches d’encre et toners', groupe: 'cabinet' },
  { code: 'maintenance_informatique', libelle: 'Maintenance informatique', groupe: 'cabinet' },
  { code: 'reparation', libelle: 'Entretien et réparations diverses', groupe: 'cabinet' },
  { code: 'entretien', libelle: 'Entretien', groupe: 'cabinet' },
  { code: 'abonnements', libelle: 'Abonnements et documentation', groupe: 'cabinet' },
  { code: 'assurance', libelle: 'Assurances', groupe: 'cabinet' },
  { code: 'frais_bancaires', libelle: 'Frais bancaires', groupe: 'cabinet' },
  { code: 'charges_fiscales_sociales', libelle: 'Charges fiscales et sociales', groupe: 'cabinet' },
  { code: 'climatisation', libelle: 'Climatisation (achat, installation, remplacement)', groupe: 'travaux' },
  { code: 'travaux_electricite', libelle: 'Électricité : travaux et extension de câblage', groupe: 'travaux' },
  { code: 'travaux_reseau_telecom', libelle: 'Réseau, internet et téléphonie : installation et réparation', groupe: 'travaux' },
  { code: 'plomberie', libelle: 'Plomberie et sanitaires', groupe: 'travaux' },
  { code: 'amenagement_locaux', libelle: 'Aménagement et rénovation des locaux', groupe: 'travaux' },
  { code: 'securite_surete', libelle: 'Sécurité et sûreté (alarme, caméras, extincteurs, serrurerie)', groupe: 'travaux' },
  { code: 'mobilier_agencement', libelle: 'Mobilier et agencement', groupe: 'travaux' },
  { code: 'materiel_informatique', libelle: 'Matériel informatique et bureautique', groupe: 'travaux' },
  { code: 'energie_secours', libelle: 'Énergie de secours (groupe électrogène, onduleurs, solaire)', groupe: 'travaux' },
  { code: 'honoraires_techniques', libelle: 'Honoraires techniques (architecte, bureau d’études, bureau de contrôle)', groupe: 'travaux' },
  { code: 'vehicule_reparations', libelle: 'Véhicule : réparations importantes', groupe: 'travaux' },
  { code: 'vignette_plaidoirie', libelle: 'Vignette de plaidoirie', groupe: 'debours' },
  { code: 'frais_procedure', libelle: 'Frais de procédure', groupe: 'debours' },
  { code: 'frais_consignation', libelle: 'Frais de consignation', groupe: 'debours' },
  { code: 'frais_grosse', libelle: 'Frais de grosse de jugement', groupe: 'debours' },
  { code: 'frais_expedition', libelle: 'Courrier, affranchissement et expéditions (actes, jugements)', groupe: 'debours' },
  { code: 'extrait_plumitif', libelle: 'Extrait de plumitif', groupe: 'debours' },
  { code: 'frais_diligences', libelle: 'Frais de diligences', groupe: 'debours' },
  { code: 'frais_huissier', libelle: 'Frais d’huissier', groupe: 'debours' },
  { code: 'frais_greffe', libelle: 'Frais de greffe', groupe: 'debours' },
  { code: 'timbres_enregistrement', libelle: 'Timbres fiscaux et droits d’enregistrement', groupe: 'debours' },
  { code: 'extraits_pieces', libelle: 'Extraits RCCM, casier judiciaire, état civil', groupe: 'debours' },
  { code: 'traduction', libelle: 'Traduction assermentée', groupe: 'debours' },
  { code: 'annonces_legales', libelle: 'Annonces légales et publications', groupe: 'debours' },
  { code: 'autre', libelle: 'Autre (à préciser)', groupe: 'cabinet' },
];

export const CATEGORIES_CABINET = CATEGORIES_DEPENSE.filter((c) => c.groupe === 'cabinet');
export const CATEGORIES_DEBOURS = CATEGORIES_DEPENSE.filter((c) => c.groupe === 'debours');
// Travaux, équipements et installations (12/11/2026) : jamais sur les caisses (circuit normal de validation) ; disponibles aussi dans l'état mensuel.
export const CATEGORIES_TRAVAUX = CATEGORIES_DEPENSE.filter((c) => c.groupe === 'travaux');
export const estDebours = (code: string): boolean => CATEGORIES_DEBOURS.some((c) => c.code === code);
export const libelleCategorieDepense = (code: string): string => CATEGORIES_DEPENSE.find((c) => c.code === code)?.libelle ?? code;

// Catalogues par caisse (11/11/2026) : chaque caisse a le sien, sans mélange (miroir de backend/src/categoriesDepense.js).
// Les listes cochables dans Accès & permissions → Seuils sont limitées à ces catalogues ; la vignette de plaidoirie n'y figure pas
// (sa dépense naît à l'affectation à une instance).
export const CATALOGUE_PETITE_CAISSE: string[] = [
  'transport', 'deplacement', 'carburant', 'restauration', 'frais_reception', 'boissons', 'fournitures', 'consommables',
  'papeterie', 'impressions', 'encres', 'petit_materiel', 'reparation', 'produits_entretien', 'desodorisants',
  'credit_telephonique', 'entretien_vehicule'];
export const CATALOGUE_PROCEDURE: string[] = [
  'frais_greffe', 'frais_grosse', 'frais_consignation', 'extrait_plumitif', 'frais_huissier', 'frais_diligences',
  'frais_procedure', 'frais_expedition', 'timbres_enregistrement', 'extraits_pieces', 'traduction', 'annonces_legales'];
const enCatalogue = (codes: string[]): CategorieDepense[] => codes.map((c) => CATEGORIES_DEPENSE.find((x) => x.code === c)!).filter(Boolean);
export const NATURES_PETITE_CAISSE: CategorieDepense[] = enCatalogue(CATALOGUE_PETITE_CAISSE);
export const NATURES_CAISSE_PROCEDURE: CategorieDepense[] = enCatalogue(CATALOGUE_PROCEDURE);
// Listes « valeurs par défaut » : tout le catalogue de la caisse.
export const NATURES_PETITE_CAISSE_DEFAUT: string[] = [...CATALOGUE_PETITE_CAISSE];
export const NATURES_CAISSE_PROCEDURE_DEFAUT: string[] = [...CATALOGUE_PROCEDURE];

// Frais de greffe : on précise lequel (choix obligatoire ; la liste s'enrichit au fil de l'eau).
export const PRECISIONS_GREFFE: { code: string; libelle: string }[] = [
  { code: 'expedition_simple', libelle: 'Expédition simple' },
  { code: 'acte_appel', libelle: 'Acte d’appel' },
  { code: 'proces_verbal_enquete', libelle: 'Procès-verbal d’enquête' },
  { code: 'cedule_citation', libelle: 'Cédule de citation' },
  { code: 'permis_citer', libelle: 'Permis de citer' },
  { code: 'copies', libelle: 'Copies' },
  { code: 'certificats', libelle: 'Certificats' },
  { code: 'autre', libelle: 'Autre (à préciser dans le libellé)' },
];
export const libellePrecisionGreffe = (code?: string | null): string => PRECISIONS_GREFFE.find((p) => p.code === code)?.libelle ?? '';
