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

  constructor(private http: HttpClient) {}

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
