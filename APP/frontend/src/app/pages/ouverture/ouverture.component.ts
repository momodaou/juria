import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-ouverture',
  standalone: true,
  imports: [FormsModule],
  template: `
    <header class="page-head"><h1>Ouverture de dossier</h1></header>

    <section class="panel">
      <h3>Étape 1 — Contrôle des conflits d'intérêts (obligatoire)</h3>

      <label>Intitulé du projet de dossier</label>
      <input class="in" [(ngModel)]="intitule" name="intitule" placeholder="Ex. Bâtir-SA — recouvrement" />

      <label>Noms à vérifier (client, adverses, parties liées — séparés par des virgules)</label>
      <input class="in" [(ngModel)]="noms" name="noms" placeholder="Ex. Bâtir-SA, SODIMA Sarl" />

      <button class="btn" (click)="verifier()" [disabled]="chargement() || !noms">
        {{ chargement() ? 'Vérification…' : 'Lancer le contrôle' }}
      </button>

      @if (resultat(); as r) {
        <div class="result" [class.ok]="r.resultat === 'absence'" [class.warn]="r.resultat === 'potentiel'">
          <b>{{ r.resultat === 'absence' ? '✓ Absence de conflit' : '⚠ Conflit potentiel détecté' }}</b>
          <p>{{ r.message }}</p>
          @for (d of r.details; track d.terme) {
            <div class="match">
              <span class="terme">{{ d.terme }}</span> :
              @for (c of d.correspondances; track c.id) {
                <span class="chip">{{ c.nom }} ({{ c.source }}{{ c.dossier ? ' · ' + c.dossier : '' }})</span>
              }
            </div>
          }

          @if (r.resultat === 'potentiel' && !decisionPrise()) {
            <div class="decision">
              <label>Décision de l'associé</label>
              <input class="in" [(ngModel)]="motif" name="motif" placeholder="Motif (obligatoire)" />
              <div class="btns">
                <button class="btn ghost" (click)="decider(r.id, 'refuse')">Refuser</button>
                <button class="btn ghost" (click)="decider(r.id, 'oriente')">Orienter vers un confrère</button>
                <button class="btn" (click)="decider(r.id, 'accepte')">Accepter (motivé)</button>
              </div>
            </div>
          }

          @if (decisionPrise(); as dec) {
            <p class="decision-finale">Décision enregistrée : <b>{{ dec }}</b>.
              @if (dec === 'accepte' || r.resultat === 'absence') { L'ouverture peut se poursuivre. }
            </p>
          }
        </div>
      }

      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
    </section>
  `,
  styles: [`
    .in{display:block;width:100%;max-width:520px;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:14px}
    label{font-size:12px;color:var(--slate);font-weight:600}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn.ghost{background:#fff;border:1px solid var(--line);color:var(--slate)}
    .btn:disabled{opacity:.6}
    .result{margin-top:16px;border-radius:10px;padding:14px 16px}
    .result.ok{background:#e3f5ec;border:1px solid #9ed9bd}
    .result.warn{background:#fffaf0;border:1px solid #f0dcae}
    .match{margin-top:8px;font-size:13px}
    .terme{font-weight:600}
    .chip{display:inline-block;background:#fff;border:1px solid var(--line);border-radius:12px;padding:2px 9px;margin:2px;font-size:12px}
    .decision{margin-top:14px}
    .decision .btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
    .decision-finale{margin-top:12px;font-size:14px}
  `],
})
export class OuvertureComponent {
  private readonly api = inject(ApiService);

  intitule = '';
  noms = '';
  motif = '';
  readonly resultat = signal<any | null>(null);
  readonly decisionPrise = signal<string | null>(null);
  readonly chargement = signal(false);
  readonly erreur = signal('');

  verifier(): void {
    this.chargement.set(true);
    this.erreur.set('');
    this.resultat.set(null);
    this.decisionPrise.set(null);
    this.api.conflictCheck({ intitule_projet: this.intitule, noms: this.noms }).subscribe({
      next: (r) => { this.resultat.set(r); this.chargement.set(false); },
      error: (e) => { this.chargement.set(false); this.erreur.set(e?.error?.error ?? 'Erreur lors du contrôle'); },
    });
  }

  decider(id: string, decision: string): void {
    if (!this.motif) { this.erreur.set('Le motif est obligatoire.'); return; }
    this.erreur.set('');
    this.api.decisionConflit(id, { decision, motif: this.motif }).subscribe({
      next: (r) => this.decisionPrise.set(r.decision),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Décision impossible (rôle associé requis).'),
    });
  }
}
