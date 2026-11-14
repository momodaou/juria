// Libellés partagés des procédures d'un dossier (14/11/2026) : une seule écriture pour tous les écrans.
// Convention : « N° » en majuscule, collé au chiffre (N°3), partout où une procédure est numérotée.

export const LIBELLES_DEGRE: Record<string, string> = {
  premiere_instance: 'Première instance', appel: 'Appel', cassation: 'Cassation (dont CCJA)',
  opposition: 'Opposition', refere: 'Référé', execution: 'Exécution', autre: 'Autre',
};

export const libelleDegreProcedure = (degre: string): string => LIBELLES_DEGRE[degre] ?? degre;

/** Numéro d'ordre d'une procédure : « N°3 ». */
export const numProcedure = (rang: number | string | null | undefined): string => `N°${rang ?? '?'}`;

/** Mention courte sous une juridiction, une référence ou une ligne de temps : « Procédure N°3 · incident : Défense à exécution ». */
export function mentionProcedure(rang: number | string, nature: string | null | undefined, type: string | null | undefined): string {
  return `Procédure ${numProcedure(rang)}` + (nature === 'incidente' ? ` · incident${type ? ' : ' + type : ''}` : '');
}

/** La mention n'est utile que si la procédure n'est pas la première, ou si elle est incidente (un dossier à une seule procédure s'affiche comme avant). */
export const mentionProcedureUtile = (rang: number | string | null | undefined, nature: string | null | undefined): boolean =>
  !!rang && (nature === 'incidente' || Number(rang) > 1);

/** Texte d'une option de liste déroulante : « N°3 · Incident (Défense à exécution) — Cour d'appel de Bamako ». */
export function optionProcedure(p: any): string {
  const genre = p.nature === 'incidente'
    ? `Incident${p.type_procedure ? ' (' + p.type_procedure + ')' : ''}`
    : libelleDegreProcedure(p.degre);
  return `${numProcedure(p.rang)} · ${genre} — ${p.juridiction || 'juridiction non précisée'}${p.statut_procedure === 'terminee' ? ' (terminée)' : ''}`;
}
