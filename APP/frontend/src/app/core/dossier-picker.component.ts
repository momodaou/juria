import { Component, DestroyRef, ElementRef, HostListener, Input, Output, EventEmitter, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, switchMap, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService, Dossier } from './api.service';
import { LibellePipe } from './libelles';

// Sélecteur dossier avec recherche (16/10/2026, diagnostic utilisateur sur la
// présentation "bancale" de l'autocomplétion) — remplace le bloc dupliqué à
// l'identique (état dossierRecherche/dossierResultats/dossierLabel + chips
// non bornées) copié dans 10 endroits (8 écrans, dont 2 avec une 2e copie
// interne : courrier.component.ts et role-audience.component.ts). Même
// patron que client-picker.component.ts (21/08/2026), qui avait déjà résolu
// les mêmes défauts pour les clients : débounce 250ms + annulation de la
// requête précédente (switchMap, contre une requête par frappe sans
// annulation côté dossier — risque réel de résultat obsolète affiché après
// un résultat plus récent), liste bornée avec défilement interne (contre des
// chips qui s'étalaient sans limite, jusqu'à 200 résultats pour 2 lettres
// communes). Ajoute par rapport au client-picker : fermeture au clic
// extérieur, navigation clavier (flèches/Entrée/Échap) — deux manques déjà
// présents aussi côté client, mais pas corrigés ici au passage pour rester
// sur le périmètre demandé (recherche de dossier).
//
// Usage : [valeur]="form.dossier_id" [nomInitial]="dossierLabel"
// (valeurChange)="form.dossier_id = $event" (dossierChoisi)="..."
@Component({
  selector: 'app-dossier-picker',
  standalone: true,
  imports: [LibellePipe, FormsModule],
  template: `
    <div class="dp">
      @if (selection(); as s) {
        <div class="dp-selection">
          <span>{{ s.label }}</span>
          <button type="button" class="dp-x" (click)="effacer()">✕ changer</button>
        </div>
      } @else {
        <input class="dp-in" [(ngModel)]="terme" (ngModelChange)="onTermeChange($event)"
               (keydown)="onKeydown($event)" (focus)="onFocus()"
               [placeholder]="placeholder" autocomplete="off" />
        @if (resultats().length) {
          <ul class="dp-resultats">
            @for (d of resultats(); track d.id; let i = $index) {
              <li [class.active]="i === highlighted()" (mouseenter)="highlighted.set(i)" (click)="choisir(d)">
                <div class="dp-titre">{{ d.numero }} — {{ d.intitule }}</div>
                <div class="dp-detail">{{ d.client }} • {{ d.statut | libelle:'statutDossier' }}</div>
              </li>
            }
          </ul>
        } @else if (recherche() && terme.trim().length >= 2 && !enCours()) {
          <p class="dp-vide">Aucun dossier trouvé pour « {{ terme }} ».</p>
        }
      }
    </div>
  `,
  styles: [`
    .dp{position:relative}
    .dp-in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0;font-size:var(--fs-md)}
    .dp-selection{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0;font-size:var(--fs-md);background:var(--light)}
    .dp-x{background:none;border:none;color:var(--slate);cursor:pointer;font-size:var(--fs-sm);padding:0;white-space:nowrap}
    .dp-resultats{list-style:none;margin:2px 0 12px;padding:0;border:1px solid var(--line);border-radius:8px;max-height:260px;overflow-y:auto;background:#fff;position:relative;z-index:5}
    .dp-resultats li{padding:8px 12px;cursor:pointer}
    .dp-resultats li:hover,.dp-resultats li.active{background:var(--light)}
    .dp-titre{font-size:var(--fs-base);font-weight:600}
    .dp-detail{color:var(--grey);font-size:var(--fs-sm)}
    .dp-vide{color:var(--grey);font-size:var(--fs-sm);margin:2px 0 12px}
  `],
})
export class DossierPickerComponent implements OnChanges {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly elRef = inject(ElementRef);

  @Input() valeur: string | null = null;
  @Input() nomInitial: string | null = null;
  @Input() placeholder = 'Rechercher un dossier (référence ou intitulé)…';
  @Output() valeurChange = new EventEmitter<string | null>();
  @Output() dossierChoisi = new EventEmitter<Dossier | null>();

  readonly selection = signal<{ id: string; label: string } | null>(null);
  readonly resultats = signal<Dossier[]>([]);
  readonly recherche = signal(false);
  readonly enCours = signal(false);
  readonly highlighted = signal(-1);
  terme = '';

  private readonly terme$ = new Subject<string>();

  constructor() {
    // Pas de distinctUntilChanged() ici (contrairement à client-picker.component.ts) :
    // trouvé en testant — après choisir()/effacer(), retaper EXACTEMENT le même terme
    // ne relançait plus la recherche, distinctUntilChanged comparant au dernier terme
    // envoyé avant la sélection précédente, qui pouvait être identique.
    this.terme$
      .pipe(
        debounceTime(250),
        tap(() => this.enCours.set(true)),
        switchMap((t) => this.api.dossiers(t)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (liste) => {
          this.enCours.set(false);
          this.resultats.set(liste);
          this.highlighted.set(liste.length ? 0 : -1);
        },
        error: () => { this.enCours.set(false); this.resultats.set([]); this.highlighted.set(-1); },
      });
  }

  // Même garde que client-picker.component.ts (ngOnChanges) : ne re-dérive
  // la sélection affichée depuis [nomInitial] que si `valeur` diverge de la
  // sélection déjà connue en interne, sinon un choix fait DANS le composant
  // serait écrasé par le prochain ngOnChanges déclenché par le binding du
  // parent qui ne fait que refléter ce que le composant vient d'émettre.
  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['valeur'] && !changes['nomInitial']) return;
    if (!this.valeur) { this.selection.set(null); return; }
    if (this.valeur !== this.selection()?.id) {
      this.selection.set({ id: this.valeur, label: this.nomInitial || '(dossier sélectionné)' });
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent): void {
    if (this.resultats().length && !this.elRef.nativeElement.contains(e.target)) {
      this.resultats.set([]);
      this.highlighted.set(-1);
    }
  }

  onTermeChange(t: string): void {
    this.recherche.set(t.trim().length >= 2);
    if (t.trim().length >= 2) this.terme$.next(t.trim());
    else { this.resultats.set([]); this.highlighted.set(-1); }
  }

  onFocus(): void {
    if (this.terme.trim().length >= 2 && !this.resultats().length) this.terme$.next(this.terme.trim());
  }

  onKeydown(e: KeyboardEvent): void {
    const n = this.resultats().length;
    if (!n) {
      if (e.key === 'Escape') { this.terme = ''; this.recherche.set(false); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); this.highlighted.set(Math.min(this.highlighted() + 1, n - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.highlighted.set(Math.max(this.highlighted() - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const d = this.resultats()[this.highlighted()]; if (d) this.choisir(d); }
    else if (e.key === 'Escape') { this.resultats.set([]); this.highlighted.set(-1); }
  }

  choisir(d: Dossier): void {
    const label = `${d.numero} — ${d.intitule}`;
    this.dossierChoisi.emit(d);
    this.valeurChange.emit(d.id);
    this.selection.set({ id: d.id, label });
    this.terme = '';
    this.resultats.set([]);
    this.recherche.set(false);
    this.highlighted.set(-1);
  }

  effacer(): void {
    this.selection.set(null);
    this.terme = '';
    this.resultats.set([]);
    this.valeurChange.emit(null);
    this.dossierChoisi.emit(null);
  }
}
