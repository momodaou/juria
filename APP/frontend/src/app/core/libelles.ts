import { Pipe, PipeTransform } from '@angular/core';

// 25/10/2026 — libellés français des codes d'ENUM affichés tels quels dans
// plusieurs écrans (« mise_en_etat », « en_cours »…). Un code inconnu est
// rendu lisible (underscores → espaces, 1re lettre en majuscule).
const TABLES: Record<string, Record<string, string>> = {
  statutDossier: { ouvert: 'Ouvert', en_cours: 'En cours', suspendu: 'Suspendu', clos: 'Clos', archive: 'Archivé' },
  phase: {
    consultation: 'Consultation', ouverture: 'Ouverture', mise_en_etat: 'Mise en état', plaidoirie: 'Plaidoirie',
    decision: 'Décision', execution: 'Exécution', recours: 'Recours', cloture: 'Clôture',
  },
  statutDocument: { brouillon: 'Brouillon', valide: 'Validé', signe: 'Signé', archive: 'Archivé' },
  categorieDocument: {
    correspondance: 'Correspondance', piece_client: 'Pièce client', contrat: 'Contrat', conclusions: 'Conclusions',
    decision: 'Décision', courrier_officiel: 'Courrier officiel', facture: 'Facture', note_interne: 'Note interne',
    recherche: 'Recherche', autre: 'Autre',
  },
  typeCommunication: { email: 'E-mail', courrier: 'Courrier', appel: 'Appel', whatsapp: 'WhatsApp', reunion: 'Réunion', note: 'Note' },
  statutCourrier: { recu: 'Reçu', impute: 'Imputé', en_traitement: 'En traitement', traite: 'Traité', expedie: 'Expédié' },
  statutFacture: {
    brouillon: 'Brouillon', emise: 'Émise', partielle: 'Partiellement payée', payee: 'Payée', impayee: 'Impayée', annulee: 'Annulée',
  },
  typeEvenement: {
    audience: 'Audience', rendez_vous: 'Rendez-vous', delai_procedure: 'Délai de procédure', delai_recours: 'Délai de recours',
    echeance_contractuelle: 'Échéance contractuelle', depot: 'Dépôt', relance_client: 'Relance client', prescription: 'Prescription',
  },
};

export function libelleEnum(table: string, code: string | null | undefined): string {
  if (!code) return '—';
  const trouve = TABLES[table]?.[code];
  if (trouve) return trouve;
  const lisible = code.replace(/_/g, ' ');
  return lisible.charAt(0).toUpperCase() + lisible.slice(1);
}

@Pipe({ name: 'libelle', standalone: true })
export class LibellePipe implements PipeTransform {
  transform(code: string | null | undefined, table: string): string { return libelleEnum(table, code); }
}
