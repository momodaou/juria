import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CATEGORIES_CABINET, CATEGORIES_DEBOURS, CategorieDepense } from './categories-depense';

// Sélection des natures de dépenses acceptées sur une caisse (Accès & permissions → Seuils, 11/11/2026) : pastilles à cliquer,
// deux groupes (charges du cabinet / débours et frais de procédure), compteur et raccourcis. Le parent garde la liste (@Input
// `selection`) et la reçoit mise à jour par `selectionChange` : aucun état interne.
interface Groupe { cle: string; titre: string; items: CategorieDepense[]; }

@Component({
  selector: 'app-natures-depense-picker',
  standalone: true,
  template: `
    <div class="cp">
      <div class="cp-tete">
        <span class="cp-compteur"><b>{{ selection.length }}</b> nature{{ selection.length > 1 ? 's' : '' }} retenue{{ selection.length > 1 ? 's' : '' }} sur {{ total() }}</span>
        @if (defaut.length) { <button type="button" class="cp-lien" (click)="selectionChange.emit([...defaut])">Valeurs par défaut</button> }
      </div>
      @for (g of groupes(); track g.cle) {
        <div class="cp-groupe">
          <div class="cp-gtete">
            <span class="cp-titre">{{ g.titre }}</span>
            <span class="cp-n">{{ nbChoisies(g) }}/{{ g.items.length }}</span>
            <span class="cp-actions">
              <button type="button" class="cp-lien" (click)="tout(g, true)">Tout cocher</button>
              <button type="button" class="cp-lien" (click)="tout(g, false)">Tout décocher</button>
            </span>
          </div>
          <div class="cp-pastilles">
            @for (c of g.items; track c.code) {
              <button type="button" class="cp-pastille" [class.on]="coche(c.code)" [attr.aria-pressed]="coche(c.code)" (click)="basculer(c.code)">
                <span class="cp-coche">{{ coche(c.code) ? '✓' : '' }}</span>{{ c.libelle }}
              </button>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .cp{display:flex;flex-direction:column;gap:14px}
    .cp-tete{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
    .cp-compteur{font-size:var(--fs-base);color:var(--slate)}
    .cp-gtete{display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap}
    .cp-titre{font-size:var(--fs-xs);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--grey)}
    .cp-n{font-size:var(--fs-xs);color:var(--grey);background:#eceff3;border-radius:10px;padding:1px 8px}
    .cp-actions{margin-left:auto;display:inline-flex;gap:14px}
    .cp-lien{background:none;border:none;padding:0;font-size:var(--fs-sm);font-weight:600;color:var(--gold);cursor:pointer}
    .cp-lien:hover{text-decoration:underline}
    .cp-pastilles{display:flex;flex-wrap:wrap;gap:8px}
    .cp-pastille{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:#fff;color:var(--slate);border-radius:999px;
      padding:6px 13px 6px 8px;font-size:var(--fs-base);cursor:pointer;transition:background .12s,border-color .12s,color .12s}
    .cp-pastille:hover{border-color:var(--gold)}
    .cp-pastille.on{background:#f6efe2;border-color:var(--gold);color:var(--navy);font-weight:600}
    .cp-coche{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;border:1.5px solid #c9d1db;font-size:11px;line-height:1;color:#fff;background:#fff}
    .cp-pastille.on .cp-coche{background:var(--gold);border-color:var(--gold)}
    .cp-pastille:focus-visible,.cp-lien:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
  `],
})
export class NaturesDepensePickerComponent {
  /** Codes de catégories actuellement retenus. */
  @Input() selection: string[] = [];
  /** Liste « valeurs par défaut » proposée par le raccourci (vide : raccourci masqué). */
  @Input() defaut: string[] = [];
  /** Groupe affiché en premier. */
  @Input() premier: 'cabinet' | 'debours' = 'cabinet';
  @Output() selectionChange = new EventEmitter<string[]>();

  private readonly cabinet: Groupe = { cle: 'cabinet', titre: 'Charges du cabinet', items: CATEGORIES_CABINET };
  private readonly debours: Groupe = { cle: 'debours', titre: 'Débours et frais de procédure', items: CATEGORIES_DEBOURS };

  groupes(): Groupe[] { return this.premier === 'debours' ? [this.debours, this.cabinet] : [this.cabinet, this.debours]; }
  total(): number { return CATEGORIES_CABINET.length + CATEGORIES_DEBOURS.length; }
  coche(code: string): boolean { return this.selection.includes(code); }
  nbChoisies(g: Groupe): number { return g.items.filter((c) => this.coche(c.code)).length; }
  basculer(code: string): void {
    this.selectionChange.emit(this.coche(code) ? this.selection.filter((c) => c !== code) : [...this.selection, code]);
  }
  tout(g: Groupe, cocher: boolean): void {
    const codes = g.items.map((c) => c.code);
    const reste = this.selection.filter((c) => !codes.includes(c));
    this.selectionChange.emit(cocher ? [...reste, ...codes] : reste);
  }
}
