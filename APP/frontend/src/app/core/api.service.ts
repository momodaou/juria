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

  clients(recherche = ''): Observable<any[]> {
    const q = recherche ? `?q=${encodeURIComponent(recherche)}` : '';
    return this.http.get<any[]>(`${this.base}/api/clients${q}`);
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

  // Assistant IA (résultat toujours « projet à valider »)
  iaResume(payload: { texte?: string; document_id?: string }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/ia/resume`, payload);
  }
  iaChronologie(payload: { texte?: string; dossier_id?: string }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/ia/chronologie`, payload);
  }
}
