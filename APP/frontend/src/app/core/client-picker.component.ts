import { Component, DestroyRef, Input, Output, EventEmitter, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from './api.service';

// Sélecteur client avec recherche (21/08/2026, diagnostic utilisateur) —
// remplace le <select> listant TOUS les clients (jusqu'à 200, plafond de
// l'API non signalé, sans aucun moyen de filtrer) utilisé à 4 endroits
// (ouverture.component.ts × 2, dossier-detail.component.ts × 2). Recherche
// débouncée (250ms) via GET /api/clients?q=, qui couvre déjà dénomination/
// nom/prénom/RCCM/NIF/email/téléphone (élargi le 20/08/2026) — ce composant
// réutilise cette route telle quelle, n'ajoute aucune logique de recherche
// nouvelle côté serveur.
//
// Usage : [valeur]="edit.client_id" [nomInitial]="d.client_nom"
// (valeurChange)="edit.client_id = $event" (clientChoisi)="..." — ou, pour
// un usage "ajouter à une liste puis revenir à une recherche vide" (clients
// additionnels), [reinitialiserApresChoix]="true" sans lier [valeur].
@Component({
  selector: 'app-client-picker',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="cp">
      @if (selection(); as s) {
        <div class="cp-selection">
          <span>{{ s.nom }}</span>
          <button type="button" class="cp-x" (click)="effacer()">✕ changer</button>
        </div>
      } @else {
        <input class="cp-in" [(ngModel)]="terme" (ngModelChange)="onTermeChange($event)"
               [placeholder]="placeholder" autocomplete="off" />
        @if (resultats().length) {
          <ul class="cp-resultats">
            @for (c of resultats(); track c.id) {
              <li (click)="choisir(c)">
                {{ nomAffiche(c) }}
                <span class="cp-detail">{{ c.rccm || c.nif || c.email || '' }}</span>
              </li>
            }
          </ul>
        } @else if (recherche() && terme.trim().length >= 2 && !enCours()) {
          <p class="cp-vide">Aucun client trouvé pour « {{ terme }} ».</p>
        }
      }
    </div>
  `,
  styles: [`
    .cp{position:relative}
    .cp-in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0;font-size:14px}
    .cp-selection{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0;font-size:14px;background:var(--light)}
    .cp-x{background:none;border:none;color:var(--slate);cursor:pointer;font-size:12px;padding:0;white-space:nowrap}
    .cp-resultats{list-style:none;margin:2px 0 12px;padding:0;border:1px solid var(--line);border-radius:8px;max-height:220px;overflow-y:auto;background:#fff;position:relative;z-index:5}
    .cp-resultats li{padding:8px 12px;cursor:pointer;font-size:13px;display:flex;justify-content:space-between;gap:10px}
    .cp-resultats li:hover{background:var(--light)}
    .cp-detail{color:var(--grey);font-size:12px}
    .cp-vide{color:var(--grey);font-size:12px;margin:2px 0 12px}
  `],
})
export class ClientPickerComponent implements OnChanges {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  @Input() valeur: string | null = null;
  @Input() nomInitial: string | null = null;
  @Input() exclureIds: string[] = [];
  @Input() placeholder = 'Rechercher un client (nom, RCCM, NIF, email…)';
  @Input() reinitialiserApresChoix = false;
  @Output() valeurChange = new EventEmitter<string | null>();
  @Output() clientChoisi = new EventEmitter<any | null>();

  readonly selection = signal<{ id: string; nom: string } | null>(null);
  readonly resultats = signal<any[]>([]);
  readonly recherche = signal(false);
  readonly enCours = signal(false);
  terme = '';

  private readonly terme$ = new Subject<string>();

  constructor() {
    this.terme$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        tap(() => this.enCours.set(true)),
        switchMap((t) => this.api.clients(t)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (liste) => {
          this.enCours.set(false);
          const exclus = new Set(this.exclureIds);
          this.resultats.set(liste.filter((c: any) => !exclus.has(c.id)));
        },
        error: () => { this.enCours.set(false); this.resultats.set([]); },
      });
  }

  // Ne re-dérive la sélection affichée depuis [nomInitial] que si `valeur`
  // diverge de la sélection déjà connue en interne — sans cette garde, un
  // choix fait DANS le composant (choisir()/effacer(), qui met déjà à jour
  // `selection` avec le vrai nom du résultat cliqué) serait immédiatement
  // écrasé par le prochain ngOnChanges (déclenché par le [valeur]="..." du
  // parent qui se contente de refléter ce que le composant vient d'émettre)
  // avec un [nomInitial] potentiellement périmé (ex. l'ancien client d'un
  // dossier, non mis à jour tant que la fiche n'est pas rechargée).
  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['valeur'] && !changes['nomInitial']) return;
    if (!this.valeur) { this.selection.set(null); return; }
    if (this.valeur !== this.selection()?.id) {
      this.selection.set({ id: this.valeur, nom: this.nomInitial || '(client sélectionné)' });
    }
  }

  nomAffiche(c: any): string {
    return c.denomination || `${c.prenom ?? ''} ${c.nom ?? ''}`.trim();
  }

  onTermeChange(t: string): void {
    this.recherche.set(t.trim().length >= 2);
    if (t.trim().length >= 2) this.terme$.next(t.trim());
    else this.resultats.set([]);
  }

  choisir(c: any): void {
    const nom = this.nomAffiche(c);
    this.clientChoisi.emit(c);
    this.valeurChange.emit(c.id);
    if (this.reinitialiserApresChoix) {
      this.terme = '';
      this.resultats.set([]);
      this.recherche.set(false);
      this.selection.set(null);
    } else {
      this.selection.set({ id: c.id, nom });
    }
  }

  effacer(): void {
    this.selection.set(null);
    this.terme = '';
    this.resultats.set([]);
    this.valeurChange.emit(null);
    this.clientChoisi.emit(null);
  }
}
