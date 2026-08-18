import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { MessagerieService } from '../../core/messagerie.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="login-wrap">
      <form class="login-card" (ngSubmit)="soumettre()">
        <div class="brand-lg">JURIA</div>
        <p class="tagline">Cabinet JFC Avocats — Mali</p>

        <label>Adresse e-mail</label>
        <input type="email" name="email" [(ngModel)]="email" required autocomplete="username" />

        <label>Mot de passe</label>
        <input type="password" name="mdp" [(ngModel)]="motDePasse" required autocomplete="current-password" />

        @if (erreur()) { <p class="err">{{ erreur() }}</p> }

        <button type="submit" [disabled]="chargement()">
          {{ chargement() ? 'Connexion…' : 'Se connecter' }}
        </button>
      </form>
    </div>
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly messagerie = inject(MessagerieService);
  private readonly router = inject(Router);

  email = '';
  motDePasse = '';
  readonly erreur = signal('');
  readonly chargement = signal(false);

  soumettre(): void {
    if (!this.email || !this.motDePasse) return;
    this.chargement.set(true);
    this.erreur.set('');
    this.auth.login(this.email, this.motDePasse).subscribe({
      next: () => {
        this.chargement.set(false);
        this.messagerie.demarrer();
        this.auth.chargerProfil();
        this.router.navigate(['/cockpit']);
      },
      error: (e) => {
        this.chargement.set(false);
        this.erreur.set(e?.error?.error ?? 'Connexion impossible');
      },
    });
  }
}
