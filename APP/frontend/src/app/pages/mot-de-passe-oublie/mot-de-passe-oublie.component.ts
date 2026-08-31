import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';

// Réinitialisation de mot de passe en libre-service (31/08/2026) — comble
// le gap documenté depuis le 17/08/2026 (l'utilisateur devait jusqu'ici
// demander à un associé/admin). Réponse toujours identique côté serveur
// que l'adresse corresponde à un compte ou non (anti-énumération) — cet
// écran affiche donc toujours la même confirmation neutre après envoi.
@Component({
  selector: 'app-mot-de-passe-oublie',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="login-wrap">
      <div class="login-card">
        <div class="brand-lg">JURIA</div>
        <p class="tagline">Cabinet JFC Avocats — Mali</p>

        @if (envoye()) {
          <p class="confirmation">
            Si un compte existe avec cette adresse, un lien de réinitialisation vient d'être envoyé.
            Vérifiez votre boîte mail (le lien est valable 1 heure).
          </p>
        } @else {
          <form (ngSubmit)="soumettre()">
            <label>Adresse e-mail</label>
            <input type="email" name="email" [(ngModel)]="email" required autocomplete="username" />

            @if (erreur()) { <p class="err">{{ erreur() }}</p> }

            <button type="submit" [disabled]="chargement() || !email">
              {{ chargement() ? 'Envoi…' : 'Envoyer le lien de réinitialisation' }}
            </button>
          </form>
        }

        <a class="lien-oublie" routerLink="/login">← Retour à la connexion</a>
      </div>
    </div>
  `,
  styles: [`
    /* .login-card (styles.css) attend d'être posée directement sur le
       <form> pour que son display:flex;flex-direction:column empile
       label/input — ici la carte englobe aussi un état "confirmation"
       sans formulaire, donc le <form> reste imbriqué : on lui redonne la
       même disposition en colonne localement. */
    form{display:flex;flex-direction:column}
    .confirmation{font-size:13.5px;color:var(--slate);line-height:1.5;margin:10px 0 0}
    .lien-oublie{display:block;text-align:center;margin-top:18px;font-size:12.5px;color:var(--gold);text-decoration:none}
    .lien-oublie:hover{text-decoration:underline}
  `],
})
export class MotDePasseOublieComponent {
  private readonly auth = inject(AuthService);

  email = '';
  readonly envoye = signal(false);
  readonly erreur = signal('');
  readonly chargement = signal(false);

  soumettre(): void {
    if (!this.email) return;
    this.chargement.set(true);
    this.erreur.set('');
    this.auth.demanderReinitialisation(this.email).subscribe({
      next: () => { this.chargement.set(false); this.envoye.set(true); },
      error: (e) => { this.chargement.set(false); this.erreur.set(e?.error?.error ?? 'Envoi impossible.'); },
    });
  }
}
