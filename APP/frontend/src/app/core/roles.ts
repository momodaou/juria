// JURIA — libellés des 13 statuts du personnel (20/09/2026).
// Jusqu'ici défini une seule fois, localement dans acces.component.ts
// (utilisé pour les listes déroulantes et la Matrice des permissions) — la
// valeur d'ENUM brute (ex. "admin_general") s'affichait telle quelle
// ailleurs dans l'appli (Cabinet, Mon compte, sélecteurs de responsable/
// intervenant/bénéficiaire), constat de l'utilisateur. Extrait ici comme
// source unique pour que tout affichage de rôle passe par le même libellé.
export interface RoleInfo {
  code: string;
  libelle: string;
  court: string;
}

export const ROLES: RoleInfo[] = [
  { code: 'associe', libelle: 'Avocat associé', court: 'Associé' },
  { code: 'associe_fondateur', libelle: 'Avocat associé-fondateur', court: 'Assoc. fondateur' },
  { code: 'of_counsel', libelle: 'Avocat Of Counsel', court: 'Of Counsel' },
  { code: 'collaborateur', libelle: 'Avocat collaborateur', court: 'Collab. avocat' },
  { code: 'avocat_stagiaire', libelle: 'Avocat stagiaire', court: 'Avocat stag.' },
  { code: 'stagiaire', libelle: 'Stagiaire (non-avocat)', court: 'Stagiaire' },
  { code: 'juriste', libelle: 'Collaborateur non-avocat/juriste', court: 'Juriste' },
  { code: 'admin_general', libelle: 'Administrateur général', court: 'Admin. général' },
  { code: 'assistante', libelle: 'Assistante juridique et administrative', court: 'Assistante' },
  { code: 'comptable', libelle: 'Comptable', court: 'Comptable' },
  { code: 'assistant_comptable', libelle: 'Assistant comptable', court: 'Assist. comptable' },
  { code: 'admin_it', libelle: 'Administrateur IT', court: 'Admin. IT' },
  { code: 'archiviste', libelle: 'Archiviste', court: 'Archiviste' },
];

const PAR_CODE: Record<string, RoleInfo> = Object.fromEntries(ROLES.map((r) => [r.code, r]));

// Repli sur le code brut si jamais rencontré (rôle retiré du catalogue,
// valeur inattendue) — jamais un affichage vide ni une erreur.
export function libelleRole(code: string | null | undefined, forme: 'complet' | 'court' = 'complet'): string {
  if (!code) return '—';
  const r = PAR_CODE[code];
  if (!r) return code;
  return forme === 'court' ? r.court : r.libelle;
}
