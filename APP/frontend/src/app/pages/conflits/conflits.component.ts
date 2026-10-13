import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

// Registre « Conflits en attente de décision » (13/10/2026) — comble le
// vrai bug trouvé en réfléchissant à la validation des nouveaux dossiers :
// la décision (accepte/refuse/oriente) n'était reachable QUE depuis
// l'écran où le collaborateur bloqué a lui-même lancé le contrôle (voir
// ouverture.component.ts) — aucun registre, aucun chemin à distance. Cet
// écran permet à un titulaire de conflits.decision de décider depuis SON
// propre compte, où qu'il soit — la route de décision elle-même
// (POST /:id/decision) était déjà reachable à distance, seule l'absence
// d'écran bloquait. Réutilise mot pour mot le style/la logique de décision
// déjà construits dans ouverture.component.ts (même garde `restant()`
// plutôt que `splice` : pas de zone.js, toute mise à jour d'écran après un
// callback HTTP doit réécrire le signal via `.update()`, jamais muter en
// place).
@Component({
  selector: 'app-conflits',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe],
  template: `
    <header class="page-head">
      <h1>Conflits en attente de décision</h1>
      <p>Contrôles de conflit d'intérêts signalant un rapprochement potentiel, en attente d'une décision — décidez ici depuis votre propre compte, sans avoir à être sur l'écran du collaborateur bloqué.</p>
    </header>

    @if (chargement()) {
      <p class="muted">Chargement…</p>
    } @else if (!liste().length) {
      <p class="muted">Aucun conflit en attente de décision.</p>
    } @else {
      @for (c of liste(); track c.id) {
        <section class="panel result warn">
          <h3>{{ c.intitule_projet || 'Projet non précisé' }}</h3>
          <p class="muted">Soumis par {{ c.cree_par_nom || '—' }} ({{ c.cree_par_code }}) le {{ c.cree_le | date: 'dd/MM/yyyy à HH:mm' }}</p>
          <p><span class="terme">Noms recherchés :</span> {{ c.noms_recherches }}</p>

          @for (d of c.details; track d.terme) {
            <div class="match">
              <span class="terme">{{ d.terme }}</span> :
              @for (m of d.correspondances; track m.id) {
                <span class="chip">{{ m.nom }} ({{ m.source }}{{ m.dossier ? ' · ' + m.dossier : '' }})</span>
              }
            </div>
          }

          <div class="decision">
            <label>Décision</label>
            <input class="in" [(ngModel)]="motifs[c.id]" [name]="'motif-' + c.id" placeholder="Motif (obligatoire)" />
            @if (erreurs[c.id]) { <p class="err">{{ erreurs[c.id] }}</p> }
            <div class="btns">
              <button class="btn ghost" (click)="decider(c, 'refuse')">Refuser</button>
              <button class="btn ghost" (click)="decider(c, 'oriente')">Orienter vers un confrère</button>
              <button class="btn" (click)="decider(c, 'accepte')">Accepter (motivé)</button>
            </div>
          </div>
        </section>
      }
    }

    <p><a class="lien" [routerLink]="['/ouverture']">← Retour à l'ouverture d'un dossier</a></p>
  `,
  styles: [`
    .in{display:block;width:100%;max-width:520px;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md)}
    label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn.ghost{background:#fff;border:1px solid var(--line);color:var(--slate)}
    .result.warn{background:#fffaf0;border:1px solid #f0dcae}
    .match{margin-top:8px;font-size:var(--fs-base)}
    .terme{font-weight:600}
    .chip{display:inline-block;background:#fff;border:1px solid var(--line);border-radius:12px;padding:2px 9px;margin:2px;font-size:var(--fs-sm)}
    .decision{margin-top:14px}
    .decision .btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
    .muted{color:var(--grey);font-size:var(--fs-sm)}
    .lien{background:none;border:none;color:var(--gold);cursor:pointer;font-size:inherit;padding:0;text-decoration:underline}
  `],
})
export class ConflitsComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);

  readonly chargement = signal(true);
  readonly liste = signal<any[]>([]);
  motifs: Record<string, string> = {};
  erreurs: Record<string, string> = {};

  ngOnInit(): void {
    this.charger();
  }

  private charger(): void {
    this.chargement.set(true);
    this.api.conflitsEnAttente().subscribe({
      next: (r) => { this.liste.set(r); this.chargement.set(false); },
      error: () => this.chargement.set(false),
    });
  }

  decider(c: any, decision: string): void {
    const motif = (this.motifs[c.id] || '').trim();
    if (!motif) { this.erreurs[c.id] = 'Le motif est obligatoire.'; return; }
    delete this.erreurs[c.id];
    this.api.decisionConflit(c.id, { decision, motif }).subscribe({
      next: () => this.liste.update((l) => l.filter((x) => x.id !== c.id)),
      error: (e) => { this.erreurs[c.id] = e?.error?.error ?? 'Décision impossible.'; },
    });
  }
}
