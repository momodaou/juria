import { Component, inject, input, signal, effect } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

// Avocats apporteurs (13/11/2026) : un ou plusieurs avocats, avec leur part en %. La rétrocession se partage entre eux et
// naît automatiquement à l'encaissement intégral de chaque facture éligible (dossiers ouverts à compter de la date d'effet).
// Utilisé dans la fiche dossier (dossierId) et dans la fiche client sous convention-cadre (clientId).
@Component({
  selector: 'app-apporteurs-panel',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  template: `
    @if (auth.peut('retrocessions.consulter') && donnees(); as d) {
      @if (!clientId() || d.sous_convention) {
        <section class="panel apporteurs">
          <h3>Avocats apporteurs</h3>
          @if (dossierId() && d.eligible === false) {
            <p class="muted">Dossier ouvert avant le {{ d.date_effet }} : les rétrocessions ne s'appliquent qu'aux dossiers apportés à compter de cette date.</p>
          } @else {
            @if (clientId()) {
              <div class="conv">
                <label>Rétrocession de cette convention</label>
                <select class="in" [ngModel]="d.retro_abonnement" (ngModelChange)="changerConvention($event)" [disabled]="!auth.peut('retrocessions.creer')" name="retroConvention">
                  <option value="aucune">Aucune rétrocession</option>
                  <option value="une_fois">Une seule fois, à la première exécution (sur le montant convenu)</option>
                </select>
              </div>
            }
            @if (!edition()) {
              @if (d.apporteurs.length) {
                <table>
                  <tr><th>Avocat</th><th>Qualité</th><th>Part</th><th>Taux appliqué</th></tr>
                  @for (a of d.apporteurs; track a.utilisateur_id) {
                    <tr><td>{{ a.nom }}</td><td>{{ a.qualite === 'associe' ? 'Associé' : 'Collab. avocat / stagiaire / Of Counsel' }}</td><td>{{ a.part_pct | number:'1.0-2' }} %</td><td>{{ a.taux }} %</td></tr>
                  }
                </table>
              } @else {
                <p class="muted">Aucun avocat apporteur désigné : aucune rétrocession ne sera calculée.</p>
              }
              @if (auth.peut('retrocessions.creer')) {
                <button class="btn ghost" (click)="commencer(d)">{{ d.apporteurs.length ? 'Modifier les apporteurs' : 'Désigner les apporteurs' }}</button>
                @if (d.verrouille) { <span class="muted"> Des rétrocessions existent déjà : seul un associé peut modifier.</span> }
              }
            } @else {
              @for (l of lignes(); track $index; let i = $index) {
                <div class="ligne">
                  <select class="in" [(ngModel)]="l.utilisateur_id" [name]="'appUser' + i">
                    <option value="">— avocat —</option>
                    @for (u of avocats(); track u.id) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
                  </select>
                  <input class="in part" type="number" min="1" max="100" step="0.01" placeholder="Part %" [(ngModel)]="l.part_pct" [name]="'appPart' + i" />
                  <button class="btn ghost" (click)="retirerLigne(i)">Retirer</button>
                </div>
              }
              <p class="muted">Laissez les parts vides pour un partage égal ; sinon elles doivent totaliser 100 %. La rétrocession se partage entre les apporteurs ; chacun applique le taux de sa qualité à sa part.</p>
              <div class="btns">
                <button class="btn ghost" (click)="ajouterLigne()">+ Ajouter un apporteur</button>
                <button class="btn" (click)="enregistrer()" [disabled]="enCours()">Enregistrer</button>
                <button class="btn ghost" (click)="edition.set(false)">Annuler</button>
              </div>
            }
          }
          @if (erreur()) { <p class="err">{{ erreur() }}</p> }
          @if (message()) { <p class="ok-msg">{{ message() }}</p> }
        </section>
      }
    }
  `,
  styles: [`
    .apporteurs .ligne{display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap}
    .apporteurs .ligne .in{margin-bottom:8px}
    .apporteurs .ligne select.in{flex:1 1 240px;width:auto}
    .apporteurs .ligne .part{flex:0 0 110px;width:110px}
    .apporteurs .btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
    .apporteurs .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer}
    .apporteurs .btn.ghost{background:#fff;border:1px solid var(--line);color:var(--slate)}
    .apporteurs .btn:disabled{opacity:.6}
    .apporteurs .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md)}
    .apporteurs label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .apporteurs .ok-msg{color:var(--green);font-size:var(--fs-base);margin-top:8px}
  `],
})
export class ApporteursPanelComponent {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly dossierId = input<string | null>(null);
  readonly clientId = input<string | null>(null);

  readonly donnees = signal<any | null>(null);
  readonly edition = signal(false);
  readonly lignes = signal<{ utilisateur_id: string; part_pct: number | null }[]>([]);
  readonly avocats = signal<any[]>([]);
  readonly erreur = signal('');
  readonly message = signal('');
  readonly enCours = signal(false);
  private readonly rolesAvocats = ['associe', 'associe_fondateur', 'of_counsel', 'collaborateur', 'avocat_stagiaire'];

  constructor() {
    effect(() => {
      const f = { dossier_id: this.dossierId() || undefined, client_id: this.clientId() || undefined };
      if (!f.dossier_id && !f.client_id) return;
      if (!this.auth.peut('retrocessions.consulter')) return;
      this.charger(f);
    });
  }

  private charger(f: { dossier_id?: string; client_id?: string }): void {
    this.api.apporteurs(f).subscribe({ next: (d) => this.donnees.set(d), error: () => this.donnees.set(null) });
  }
  private recharger(): void { this.charger({ dossier_id: this.dossierId() || undefined, client_id: this.clientId() || undefined }); }

  commencer(d: any): void {
    this.erreur.set(''); this.message.set('');
    if (!this.avocats().length) {
      this.api.utilisateurs().subscribe((u) => this.avocats.set(u.filter((x: any) => this.rolesAvocats.includes(x.role))));
    }
    this.lignes.set(d.apporteurs.length
      ? d.apporteurs.map((a: any) => ({ utilisateur_id: a.utilisateur_id, part_pct: a.part_pct }))
      : [{ utilisateur_id: '', part_pct: null }]);
    this.edition.set(true);
  }
  ajouterLigne(): void { this.lignes.update((l) => [...l, { utilisateur_id: '', part_pct: null }]); }
  retirerLigne(i: number): void { this.lignes.update((l) => l.filter((_, k) => k !== i)); }

  enregistrer(): void {
    this.erreur.set(''); this.message.set('');
    const apporteurs = this.lignes().filter((l) => l.utilisateur_id).map((l) => ({
      utilisateur_id: l.utilisateur_id, part_pct: l.part_pct === null || (l.part_pct as any) === '' ? null : Number(l.part_pct),
    }));
    this.enCours.set(true);
    const appel = this.dossierId() ? this.api.definirApporteursDossier(this.dossierId()!, apporteurs) : this.api.definirApporteursClient(this.clientId()!, apporteurs);
    appel.subscribe({
      next: (r) => {
        this.enCours.set(false); this.edition.set(false);
        this.message.set(r.retrocessions_creees ? `${r.retrocessions_creees} rétrocession(s) calculée(s) sur les factures déjà encaissées.` : 'Apporteurs enregistrés.');
        this.recharger();
      },
      error: (e) => { this.enCours.set(false); this.erreur.set(e?.error?.error ?? 'Enregistrement impossible.'); },
    });
  }

  changerConvention(valeur: string): void {
    this.erreur.set(''); this.message.set('');
    this.api.definirConventionRetro(this.clientId()!, valeur).subscribe({
      next: () => { this.message.set('Statut de la convention enregistré.'); this.recharger(); },
      error: (e) => { this.erreur.set(e?.error?.error ?? 'Enregistrement impossible.'); this.recharger(); },
    });
  }
}
