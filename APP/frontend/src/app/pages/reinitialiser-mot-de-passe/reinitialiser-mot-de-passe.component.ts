import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';

// Écran atteint depuis le lien reçu par e-mail (?token=...). Le jeton est
// à usage unique et expire après 1h côté serveur — les erreurs (lien
// invalide/expiré/déjà utilisé) sont affichées telles quelles, sans
// distinguer les cas (le serveur ne le fait pas non plus, pas d'info à
// deviner sur l'état exact du jeton).
@Component({
  selector: 'app-reinitialiser-mot-de-passe',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="login-wrap">
      <div class="login-card">
        <div class="brand-lg">JURIA</div>
        <p class="tagline">Cabinet JFC Avocats — Mali</p>

        @if (!token) {
          <p class="err">Lien invalide — aucun jeton fourni.</p>
        } @else if (reussi()) {
          <p class="confirmation">Votre mot de passe a été réinitialisé. Vous pouvez vous connecter.</p>
        } @else {
          <form (ngSubmit)="soumettre()">
            <label>Nouveau mot de passe</label>
            <input type="password" name="mdp" [(ngModel)]="motDePasse" required autocomplete="new-password" />

            <label>Confirmer le mot de passe</label>
            <input type="password" name="mdpConfirm" [(ngModel)]="motDePasseConfirm" required autocomplete="new-password" />

            @if (erreur()) { <p class="err">{{ erreur() }}</p> }

            <button type="submit" [disabled]="chargement() || !motDePasse">
              {{ chargement() ? 'Enregistrement…' : 'Réinitialiser le mot de passe' }}
            </button>
          </form>
        }

        <a class="lien-oublie" routerLink="/login">← Retour à la connexion</a>
      </div>
    </div>
  `,
  styles: [`
    /* Même correctif que mot-de-passe-oublie.component.ts : .login-card
       (styles.css) attend d'être posée sur le <form> lui-même. */
    form{display:flex;flex-direction:column}
    .confirmation{font-size:13.5px;color:var(--slate);line-height:1.5;margin:10px 0 0}
    .lien-oublie{display:block;text-align:center;margin-top:18px;font-size:12.5px;color:var(--gold);text-decoration:none}
    .lien-oublie:hover{text-decoration:underline}
  `],
})
export class ReinitialiserMotDePasseComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  token = '';
  motDePasse = '';
  motDePasseConfirm = '';
  readonly reussi = signal(false);
  readonly erreur = signal('');
  readonly chargement = signal(false);

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
  }

  soumettre(): void {
    if (!this.motDePasse) return;
    if (this.motDePasse.length < 8) {
      this.erreur.set('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (this.motDePasse !== this.motDePasseConfirm) {
      this.erreur.set('Les deux mots de passe ne correspondent pas.');
      return;
    }
    this.chargement.set(true);
    this.erreur.set('');
    this.auth.reinitialiserMotDePasse(this.token, this.motDePasse).subscribe({
      next: () => {
        this.chargement.set(false);
        this.reussi.set(true);
        setTimeout(() => this.router.navigate(['/login']), 2500);
      },
      error: (e) => { this.chargement.set(false); this.erreur.set(e?.error?.error ?? 'Réinitialisation impossible.'); },
    });
  }
}
