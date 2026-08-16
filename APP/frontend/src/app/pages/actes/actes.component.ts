import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, Dossier } from '../../core/api.service';

@Component({
  selector: 'app-actes',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <header class="page-head">
      <div>
        <h1>Atelier d'actes</h1>
        <p>Génération d'un acte à partir d'un modèle (en-tête cabinet) ou d'un brouillon Assistant IA — toujours à valider par l'avocat.</p>
      </div>
    </header>

    <section class="panel">
      <h3>1. Dossier concerné</h3>
      <input class="in" [(ngModel)]="dossierRecherche" name="dossierRecherche"
             (ngModelChange)="rechercherDossiers()" placeholder="Rechercher un dossier par numéro ou intitulé…" />
      @if (dossierResultats().length) {
        <div class="suggestions">
          @for (d of dossierResultats(); track d.id) {
            <button type="button" class="chip" (click)="choisirDossier(d)">{{ d.numero }} — {{ d.intitule }}</button>
          }
        </div>
      }
      @if (dossierId) { <p class="muted">Sélectionné : {{ dossierLabel }}</p> }
    </section>

    <section class="panel">
      <h3>2. Source du contenu</h3>
      <div class="mode-switch">
        <button type="button" class="mode-btn" [class.active]="mode==='modele'" (click)="mode='modele'">Modèle du cabinet</button>
        <button type="button" class="mode-btn" [class.active]="mode==='ia'" (click)="mode='ia'">Assistant IA <span class="ia-tag">projet à valider</span></button>
      </div>

      @if (mode === 'modele') {
        <label>Modèle</label>
        <select class="in" [(ngModel)]="modeleCode" name="modele">
          <option value="">Choisir un modèle…</option>
          @for (m of modeles(); track m.code) { <option [value]="m.code">{{ m.nom }}</option> }
        </select>
      } @else {
        <label>Instructions pour l'IA</label>
        <textarea class="in ta" [(ngModel)]="instructionsIa" name="instructions"
                  placeholder="Ex. Rédiger une demande de renvoi pour production de pièces…"></textarea>
      }

      <button class="btn" (click)="generer()" [disabled]="!peutGenerer() || generation()">
        {{ generation() ? 'Génération…' : 'Générer l\\'acte' }}
      </button>
      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
    </section>

    @if (resultat(); as r) {
      <section class="panel">
        <h3>Résultat — {{ r.nom }} <span class="tag">{{ r.statut }}</span></h3>
        <p class="muted">Enregistré dans la GED du dossier
          (<a [routerLink]="['/dossiers', dossierId]">voir la fiche dossier</a>).</p>
        <pre class="apercu">{{ r.texte }}</pre>
      </section>
    }
  `,
  styles: [`
    .in{display:block;width:100%;max-width:560px;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:14px;font-family:inherit}
    .ta{min-height:90px;resize:vertical}
    label{font-size:12px;color:var(--slate);font-weight:600}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .suggestions{display:flex;flex-wrap:wrap;gap:6px;margin:-6px 0 12px}
    .chip{background:#fff;border:1px solid var(--line);border-radius:12px;padding:5px 11px;font-size:12.5px;cursor:pointer}
    .mode-switch{display:flex;gap:8px;margin-bottom:14px}
    .mode-btn{background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;color:var(--slate)}
    .mode-btn.active{background:var(--navy);color:#fff;border-color:var(--navy)}
    .ia-tag{background:#eef;border:1px solid #d5d9f5;color:#43489a;border-radius:12px;padding:1px 7px;font-size:10.5px;font-weight:600;margin-left:4px}
    .apercu{white-space:pre-wrap;font-family:'Segoe UI',system-ui,sans-serif;font-size:13.5px;background:#f7f9fc;border:1px solid var(--line);border-radius:8px;padding:16px;max-height:520px;overflow-y:auto}
  `],
})
export class ActesComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly modeles = signal<{ code: string; nom: string; categorie: string }[]>([]);
  readonly dossierResultats = signal<Dossier[]>([]);
  readonly resultat = signal<any | null>(null);
  readonly erreur = signal('');
  readonly generation = signal(false);

  dossierRecherche = '';
  dossierLabel = '';
  dossierId = '';
  mode: 'modele' | 'ia' = 'modele';
  modeleCode = '';
  instructionsIa = '';

  ngOnInit(): void {
    this.api.modelesActes().subscribe({ next: (m) => this.modeles.set(m) });
  }

  rechercherDossiers(): void {
    this.dossierId = '';
    if (this.dossierRecherche.length < 2) { this.dossierResultats.set([]); return; }
    this.api.dossiers(this.dossierRecherche).subscribe({ next: (d) => this.dossierResultats.set(d) });
  }

  choisirDossier(d: Dossier): void {
    this.dossierId = d.id;
    this.dossierLabel = `${d.numero} — ${d.intitule}`;
    this.dossierResultats.set([]);
    this.dossierRecherche = '';
  }

  peutGenerer(): boolean {
    if (!this.dossierId) return false;
    return this.mode === 'modele' ? !!this.modeleCode : !!this.instructionsIa;
  }

  generer(): void {
    this.generation.set(true);
    this.erreur.set('');
    this.resultat.set(null);
    const payload: any = { dossier_id: this.dossierId, mode: this.mode };
    if (this.mode === 'modele') payload.modele_code = this.modeleCode;
    else payload.instructions_ia = this.instructionsIa;

    this.api.genererActe(payload).subscribe({
      next: (r) => { this.generation.set(false); this.resultat.set(r); },
      error: (e) => { this.generation.set(false); this.erreur.set(e?.error?.error ?? 'Génération impossible.'); },
    });
  }
}
