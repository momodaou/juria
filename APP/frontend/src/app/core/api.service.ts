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
  dossiers_sous_seuil_honoraires: number;
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
  client_id: string;
  responsable: string;
  pro_bono: boolean;
  code_matiere: string | null;
  couleur_chemise: string | null;
  cumul_xof: number;
  // null pour un dossier non pro bono — le seuil classique a été abandonné
  // le 18/08/2026, seul le volet pro bono reste suivi.
  honoraires_seuil_xof: number | null;
  statut_honoraires: 'sans_honoraires' | 'sous_seuil' | 'atteint' | null;
}

export interface ParametresHonoraires {
  frais_procedure_pro_bono_min_xof: number;
  quota_pro_bono_mensuel: number;
}

// Identité du cabinet (en-tête facture/acte) — 28/08/2026, facture PDF enrichie.
export interface ParametresCabinet {
  raison_sociale: string;
  forme: string | null;
  adresse: string | null;
  telephone: string | null;
  email: string | null;
  nif: string | null;
  rccm: string | null;
  compte_carpa: string | null;
  mentions_legales: string | null;
}

export interface CompteBancaire {
  id: string;
  intitule: string;
  type: string;
  banque: string | null;
  numero: string | null;
  operateur: string | null;
  actif: boolean;
  code_banque?: string | null;
  code_guichet?: string | null;
  cle_rib?: string | null;
  iban?: string | null;
  bic?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly base = environment.apiUrl;

  constructor(private http: HttpClient) {}

  dashboard(): Observable<DashboardData> {
    return this.http.get<DashboardData>(`${this.base}/api/dashboard`);
  }

  // filtres.statut/responsable/masquer_archives (20/08/2026, diagnostic
  // utilisateur) — le backend les acceptait déjà, jamais exposés à l'écran.
  dossiers(recherche = '', filtres: { statut?: string; responsable?: string; masquer_archives?: boolean } = {}): Observable<Dossier[]> {
    const params = new URLSearchParams();
    if (recherche) params.set('q', recherche);
    if (filtres.statut) params.set('statut', filtres.statut);
    if (filtres.responsable) params.set('responsable', filtres.responsable);
    if (filtres.masquer_archives) params.set('masquer_archives', 'true');
    const q = params.toString() ? `?${params.toString()}` : '';
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
  // GED — supprimer une pièce (28/08/2026, gap comblé : aucune route n'existait)
  supprimerDocument(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/api/documents/${id}`);
  }

  creerDossier(payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/dossiers`, payload);
  }

  majDossier(id: string, payload: any): Observable<any> {
    return this.http.put<any>(`${this.base}/api/dossiers/${id}`, payload);
  }

  supprimerDossier(id: string): Observable<any> {
    return this.http.delete<any>(`${this.base}/api/dossiers/${id}`);
  }

  // Instances (19/08/2026) — 1re instance / appel / cassation… d'un dossier.
  ajouterInstance(dossierId: string, payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/dossiers/${dossierId}/instances`, payload);
  }
  majInstance(dossierId: string, instanceId: string, payload: any): Observable<any> {
    return this.http.put<any>(`${this.base}/api/dossiers/${dossierId}/instances/${instanceId}`, payload);
  }

  // Clients additionnels sur un dossier (18/08/2026) — un même dossier peut
  // comporter plusieurs identités clientes en plus du client principal.
  ajouterClientDossier(dossierId: string, clientId: string): Observable<any> {
    return this.http.post<any>(`${this.base}/api/dossiers/${dossierId}/clients`, { client_id: clientId });
  }
  retirerClientDossier(dossierId: string, clientId: string): Observable<any> {
    return this.http.delete<any>(`${this.base}/api/dossiers/${dossierId}/clients/${clientId}`);
  }

  // Parties adverses (20/08/2026) — rectification après la création.
  ajouterPartieDossier(dossierId: string, payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/dossiers/${dossierId}/parties`, payload);
  }
  majPartieDossier(dossierId: string, partieId: string, payload: any): Observable<any> {
    return this.http.put<any>(`${this.base}/api/dossiers/${dossierId}/parties/${partieId}`, payload);
  }
  retirerPartieDossier(dossierId: string, partieId: string): Observable<any> {
    return this.http.delete<any>(`${this.base}/api/dossiers/${dossierId}/parties/${partieId}`);
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

  // Contrôle de doublon avant création (20/08/2026, diagnostic utilisateur) —
  // ne bloque rien, signale seulement une correspondance RCCM/NIF/nom déjà
  // en base pour laisser l'utilisateur confirmer ou aller sur la fiche
  // existante plutôt que de créer un doublon silencieux.
  verifierDoublonClient(payload: { type: string; denomination?: string; prenom?: string; nom?: string; rccm?: string; nif?: string }): Observable<any[]> {
    const params = new URLSearchParams();
    Object.entries(payload).forEach(([k, v]) => { if (v) params.set(k, String(v)); });
    return this.http.get<any[]>(`${this.base}/api/clients/verifier-doublon?${params.toString()}`);
  }

  // Personnes/entités liées (20/08/2026) — bénéficiaires effectifs, filiales,
  // dirigeants… (table déjà en base, jusqu'ici inaccessible depuis l'écran).
  ajouterLienClient(clientId: string, payload: { lie_a_id: string; nature: string }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/clients/${clientId}/liens`, payload);
  }
  retirerLienClient(clientId: string, lienId: string): Observable<any> {
    return this.http.delete<any>(`${this.base}/api/clients/${clientId}/liens/${lienId}`);
  }

  majClient(id: string, payload: any): Observable<any> {
    return this.http.put<any>(`${this.base}/api/clients/${id}`, payload);
  }

  supprimerClient(id: string): Observable<any> {
    return this.http.delete<any>(`${this.base}/api/clients/${id}`);
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

  // Codes matière (Guide de référencement des dossiers, 19/08/2026) —
  // référentiel type+matière+couleur de chemise, pilote la référence.
  codesMatiere(pole?: string): Observable<{ code: string; type: string; libelle: string; couleur: string }[]> {
    const q = pole ? `?pole=${pole}` : '';
    return this.http.get<any[]>(`${this.base}/api/dossiers/meta/codes-matiere${q}`);
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
  // Temps facturables pas encore rattachés à une facture (voir "Facturer les
  // temps" dans l'écran Facturation).
  tempsNonFactures(dossierId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/api/temps?dossier_id=${dossierId}&non_factures=true`);
  }
  creerTemps(payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/temps`, payload);
  }

  // Factures & paiements
  factures(statut = '', filtres: { dossier_id?: string; client_id?: string } = {}): Observable<any[]> {
    const params = new URLSearchParams();
    if (statut) params.set('statut', statut);
    if (filtres.dossier_id) params.set('dossier_id', filtres.dossier_id);
    if (filtres.client_id) params.set('client_id', filtres.client_id);
    const q = params.toString() ? `?${params.toString()}` : '';
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
  annulerFacture(id: string): Observable<any> {
    return this.http.post<any>(`${this.base}/api/factures/${id}/annuler`, {});
  }
  // Support « papier numérique » de la facture (25/08/2026) — généré à la
  // volée, pas stocké en GED (voir facturePdf.js).
  telechargerFacturePdf(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/api/factures/${id}/pdf`, { responseType: 'blob' });
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
  validerTache(id: string): Observable<any> {
    return this.http.post<any>(`${this.base}/api/taches/${id}/valider`, {});
  }

  // Annuaire interne — par défaut, comptes actifs seulement ; passer explicitement `undefined` pour tous les comptes.
  utilisateurs(actifsSeuls: boolean | undefined = true): Observable<any[]> {
    const q = actifsSeuls === undefined ? '' : `?actif=${actifsSeuls}`;
    return this.http.get<any[]>(`${this.base}/api/utilisateurs${q}`);
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

  // Atelier d'actes
  modelesActes(): Observable<{ code: string; nom: string; categorie: string }[]> {
    return this.http.get<{ code: string; nom: string; categorie: string }[]>(`${this.base}/api/actes/modeles`);
  }
  genererActe(payload: { dossier_id: string; mode: 'modele' | 'ia'; modele_code?: string; instructions_ia?: string }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/actes/generer`, payload);
  }

  // Bibliothèque
  biblio(filtres: { type?: string; matiere?: string; q?: string } = {}): Observable<any[]> {
    const params = new URLSearchParams();
    Object.entries(filtres).forEach(([k, v]) => { if (v) params.set(k, v); });
    const q = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<any[]>(`${this.base}/api/biblio${q}`);
  }
  creerRessourceBiblio(payload: any, fichier: File | null): Observable<any> {
    const fd = new FormData();
    Object.entries(payload).forEach(([k, v]) => { if (v) fd.append(k, v as string); });
    if (fichier) fd.append('fichier', fichier);
    return this.http.post<any>(`${this.base}/api/biblio`, fd);
  }
  supprimerRessourceBiblio(id: string): Observable<any> {
    return this.http.delete(`${this.base}/api/biblio/${id}`);
  }
  telechargerFichierBiblio(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/api/biblio/${id}/fichier`, { responseType: 'blob' });
  }

  // Dépenses & caisse
  depenses(filtres: { type?: string; statut?: string; dossier_id?: string; a_refacturer?: boolean } = {}): Observable<any[]> {
    const params = new URLSearchParams();
    Object.entries(filtres).forEach(([k, v]) => { if (v) params.set(k, String(v)); });
    const q = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<any[]>(`${this.base}/api/depenses${q}`);
  }
  // Débours décaissés, refacturables au client, pas encore rattachés à une
  // facture (voir "Facturer un dossier" dans l'écran Facturation).
  depensesARefacturer(dossierId: string): Observable<any[]> {
    return this.depenses({ dossier_id: dossierId, a_refacturer: true });
  }
  creerDepense(payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/depenses`, payload);
  }
  decisionDepense(id: string, payload: { statut: 'validee' | 'rejetee'; motif_rejet?: string }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/depenses/${id}/decision`, payload);
  }
  decaisserDepense(id: string): Observable<any> {
    return this.http.post<any>(`${this.base}/api/depenses/${id}/decaisser`, {});
  }
  comptesBancaires(): Observable<{ id: string; intitule: string; type: string }[]> {
    return this.http.get<{ id: string; intitule: string; type: string }[]>(`${this.base}/api/depenses/comptes`);
  }
  petiteCaisse(mois?: string): Observable<any> {
    const q = mois ? `?mois=${mois}` : '';
    return this.http.get<any>(`${this.base}/api/depenses/petite-caisse${q}`);
  }
  definirDotationCaisse(mois: string, montant_alloue: number): Observable<any> {
    return this.http.post<any>(`${this.base}/api/depenses/petite-caisse`, { mois, montant_alloue });
  }
  stockVignettes(): Observable<{ stock: number }> {
    return this.http.get<{ stock: number }>(`${this.base}/api/depenses/vignettes/stock`);
  }
  mouvementVignettes(payload: { mouvement: 'achat' | 'utilisation'; quantite: number; dossier_id?: string; refacturee?: boolean }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/depenses/vignettes`, payload);
  }

  // Rétrocessions d'honoraires
  qualitesRetro(): Observable<{ code: string; libelle: string; taux: number }[]> {
    return this.http.get<{ code: string; libelle: string; taux: number }[]>(`${this.base}/api/retrocessions/qualites`);
  }
  retrocessions(filtres: { beneficiaire_id?: string; statut?: string } = {}): Observable<any[]> {
    const params = new URLSearchParams();
    Object.entries(filtres).forEach(([k, v]) => { if (v) params.set(k, v); });
    const q = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<any[]>(`${this.base}/api/retrocessions${q}`);
  }
  creerRetrocession(payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/retrocessions`, payload);
  }
  decaisserRetrocession(id: string): Observable<any> {
    return this.http.post<any>(`${this.base}/api/retrocessions/${id}/decaisser`, {});
  }
  proBono(mois?: string): Observable<any[]> {
    const q = mois ? `?mois=${mois}` : '';
    return this.http.get<any[]>(`${this.base}/api/retrocessions/pro-bono${q}`);
  }

  // Profil personnel (tout utilisateur authentifié)
  monProfil(): Observable<any> {
    return this.http.get<any>(`${this.base}/api/profil`);
  }
  changerMotDePasse(ancien_mot_de_passe: string, nouveau_mot_de_passe: string): Observable<any> {
    return this.http.put<any>(`${this.base}/api/profil/mot-de-passe`, { ancien_mot_de_passe, nouveau_mot_de_passe });
  }

  // Accès & permissions (réservé associé/admin)
  creerCompte(payload: { code: string; prenom: string; nom: string; email: string; role: string; pole?: string }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/acces/utilisateurs`, payload);
  }
  validerCompte(id: string): Observable<any> {
    return this.http.post<any>(`${this.base}/api/acces/utilisateurs/${id}/valider`, {});
  }
  reinitialiserMotDePasse(id: string): Observable<any> {
    return this.http.post<any>(`${this.base}/api/acces/utilisateurs/${id}/reinitialiser-mot-de-passe`, {});
  }
  majRoleUtilisateur(id: string, role: string): Observable<any> {
    return this.http.put<any>(`${this.base}/api/acces/utilisateurs/${id}/role`, { role });
  }
  majActifUtilisateur(id: string, actif: boolean): Observable<any> {
    return this.http.put<any>(`${this.base}/api/acces/utilisateurs/${id}/actif`, { actif });
  }
  delegations(filtres: { utilisateur_id?: string; actif?: boolean } = {}): Observable<any[]> {
    const params = new URLSearchParams();
    if (filtres.utilisateur_id) params.set('utilisateur_id', filtres.utilisateur_id);
    if (filtres.actif !== undefined) params.set('actif', String(filtres.actif));
    const q = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<any[]>(`${this.base}/api/acces/delegations${q}`);
  }
  creerDelegation(payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/acces/delegations`, payload);
  }
  revoquerDelegation(id: string): Observable<any> {
    return this.http.post<any>(`${this.base}/api/acces/delegations/${id}/revoquer`, {});
  }
  journalAudit(limit = 100): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/api/acces/audit?limit=${limit}`);
  }
  permissionsMatrice(): Observable<{ catalogue: any[]; roles: string[]; valeurs: Record<string, boolean> }> {
    return this.http.get<any>(`${this.base}/api/acces/permissions`);
  }
  majPermission(role: string, action_code: string, autorise: boolean): Observable<any> {
    return this.http.put<any>(`${this.base}/api/acces/permissions`, { role, action_code, autorise });
  }

  // Seuils d'honoraires minimum + quota pro bono (anti-dissimulation)
  parametresHonoraires(): Observable<ParametresHonoraires> {
    return this.http.get<ParametresHonoraires>(`${this.base}/api/parametres/honoraires`);
  }
  majParametresHonoraires(payload: Partial<ParametresHonoraires>): Observable<ParametresHonoraires> {
    return this.http.put<ParametresHonoraires>(`${this.base}/api/parametres/honoraires`, payload);
  }

  // Identité du cabinet + comptes bancaires (28/08/2026, facture PDF enrichie)
  parametresCabinet(): Observable<ParametresCabinet> {
    return this.http.get<ParametresCabinet>(`${this.base}/api/parametres/cabinet`);
  }
  majParametresCabinet(payload: Partial<ParametresCabinet>): Observable<ParametresCabinet> {
    return this.http.put<ParametresCabinet>(`${this.base}/api/parametres/cabinet`, payload);
  }
  // Liste complète (actifs + inactifs, RIB inclus) pour la gestion — à
  // distinguer de comptesBancaires() ci-dessous (liste allégée, actifs
  // seulement, pour les sélecteurs de règlement).
  comptesBancairesGestion(): Observable<CompteBancaire[]> {
    return this.http.get<CompteBancaire[]>(`${this.base}/api/parametres/comptes-bancaires`);
  }
  creerCompteBancaire(payload: Partial<CompteBancaire>): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/api/parametres/comptes-bancaires`, payload);
  }
  majCompteBancaire(id: string, payload: Partial<CompteBancaire>): Observable<{ id: string }> {
    return this.http.put<{ id: string }>(`${this.base}/api/parametres/comptes-bancaires/${id}`, payload);
  }

  // Cabinet (RH)
  equipeCabinet(): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/api/cabinet/equipe`);
  }
  echeancesRh(): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/api/cabinet/echeances`);
  }
  conges(filtres: { utilisateur_id?: string; statut?: string } = {}): Observable<any[]> {
    const params = new URLSearchParams();
    Object.entries(filtres).forEach(([k, v]) => { if (v) params.set(k, v); });
    const q = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<any[]>(`${this.base}/api/cabinet/conges${q}`);
  }
  demanderConge(payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/cabinet/conges`, payload);
  }
  decisionConge(id: string, statut: 'approuve' | 'refuse'): Observable<any> {
    return this.http.post<any>(`${this.base}/api/cabinet/conges/${id}/decision`, { statut });
  }
  presencesMois(mois?: string): Observable<any> {
    const q = mois ? `?mois=${mois}` : '';
    return this.http.get<any>(`${this.base}/api/cabinet/presences${q}`);
  }
  pointer(payload: { heure_arrivee?: string; heure_depart?: string; heures?: number }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/cabinet/presences`, payload);
  }
  bulletinsPaie(utilisateurId?: string): Observable<any[]> {
    const q = utilisateurId ? `?utilisateur_id=${utilisateurId}` : '';
    return this.http.get<any[]>(`${this.base}/api/cabinet/bulletins${q}`);
  }
  creerBulletinPaie(payload: any): Observable<any> {
    return this.http.post<any>(`${this.base}/api/cabinet/bulletins`, payload);
  }

  // Assistant IA (résultat toujours « projet à valider »)
  iaResume(payload: { texte?: string; document_id?: string }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/ia/resume`, payload);
  }
  iaChronologie(payload: { texte?: string; dossier_id?: string }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/ia/chronologie`, payload);
  }
  iaExtractionFaits(payload: { texte?: string; document_id?: string; dossier_id?: string }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/ia/extraction-faits`, payload);
  }
  iaAnalyseContrat(payload: { texte?: string; document_id?: string }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/ia/analyse-contrat`, payload);
  }
  iaTraduction(payload: { texte?: string; document_id?: string; langue_cible?: string }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/ia/traduction`, payload);
  }
  iaComparaison(payload: { texte_a: string; texte_b: string }): Observable<any> {
    return this.http.post<any>(`${this.base}/api/ia/comparaison`, payload);
  }
}
