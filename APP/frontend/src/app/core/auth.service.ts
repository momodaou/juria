import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Utilisateur {
  id: string;
  nom: string;
  role: string;
}

interface ReponseLogin {
  token: string;
  utilisateur: Utilisateur;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly tokenKey = 'juria_token';
  readonly utilisateur = signal<Utilisateur | null>(null);
  /** Actions autorisées pour le rôle courant (permissions_role, autorise=TRUE) —
   * sert à masquer les sections/menus sensibles côté écran (facturation,
   * rétrocessions, dépenses, bulletins de paie « des autres »). */
  readonly permissions = signal<Set<string>>(new Set());

  constructor(private http: HttpClient) {}

  /** Recharge profil + permissions depuis le serveur — à appeler après une
   * connexion réussie et au démarrage de l'appli si un jeton existe déjà
   * (rechargement de page). */
  chargerProfil(): void {
    if (!this.token) return;
    this.http.get<any>(`${environment.apiUrl}/api/profil`).subscribe({
      next: (p) => {
        this.utilisateur.set({ id: p.id, nom: `${p.prenom} ${p.nom}`, role: p.role });
        this.permissions.set(new Set(p.permissions || []));
      },
      error: () => {},
    });
  }

  peut(actionCode: string): boolean {
    return this.permissions().has(actionCode);
  }

  login(email: string, motDePasse: string): Observable<ReponseLogin> {
    return this.http
      .post<ReponseLogin>(`${environment.apiUrl}/auth/login`, {
        email,
        mot_de_passe: motDePasse,
      })
      .pipe(
        tap((r) => {
          localStorage.setItem(this.tokenKey, r.token);
          this.utilisateur.set(r.utilisateur);
        })
      );
  }

  // Réinitialisation de mot de passe en libre-service (31/08/2026).
  demanderReinitialisation(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${environment.apiUrl}/auth/mot-de-passe-oublie`, { email });
  }

  reinitialiserMotDePasse(token: string, nouveauMotDePasse: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${environment.apiUrl}/auth/reinitialiser-mot-de-passe`, {
      token,
      nouveau_mot_de_passe: nouveauMotDePasse,
    });
  }

  get token(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  get estConnecte(): boolean {
    return !!this.token;
  }

  logout(): void {
    localStorage.removeItem(this.tokenKey);
    this.utilisateur.set(null);
  }
}
