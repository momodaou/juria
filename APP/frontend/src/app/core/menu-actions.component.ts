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
    <button type="button" class="menu-btn" [class.menu-btn-ouvert]="ouvert()" title="Actions" (click)="basculer($event)">⋮</button>
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
       ancêtre précis — visible sur mobile/tactile aussi.
       20/09/2026 (3e passe, même taille — l'utilisateur ne voulait pas
       agrandir) : le fond var(--light) et la bordure var(--line)
       choisis la veille sont tous les deux très proches du blanc des
       tableaux, la pastille se distinguait donc à peine du fond de
       page malgré sa présence permanente — remonté par l'utilisateur
       (« ça reste dur à repérer »). Bordure et icône assombries
       (var(--grey)/var(--navy) au lieu de var(--line)/var(--slate)),
       dimensions inchangées.
       20/09/2026 (4e passe, même jour) : incohérence relevée par
       l'utilisateur — les liens à une seule action (.lien, ci-dessous)
       sont dorés (var(--gold)) partout dans l'appli. 1er essai : bordure
       + icône dorées au repos, fond doré seulement au survol — jugé
       encore incohérent par l'utilisateur, qui pensait plutôt au fond
       plein doré de .btn (le vrai bouton d'action, ex. « Ajouter une
       partie »/« Enregistrer », dupliqué dans chaque écran :
       background:var(--gold);color:#1b2436;border:none — jamais de
       :hover distinct nulle part dans l'appli). Aligné à l'identique :
       fond doré plein en permanence, pas seulement au survol.
       20/09/2026 (5e passe, même jour) : le doré plein jugé « trop
       fort » pour une action secondaire répétée sur chaque ligne
       (contrairement à .btn, unique par écran) — l'utilisateur demande
       un fond moins intense. Repris le patron déjà utilisé par les
       badges .tag/.tag.haute (fond teinté clair + texte dans la même
       famille de couleur, pas un aplat saturé) plutôt qu'inventer un
       traitement inédit : fond doré à 16 % d'opacité, icône dans le
       doré plein — fond doré plein réservé au survol/focus/menu ouvert
       (retour d'interaction, comme dans les 2 passes précédentes).
       20/09/2026 (6e passe, même jour) : « légèrement plus en relief
       encore, sans revenir au fond très doré » — la teinte à 16 %
       manquait de contour propre (aucune bordure, se fondait un peu
       dans les fonds blancs/gris clairs du reste du tableau). Opacité
       du fond remontée à 26 % (encore loin de l'aplat plein) et
       bordure fine ajoutée dans la même teinte (40 % d'opacité) pour
       donner un contour net — relief par la délimitation, pas par la
       saturation. */
    .menu-btn{
      background:rgba(176,141,87,.26);border:1px solid rgba(176,141,87,.45);color:var(--gold);
      font-size:var(--fs-lg);font-weight:700;line-height:1;
      cursor:pointer;width:28px;height:26px;border-radius:7px;
      display:inline-flex;align-items:center;justify-content:center;
    }
    .menu-btn:hover, .menu-btn:focus-visible, .menu-btn-ouvert{background:var(--gold);border-color:var(--gold);color:#1b2436}
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
