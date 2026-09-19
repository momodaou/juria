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
    /* 19/09/2026 (2e passe) : le patron initial (icône ⋮ à opacity:.35,
       plein contraste seulement au survol de la ligne, repris de la
       Messagerie) s'est révélé trop discret une fois généralisé à toute
       l'appli — remonté par l'utilisateur (« assez fondu, difficile à
       appréhender »). Autre défaut trouvé au passage : en dehors d'un
       <tr> (ex. Plan d'action, carte kanban), le sélecteur "tr:hover"
       ne s'appliquait jamais — le bouton restait invisible en
       permanence, atteignable seulement au clavier (:focus-visible).
       Remplacé par une pastille toujours pleinement visible (fond +
       bordure, même langage que .btn), sans dépendre du survol d'un
       ancêtre précis — visible sur mobile/tactile aussi. */
    .menu-btn{
      background:var(--light);border:1px solid var(--line);color:var(--slate);
      font-size:var(--fs-lg);font-weight:700;line-height:1;
      cursor:pointer;width:28px;height:26px;border-radius:7px;
      display:inline-flex;align-items:center;justify-content:center;
    }
    .menu-btn:hover, .menu-btn:focus-visible{background:var(--navy);border-color:var(--navy);color:#fff}
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
