import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CategorieDepense } from './categories-depense';

// Sélection des natures de dépenses acceptées sur une caisse (Accès & permissions → Seuils). Version compacte (11/11/2026) :
// le catalogue propre à la caisse (@Input `items`) s'affiche en colonnes, texte normal et petit, case à cocher simple.
// Le parent garde la liste (@Input `selection`) et la reçoit mise à jour par `selectionChange` : aucun état interne.
@Component({
  selector: 'app-natures-depense-picker',
  standalone: true,
  template: `
    <div class="cp">
      <div class="cp-tete">
        <span class="cp-compteur"><b>{{ nbRetenues() }}</b> sur {{ items.length }} retenue{{ nbRetenues() > 1 ? 's' : '' }}</span>
        <span class="cp-actions">
          <button type="button" class="cp-lien" (click)="tout(true)">Tout cocher</button>
          <button type="button" class="cp-lien" (click)="tout(false)">Tout décocher</button>
          @if (defaut.length) { <button type="button" class="cp-lien" (click)="selectionChange.emit([...defaut])">Valeurs par défaut</button> }
        </span>
      </div>
      <div class="cp-grille">
        @for (c of items; track c.code) {
          <label class="cp-case" [class.on]="coche(c.code)">
            <input type="checkbox" [checked]="coche(c.code)" (change)="basculer(c.code)" />
            <span>{{ c.libelle }}</span>
          </label>
        }
      </div>
    </div>
  `,
  styles: [`
    .cp{display:flex;flex-direction:column;gap:8px}
    .cp-tete{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
    .cp-compteur{font-size:var(--fs-sm);color:var(--grey)}
    .cp-compteur b{font-weight:600;color:var(--slate)}
    .cp-actions{display:inline-flex;gap:14px}
    .cp-lien{background:none;border:none;padding:0;font-size:var(--fs-sm);font-weight:500;color:var(--gold);cursor:pointer}
    .cp-lien:hover{text-decoration:underline}
    .cp-grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:2px 16px}
    .cp-case{display:flex;align-items:center;gap:8px;padding:3px 6px;border-radius:5px;font-size:var(--fs-sm);font-weight:400;color:var(--slate);cursor:pointer;line-height:1.3}
    .cp-case:hover{background:#f4f6f9}
    .cp-case.on{background:#faf5ea;color:var(--navy)}
    .cp-case input{margin:0;width:14px;height:14px;flex:none;accent-color:var(--gold);cursor:pointer}
    .cp-lien:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
  `],
})
export class NaturesDepensePickerComponent {
  /** Catalogue de la caisse : les seules natures proposées. */
  @Input() items: CategorieDepense[] = [];
  /** Codes de catégories actuellement retenus. */
  @Input() selection: string[] = [];
  /** Liste « valeurs par défaut » proposée par le raccourci (vide : raccourci masqué). */
  @Input() defaut: string[] = [];
  @Output() selectionChange = new EventEmitter<string[]>();

  nbRetenues(): number { return this.items.filter((c) => this.coche(c.code)).length; }
  coche(code: string): boolean { return this.selection.includes(code); }
  basculer(code: string): void {
    this.selectionChange.emit(this.coche(code) ? this.selection.filter((c) => c !== code) : [...this.selection, code]);
  }
  tout(cocher: boolean): void {
    const codes = this.items.map((c) => c.code);
    const reste = this.selection.filter((c) => !codes.includes(c));
    this.selectionChange.emit(cocher ? [...reste, ...codes] : reste);
  }
}
