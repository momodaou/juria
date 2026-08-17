import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-mon-compte',
  standalone: true,
  imports: [FormsModule],
  template: `
    <header class="page-head">
      <div>
        <h1>Mon compte</h1>
        <p>Vos informations et votre mot de passe.</p>
      </div>
    </header>

    @if (profil(); as p) {
      <section class="panel">
        <h3>Informations</h3>
        <div class="meta">
          <div><span>Nom</span><b>{{ p.prenom }} {{ p.nom }}</b></div>
          <div><span>Code</span><b>{{ p.code }}</b></div>
          <div><span>Email</span><b>{{ p.email }}</b></div>
          <div><span>Rôle</span><b>{{ p.role }}</b></div>
        </div>
      </section>
    }

    <section class="panel">
      <h3>Changer mon mot de passe</h3>
      <label>Mot de passe actuel</label>
      <input class="in" type="password" [(ngModel)]="ancien" name="ancien" autocomplete="current-password" />
      <label>Nouveau mot de passe</label>
      <input class="in" type="password" [(ngModel)]="nouveau" name="nouveau" autocomplete="new-password" />
      <label>Confirmer le nouveau mot de passe</label>
      <input class="in" type="password" [(ngModel)]="confirmation" name="confirmation" autocomplete="new-password" />
      <p class="muted">Au moins 8 caractères, différent du mot de passe actuel.</p>

      <button class="btn" (click)="changer()" [disabled]="!peutChanger() || enCours()">
        {{ enCours() ? 'Enregistrement…' : 'Changer le mot de passe' }}
      </button>

      @if (succes()) { <p class="ok-msg">✓ Mot de passe changé avec succès.</p> }
      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
    </section>
  `,
  styles: [`
    .in{display:block;width:100%;max-width:360px;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:14px}
    label{font-size:12px;color:var(--slate);font-weight:600}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .meta{display:flex;gap:28px;flex-wrap:wrap}
    .meta span{display:block;font-size:11px;color:var(--grey)}
    .meta b{font-size:14px}
    .ok-msg{color:var(--green);font-size:13px;margin-top:10px}
  `],
})
export class MonCompteComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly profil = signal<any | null>(null);
  readonly enCours = signal(false);
  readonly succes = signal(false);
  readonly erreur = signal('');

  ancien = '';
  nouveau = '';
  confirmation = '';

  ngOnInit(): void {
    this.api.monProfil().subscribe({ next: (p) => this.profil.set(p) });
  }

  peutChanger(): boolean {
    return !!this.ancien && !!this.nouveau && this.nouveau === this.confirmation;
  }

  changer(): void {
    this.enCours.set(true);
    this.succes.set(false);
    this.erreur.set('');
    if (this.nouveau !== this.confirmation) {
      this.enCours.set(false);
      this.erreur.set('La confirmation ne correspond pas au nouveau mot de passe.');
      return;
    }
    this.api.changerMotDePasse(this.ancien, this.nouveau).subscribe({
      next: () => {
        this.enCours.set(false);
        this.succes.set(true);
        this.ancien = '';
        this.nouveau = '';
        this.confirmation = '';
      },
      error: (e) => { this.enCours.set(false); this.erreur.set(e?.error?.error ?? 'Changement impossible.'); },
    });
  }
}
