import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface DashboardData {
  dossiers_actifs: number;
  dossiers_urgents: number;
  audiences_semaine: number;
  impayes_ttc: number;
  heures_mois: number;
  delais_a_venir: any[];
}

export interface Dossier {
  id: string;
  numero: string;
  intitule: string;
  statut: string;
  phase: string;
  urgence: string;
  client: string;
  responsable: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly base = environment.apiUrl;

  constructor(private http: HttpClient) {}

  dashboard(): Observable<DashboardData> {
    return this.http.get<DashboardData>(`${this.base}/api/dashboard`);
  }

  dossiers(recherche = ''): Observable<Dossier[]> {
    const q = recherche ? `?q=${encodeURIComponent(recherche)}` : '';
    return this.http.get<Dossier[]>(`${this.base}/api/dossiers${q}`);
  }

  dossier(id: string): Observable<any> {
    return this.http.get<any>(`${this.base}/api/dossiers/${id}`);
  }

  dossierEvenements(id: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/api/dossiers/${id}/evenements`);
  }

  dossierDocuments(id: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/api/dossiers/${id}/documents`);
  }

  // GED — téléverser une pièce dans un dossier
  televerserDocument(dossierId: string, fichier: File, meta: { categorie?: string; confidentialite?: string } = {}): Observable<any> {
    const fd = new FormData();
    fd.append('fichier', fichier);
    fd.append('dossier_id', dossierId);
    if (meta.categorie) fd.append('categorie', meta.categorie);
    if (meta.confidentialite) fd.append('confidentialite', meta.confidentialite);
    return this.http.post<any>(`${this.base}/api/documents`, fd);
  }

  // GED — télécharger une pièce (renvoie un blob authentifié)
  telechargerDocument(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/api/documents/${id}/download`, { responseType: 'blob' });
  }

  creerDossier(payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/dossiers`, payload);
  }

  clients(recherche = '', kyc = ''): Observable<any[]> {
    const params = new URLSearchParams();
    if (recherche) params.set('q', recherche);
    if (kyc) params.set('kyc', kyc);
    const q = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<any[]>(`${this.base}/api/clients${q}`);
  }

  client(id: string): Observable<any> {
    return this.http.get<any>(`${this.base}/api/clients/${id}`);
  }

  creerClient(payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/clients`, payload);
  }

  majClient(id: string, payload: any): Observable<any> {
    return this.http.put<any>(`${this.base}/api/clients/${id}`, payload);
  }

  kycAlertes(jours = 30): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/api/clients/kyc/alertes?jours=${jours}`);
  }

  // KYC — pièces d'identité / documents rattachés au client
  ajouterPieceKyc(clientId: string, libelle: string, dateExpiration: string | null, fichier: File | null): Observable<any> {
    const fd = new FormData();
    fd.append('libelle', libelle);
    if (dateExpiration) fd.append('date_expiration', dateExpiration);
    if (fichier) fd.append('fichier', fichier);
    return this.http.post<any>(`${this.base}/api/clients/${clientId}/kyc-pieces`, fd);
  }

  telechargerPieceKyc(clientId: string, pieceId: string): Observable<Blob> {
    return this.http.get(`${this.base}/api/clients/${clientId}/kyc-pieces/${pieceId}/download`, { responseType: 'blob' });
  }

  supprimerPieceKyc(clientId: string, pieceId: string): Observable<any> {
    return this.http.delete(`${this.base}/api/clients/${clientId}/kyc-pieces/${pieceId}`);
  }

  // Registre des originaux confiés
  originaux(filtres: { client_id?: string; dossier_id?: string; restitue?: boolean } = {}): Observable<any[]> {
    const params = new URLSearchParams();
    if (filtres.client_id) params.set('client_id', filtres.client_id);
    if (filtres.dossier_id) params.set('dossier_id', filtres.dossier_id);
    if (filtres.restitue !== undefined) params.set('restitue', String(filtres.restitue));
    const q = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<any[]>(`${this.base}/api/originaux${q}`);
  }

  creerOriginal(payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/originaux`, payload);
  }

  restituerOriginal(id: string, restitueA: string): Observable<any> {
    return this.http.post<any>(`${this.base}/api/originaux/${id}/restituer`, { restitue_a: restitueA });
  }

  // Listes de valeurs paramétrables (nomenclatures)
  listesValeurs(domaine: string): Observable<{ code: string; libelle: string }[]> {
    return this.http.get<{ code: string; libelle: string }[]>(`${this.base}/api/listes-valeurs?domaine=${domaine}`);
  }

  // Contrôle des conflits : renvoie { id, resultat, details, message }
  conflictCheck(payload: { intitule_projet?: string; noms: string }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/conflict-checks`, payload);
  }

  decisionConflit(id: string, payload: { decision: string; motif?: string }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/conflict-checks/${id}/decision`, payload);
  }

  // Temps
  tempsDossier(dossierId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/api/temps?dossier_id=${dossierId}`);
  }
  creerTemps(payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/temps`, payload);
  }

  // Factures & paiements
  factures(statut = ''): Observable<any[]> {
    const q = statut ? `?statut=${statut}` : '';
    return this.http.get<any[]>(`${this.base}/api/factures${q}`);
  }
  facturesImpayees(): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/api/factures/impayees`);
  }
  creerFacture(payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/factures`, payload);
  }
  ajouterPaiement(id: string, payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/factures/${id}/paiements`, payload);
  }

  // Échéancier / délais
  evenements(): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/api/evenements`);
  }
  creerEvenement(payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/evenements`, payload);
  }

  // Tâches
  taches(params = ''): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/api/taches${params}`);
  }
  creerTache(payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/taches`, payload);
  }
  majTache(id: string, statut: string): Observable<any> {
    return this.http.put<any>(`${this.base}/api/taches/${id}`, { statut });
  }

  // Fil du dossier (communications)
  dossierCommunications(dossierId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/api/communications?dossier_id=${dossierId}`);
  }
  creerCommunication(payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/communications`, payload);
  }

  // Rôle d'audience
  roleAudience(semaine?: string): Observable<any> {
    const q = semaine ? `?semaine=${semaine}` : '';
    return this.http.get<any>(`${this.base}/api/roles-audience${q}`);
  }
  ajouterLigneRole(payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/roles-audience/lignes`, payload);
  }
  validerRole(id: string): Observable<any> {
    return this.http.post<any>(`${this.base}/api/roles-audience/${id}/valider`, {});
  }
  diffuserRole(id: string): Observable<any> {
    return this.http.post<any>(`${this.base}/api/roles-audience/${id}/diffuser`, {});
  }
  motifsRenvoi(): Observable<{ id: string; libelle: string }[]> {
    return this.http.get<{ id: string; libelle: string }[]>(`${this.base}/api/roles-audience/motifs-renvoi`);
  }
  retourAudience(audienceId: string, payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/roles-audience/audiences/${audienceId}/retour`, payload);
  }

  // Registre du courrier
  courriers(filtres: { sens?: string; dossier_id?: string; statut?: string; q?: string } = {}): Observable<any[]> {
    const params = new URLSearchParams();
    Object.entries(filtres).forEach(([k, v]) => { if (v) params.set(k, v); });
    const q = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<any[]>(`${this.base}/api/courriers${q}`);
  }
  courrier(id: string): Observable<any> {
    return this.http.get<any>(`${this.base}/api/courriers/${id}`);
  }
  creerCourrier(payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/courriers`, payload);
  }
  majStatutCourrier(id: string, payload: any): Observable<any> {
    return this.http.put<any>(`${this.base}/api/courriers/${id}/statut`, payload);
  }

  // Assistant IA (résultat toujours « projet à valider »)
  iaResume(payload: { texte?: string; document_id?: string }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/ia/resume`, payload);
  }
  iaChronologie(payload: { texte?: string; dossier_id?: string }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/ia/chronologie`, payload);
  }
}
