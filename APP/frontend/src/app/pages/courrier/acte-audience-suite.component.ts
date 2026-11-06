import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { DossierPickerComponent } from '../../core/dossier-picker.component';

// Parcours « Acte reçu avec audience », lot 2 (06/11/2026) : à partir de l'acte déposé (lot 1), choisir le dossier
// (ou en ouvrir un : le contrôle de conflits passe d'abord, puis on revient ici), inscrire l'audience au rôle,
// vérifier, créer. Réservé à la permission « Programmer l'audience d'un acte reçu » (associés par défaut).
@Component({
  selector: 'app-acte-audience-suite',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, DossierPickerComponent],
  template: `
    <header class="page-head">
      <div>
        <h1>Programmer l'audience d'un acte reçu</h1>
        <p><a class="lien" routerLink="/courrier">← Registre du courrier</a></p>
      </div>
    </header>

    @if (erreur()) { <p class="err">{{ erreur() }}</p> }

    @if (courrier(); as c) {
      <section class="panel">
        <b>{{ c.reference }}</b> · {{ c.type_precision || 'Acte' }} reçu de <b>{{ c.correspondant }}</b>
        <span class="muted-sm"> · signifié le {{ c.date_signification ? (c.date_signification | date:'dd/MM/yyyy') : '—' }} · audience indiquée le {{ c.audience_indiquee ? (c.audience_indiquee | date:'dd/MM/yyyy') : '—' }}</span>
      </section>

      @if (fini()) {
        <section class="panel">
          <p class="ok-msg"><b>Audience programmée.</b> Elle est inscrite au rôle de la semaine, l'acte est rangé dans le dossier et une tâche de préparation est confiée à l'avocat.</p>
          <p style="margin-top:12px">
            <a class="btn" [routerLink]="['/dossiers', dossierId]">Ouvrir le dossier</a>
            <a class="lien" style="margin-left:14px" routerLink="/role-audience">Voir le rôle d'audience</a>
          </p>
        </section>
      } @else if (c.audience_programmee_le) {
        <section class="panel"><p class="muted">L'audience de cet acte est déjà programmée.</p></section>
      } @else {
        <div class="etapes">
          <span [class.on]="etape() === 1">1 · Le dossier</span>
          <span [class.on]="etape() === 2">2 · L'audience</span>
          <span [class.on]="etape() === 3">3 · Vérifier</span>
        </div>

        @if (etape() === 1) {
          <section class="panel">
            <h3>Rattacher l'acte à un dossier</h3>
            @if (c.dossier_id) {
              <p class="ok-msg">L'acte est déjà rattaché à un dossier. Passez à l'audience.</p>
            } @else {
              <p class="muted-sm">Dossiers du même client. Un dossier n'existe qu'après le contrôle de conflits : s'il n'y en a pas, ouvrez-le (vous reviendrez ici ensuite).</p>
              @for (d of suggestions(); track d.id) {
                <label class="carte" [class.on]="dossierId === d.id">
                  <input type="radio" name="dossierChoisi" [checked]="dossierId === d.id" (change)="choisir(d.id)" />
                  <span><b>{{ d.numero }}</b> · {{ d.intitule }} <span class="muted-sm">— {{ d.client }}{{ d.juridiction ? ' · ' + d.juridiction : '' }}</span></span>
                </label>
              }
              @if (!suggestions().length) { <p class="muted-sm">Aucun dossier ne correspond au client « {{ c.correspondant }} ».</p> }
              <label style="margin-top:10px">Autre dossier</label>
              <app-dossier-picker [valeur]="autreDossier" (valeurChange)="choisirAutre($event)"></app-dossier-picker>
              <p style="margin-top:10px"><button class="btn ghost" (click)="ouvrirNouveau()">Ouvrir un nouveau dossier</button></p>
            }
            <p style="margin-top:14px"><button class="btn" (click)="etape.set(2)" [disabled]="!c.dossier_id && !dossierId">Suivant : l'audience</button></p>
          </section>
        }

        @if (etape() === 2) {
          <section class="panel">
            <h3>Programmer l'audience</h3>
            <div class="grid2">
              <div><label>Date de l'audience <span class="req">*</span></label><input class="in" type="date" [(ngModel)]="f.date_prevue" name="datePrevue" /></div>
              <div><label>Heure</label><input class="in" type="time" [(ngModel)]="f.heure" name="heure" /></div>
              <div class="col2"><label>Juridiction</label><input class="in" [(ngModel)]="f.juridiction" name="juridiction" placeholder="Ex. Tribunal de commerce de Bamako" /></div>
              <div>
                <label>Type d'audience</label>
                <select class="in" [(ngModel)]="f.type" name="typeAud">
                  <option value="mise_en_etat">Mise en état</option><option value="plaidoirie">Plaidoirie</option>
                  <option value="conciliation">Conciliation</option><option value="refere">Référé</option>
                  <option value="prononce">Prononcé</option><option value="autre">Autre</option>
                </select>
              </div>
              <div>
                <label>Avocat à l'audience</label>
                <select class="in" [(ngModel)]="f.avocat_id" name="avocatAud">
                  <option value="">—</option>
                  @for (m of avocats(); track m.id) { <option [value]="m.id">{{ m.prenom }} {{ m.nom }}</option> }
                </select>
              </div>
              <div class="col2"><label>Instructions (facultatif)</label><textarea class="in" rows="2" [(ngModel)]="f.instructions" name="instr"></textarea></div>
            </div>
            @if (urgente()) {
              <p class="alerte">{{ jours()! < 0 ? 'La date est passée : vérifiez-la.' : 'Audience dans ' + jours() + ' jour(s) : elle sera marquée urgente au rôle.' }}</p>
            }
            <p style="margin-top:14px">
              <button class="btn ghost" (click)="etape.set(1)">Retour</button>
              <button class="btn" style="margin-left:8px" (click)="etape.set(3)" [disabled]="!f.date_prevue">Suivant : vérifier</button>
            </p>
          </section>
        }

        @if (etape() === 3) {
          <section class="panel">
            <h3>Vérifier avant de créer</h3>
            <ul class="recap">
              <li>L'acte <b>{{ c.reference }}</b> est rattaché au dossier <b>{{ nomDossier() }}</b> et sa pièce est rangée dans le dossier.</li>
              <li>Audience le <b>{{ f.date_prevue | date:'dd/MM/yyyy' }}</b>{{ f.heure ? ' à ' + f.heure : '' }}{{ f.juridiction ? ' · ' + f.juridiction : '' }}, inscrite au rôle de la semaine{{ urgente() ? ' (urgente)' : '' }}.</li>
              <li>Une tâche de préparation est confiée à l'avocat{{ nomAvocat() ? ' ' + nomAvocat() : ' désigné' }}.</li>
            </ul>
            <p>
              <button class="btn ghost" (click)="etape.set(2)">Retour</button>
              <button class="btn" style="margin-left:8px" (click)="creer()" [disabled]="enCours()">{{ enCours() ? 'Création…' : "Programmer l'audience" }}</button>
            </p>
          </section>
        }
      }
    }
  `,
  styles: [`
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md)}
    textarea.in{resize:vertical;font-family:inherit}
    label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:900px}
    .col2{grid-column:1 / -1}
    .btn{display:inline-block;background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer;text-decoration:none}
    .btn.ghost{background:transparent;border:1px solid var(--line);color:inherit}
    .btn:disabled{opacity:.6;cursor:not-allowed}
    .ok-msg{color:var(--green);font-size:var(--fs-base)}
    .muted-sm{font-size:var(--fs-xs);color:var(--grey)}
    .req{color:#c0392b}
    .alerte{background:#fdecea;border:1px solid #c0392b;color:#8a1f15;border-radius:8px;padding:9px 12px;font-size:var(--fs-sm);max-width:900px}
    .etapes{display:flex;gap:8px;margin:12px 0}
    .etapes span{padding:6px 12px;border:1px solid var(--line);border-radius:8px;font-size:var(--fs-sm);color:var(--grey)}
    .etapes span.on{background:var(--gold);color:#1b2436;border-color:var(--gold);font-weight:600}
    .carte{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:6px 0;cursor:pointer;font-weight:400;color:inherit}
    .carte.on{border-color:var(--gold);box-shadow:inset 0 0 0 1px var(--gold)}
    .recap li{margin:6px 0}
  `],
})
export class ActeAudienceSuiteComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private static readonly ROLES_AVOCAT = ['associe', 'associe_fondateur', 'of_counsel', 'avocat_stagiaire', 'collaborateur'];

  readonly courrier = signal<any | null>(null);
  readonly suggestions = signal<any[]>([]);
  readonly membres = signal<any[]>([]);
  readonly etape = signal(1);
  readonly enCours = signal(false);
  readonly fini = signal(false);
  readonly erreur = signal('');
  readonly avocats = computed(() => this.membres().filter((m) => ActeAudienceSuiteComponent.ROLES_AVOCAT.includes(m.role)));
  dossierId: string | null = null;
  autreDossier: string | null = null;
  f: any = { date_prevue: '', heure: '', juridiction: '', type: 'mise_en_etat', avocat_id: '', instructions: '' };

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.api.utilisateurs().subscribe({ next: (u) => this.membres.set(u), error: () => {} });
    this.api.courrier(id).subscribe({
      next: (c) => {
        this.f.date_prevue = c.audience_indiquee ? String(c.audience_indiquee).slice(0, 10) : '';
        this.f.juridiction = c.audience_juridiction ?? '';
        this.f.avocat_id = c.destinataire_id ?? '';
        if (c.dossier_id) { this.dossierId = c.dossier_id; }
        this.courrier.set(c);   // en dernier : le signal déclenche l'affichage, les champs sont déjà remplis (pas de zone.js)
      },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Acte introuvable.'),
    });
    this.api.dossiersSugeresActe(id).subscribe({ next: (l) => this.suggestions.set(l), error: () => {} });
  }

  choisir(id: string): void { this.dossierId = id; }
  choisirAutre(id: string | null): void { this.autreDossier = id; if (id) this.choisir(id); }

  nomDossier(): string {
    const d = this.suggestions().find((x) => x.id === this.dossierId);
    return d ? d.numero + ' · ' + d.intitule : (this.courrier()?.dossier_id ? 'déjà rattaché' : 'choisi');
  }
  nomAvocat(): string {
    const m = this.membres().find((x) => x.id === this.f.avocat_id);
    return m ? m.prenom + ' ' + m.nom : '';
  }
  urgente(): boolean {
    const j = this.jours();
    return j !== null && j <= 7;
  }
  jours(): number | null {
    if (!this.f.date_prevue) return null;
    return Math.round((new Date(this.f.date_prevue + 'T00:00:00').getTime() - new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00').getTime()) / 86400000);
  }

  ouvrirNouveau(): void {
    const c = this.courrier();
    if (!c) return;
    this.router.navigate(['/ouverture'], { queryParams: { courrier: c.id, courrierRef: c.reference, retour: 'acte-audience' } });
  }

  creer(): void {
    const c = this.courrier();
    if (!c || this.enCours()) return;
    this.erreur.set('');
    this.enCours.set(true);
    const corps: any = { ...this.f, urgente: this.urgente() };
    if (!c.dossier_id) corps.dossier_id = this.dossierId;
    Object.keys(corps).forEach((k) => { if (corps[k] === '' || corps[k] === null) delete corps[k]; });
    this.api.programmerAudienceActe(c.id, corps).subscribe({
      next: (r) => { this.enCours.set(false); this.dossierId = r.dossier_id; this.fini.set(true); },
      error: (e) => { this.enCours.set(false); this.erreur.set(e?.error?.error ?? 'Programmation impossible.'); },
    });
  }
}
