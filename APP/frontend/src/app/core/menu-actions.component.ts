import { Component, HostListener, Input, signal } from '@angular/core';

// JURIA — menu d'actions "⋮" réutilisable (19/09/2026).
// Généralise le menu construit pour la Messagerie le 13/09/2026 à toute
// ligne de l'application ayant 2 actions ou plus (décision actée avec
// l'utilisateur : uniformité plutôt que liens texte à 2 actions / menu à
// 3+ — un seul geste appris, une largeur de colonne constante quel que
// soit le nombre d'actions). Les lignes à une seule action gardent un
// simple <button class="lien">, pas besoin de le cacher.
export interface ActionMenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
  title?: string;
}

@Component({
  selector: 'app-menu-actions',
  standalone: true,
  template: `
    @if (actions.length) {
    <button type="button" class="menu-btn" title="Actions" (click)="basculer($event)">⋮</button>
    }
    @if (ouvert()) {
      <div class="menu-actions" [style.top.px]="pos()?.top" [style.left.px]="pos()?.left">
        @for (a of actions; track a.label) {
          <button type="button" class="menu-item" [class.menu-item-danger]="a.danger" [title]="a.title || ''" (click)="choisir(a, $event)">{{ a.label }}</button>
        }
      </div>
    }
  `,
  styles: [`
    :host{position:relative;display:inline-block}
    /* Visible en permanence mais très atténué, plein contraste seulement
       au survol de la ligne ou quand le menu est ouvert — invisible sinon
       sur mobile/tactile, qui n'a pas de :hover (même patron que la
       Messagerie, 13/09/2026). */
    .menu-btn{
      background:none;border:none;color:var(--grey);font-size:var(--fs-lg);line-height:1;
      cursor:pointer;padding:4px 8px;border-radius:6px;opacity:.35;
    }
    tr:hover .menu-btn, .menu-btn:focus-visible{opacity:1}
    .menu-btn:hover{background:rgba(0,0,0,.08)}
    /* position:fixed (pas absolute) : échappe à l'overflow:auto/hidden de
       tout ancêtre (ex. .table-scroll) — un menu en position:absolute
       imbriqué dans un conteneur à défilement se fait couper net dès
       qu'il dépasse la hauteur visible, bug déjà rencontré et corrigé une
       fois pour la Messagerie, évité ici dès le départ. */
    .menu-actions{
      position:fixed;z-index:1000;min-width:150px;
      background:#fff;border:1px solid var(--line);border-radius:10px;
      box-shadow:0 6px 18px rgba(0,0,0,.16);padding:4px;display:flex;flex-direction:column;
    }
    .menu-item{
      background:none;border:none;text-align:left;padding:8px 10px;border-radius:6px;
      font-size:var(--fs-sm);color:#1b2436;cursor:pointer;white-space:nowrap;font-family:inherit;
    }
    .menu-item:hover{background:var(--light)}
    .menu-item-danger{color:#b23b3b}
  `],
})
export class MenuActionsComponent {
  @Input() actions: ActionMenuItem[] = [];
  readonly ouvert = signal(false);
  readonly pos = signal<{ top: number; left: number } | null>(null);

  basculer(ev: Event): void {
    ev.stopPropagation();
    if (this.ouvert()) { this.ouvert.set(false); return; }
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    this.pos.set({ top: rect.bottom + 4, left: Math.max(8, rect.right - 156) });
    this.ouvert.set(true);
  }

  choisir(a: ActionMenuItem, ev: Event): void {
    ev.stopPropagation();
    this.ouvert.set(false);
    a.action();
  }

  @HostListener('document:click')
  fermer(): void {
    this.ouvert.set(false);
  }
}
