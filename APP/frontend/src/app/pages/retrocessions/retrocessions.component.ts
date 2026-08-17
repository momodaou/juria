import { Component, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Dossier } from '../../core/api.service';

@Component({
  selector: 'app-retrocessions',
  standalone: true,
  imports: [DecimalPipe, FormsModule],
  template: `
    <header class="page-head">
      <div>
        <h1>Rétrocessions</h1>
        <p>Calcul et suivi des rétrocessions d'honoraires — règle « tout ou rien » (décaissable seulement après encaissement intégral).</p>
      </div>
      <button class="btn" (click)="afficherForm.set(!afficherForm())">
        {{ afficherForm() ? 'Annuler' : '+ Nouvelle rétrocession' }}
      </button>
    </header>

    <section class="panel">
      <h3>Pro Bono — quota mensuel (2 dossiers / associé, non reportable)</h3>
      @if (proBono().length) {
        <table>
          <tr><th>Associé</th><th>Utilisés</th><th>Restants</th></tr>
          @for (p of proBono(); track p.associe_id) {
            <tr>
              <td>{{ p.associe }}</td>
              <td>{{ p.utilises }} / {{ p.quota }}</td>
              <td><span class="tag" [class.haute]="p.restants === 0" [class.ok]="p.restants > 0">{{ p.restants }}</span></td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucun associé actif.</p> }
    </section>

    @if (afficherForm()) {
      <section class="panel">
        <h3>Nouvelle rétrocession</h3>
        <div class="grid2">
          <div>
            <label>Bénéficiaire</label>
            <select class="in" [(ngModel)]="form.beneficiaire_id" name="beneficiaire" (ngModelChange)="onQualiteAuto()">
              <option value="">—</option>
              @for (u of utilisateurs(); track u.id) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }} ({{ u.role }})</option> }
            </select>
          </div>
          <div>
            <label>Qualité</label>
            <select class="in" [(ngModel)]="form.qualite" name="qualite">
              @for (q of qualites(); track q.code) { <option [value]="q.code">{{ q.libelle }} — {{ q.taux }} %</option> }
            </select>
          </div>
          <div><label>Base HT (FCFA)</label><input class="in" type="number" [(ngModel)]="form.base_ht" name="baseHt" /></div>
          <div><label>Taux appliqué (%, optionnel)</label><input class="in" type="number" [(ngModel)]="form.taux" name="taux" placeholder="Par défaut selon la qualité" /></div>
          <div class="col2">
            <label>Dossier (optionnel)</label>
            <input class="in" [(ngModel)]="dossierRecherche" name="dossierRecherche"
                   (ngModelChange)="rechercherDossiers()" placeholder="Rechercher un dossier…" />
            @if (dossierResultats().length) {
              <div class="suggestions">
                @for (d of dossierResultats(); track d.id) {
                  <button type="button" class="chip" (click)="choisirDossier(d)">{{ d.numero }} — {{ d.intitule }}</button>
                }
              </div>
            }
            @if (form.dossier_id) { <p class="muted">Sélectionné : {{ dossierLabel }}</p> }
          </div>
        </div>
        <button class="btn" (click)="creer()" [disabled]="!form.beneficiaire_id || !form.qualite || !form.base_ht">Créer</button>
        @if (erreur()) { <p class="err">{{ erreur() }}</p> }
      </section>
    }

    <section class="panel">
      @if (retros().length) {
        <table>
          <tr><th>Bénéficiaire</th><th>Qualité</th><th>Base HT</th><th>Taux</th><th>Montant</th><th>Dossier</th><th>Statut</th><th></th></tr>
          @for (r of retros(); track r.id) {
            <tr>
              <td>{{ r.beneficiaire }}</td>
              <td>{{ r.qualite }}</td>
              <td>{{ r.base_ht | number }} FCFA</td>
              <td>{{ r.taux }} %</td>
              <td><b>{{ r.montant | number }} FCFA</b></td>
              <td>{{ r.dossier_numero || '—' }}</td>
              <td>
                <span class="tag" [class.ok]="r.statut==='decaissee'">{{ r.statut }}</span>
                @if (r.facture_numero && !r.honoraires_encaisses) { <span class="tag haute">non encaissée</span> }
              </td>
              <td>
                @if (r.statut !== 'decaissee') {
                  <button class="lien" (click)="decaisser(r)" [disabled]="r.facture_numero && !r.honoraires_encaisses">Décaisser</button>
                }
              </td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucune rétrocession.</p> }
    </section>
  `,
  styles: [`
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:14px}
    label{font-size:12px;color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:680px}
    .col2{grid-column:1 / -1}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .suggestions{display:flex;flex-wrap:wrap;gap:6px;margin:-6px 0 12px}
    .chip{background:#fff;border:1px solid var(--line);border-radius:12px;padding:5px 11px;font-size:12.5px;cursor:pointer}
    .lien{background:none;border:none;color:var(--gold);cursor:pointer;font-size:12.5px;padding:0}
    .lien:disabled{opacity:.4;cursor:not-allowed}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    .tag.haute{background:#fbe6e5;color:#b13a36}
  `],
})
export class RetrocessionsComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly retros = signal<any[]>([]);
  readonly qualites = signal<{ code: string; libelle: string; taux: number }[]>([]);
  readonly utilisateurs = signal<any[]>([]);
  readonly proBono = signal<any[]>([]);
  readonly dossierResultats = signal<Dossier[]>([]);
  readonly afficherForm = signal(false);
  readonly erreur = signal('');

  dossierRecherche = '';
  dossierLabel = '';
  form: any = { qualite: 'associe' };

  ngOnInit(): void {
    this.charger();
    this.api.qualitesRetro().subscribe({ next: (q) => this.qualites.set(q) });
    this.api.utilisateurs().subscribe({ next: (u) => this.utilisateurs.set(u) });
    this.api.proBono().subscribe({ next: (p) => this.proBono.set(p) });
  }

  charger(): void {
    this.api.retrocessions().subscribe({ next: (r) => this.retros.set(r) });
  }

  // Suggestion automatique de la qualité de rétrocession à partir du rôle
  // d'accès du bénéficiaire (toujours modifiable ensuite à la main) :
  // associé/associé-fondateur -> 30% ; avocat collaborateur/Of Counsel/
  // avocat stagiaire -> 25% (règle du cahier des charges) ; tout profil
  // non-avocat, y compris le stagiaire simple -> 10%.
  onQualiteAuto(): void {
    const u = this.utilisateurs().find((x) => x.id === this.form.beneficiaire_id);
    if (!u) return;
    const ROLES_ASSOCIES = ['associe', 'associe_fondateur'];
    const ROLES_AVOCATS_COLLABORATEURS = ['of_counsel', 'collaborateur', 'avocat_stagiaire'];
    if (ROLES_ASSOCIES.includes(u.role)) this.form.qualite = 'associe';
    else if (ROLES_AVOCATS_COLLABORATEURS.includes(u.role)) this.form.qualite = 'collaborateur';
    else this.form.qualite = 'non_avocat';
  }

  rechercherDossiers(): void {
    this.form.dossier_id = null;
    if (this.dossierRecherche.length < 2) { this.dossierResultats.set([]); return; }
    this.api.dossiers(this.dossierRecherche).subscribe({ next: (d) => this.dossierResultats.set(d) });
  }

  choisirDossier(d: Dossier): void {
    this.form.dossier_id = d.id;
    this.dossierLabel = `${d.numero} — ${d.intitule}`;
    this.dossierResultats.set([]);
    this.dossierRecherche = '';
  }

  creer(): void {
    this.erreur.set('');
    this.api.creerRetrocession(this.form).subscribe({
      next: () => {
        this.afficherForm.set(false);
        this.form = { qualite: 'associe' };
        this.dossierLabel = '';
        this.charger();
      },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Création impossible.'),
    });
  }

  decaisser(r: any): void {
    this.api.decaisserRetrocession(r.id).subscribe({
      next: () => this.charger(),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Décaissement impossible.'),
    });
  }
}
