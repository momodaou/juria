import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { NotificationsService } from './notifications.service';

// Cloche du centre de notifications (lot 1, 07/11/2026) : rangée en tête du menu latéral (visible aussi menu replié),
// panneau flottant à droite du menu, toasts discrets en haut à droite de l'écran. Les textes sont composés par le serveur
// (aucun montant, aucun nom de client).
@Component({
  selector: 'app-notifications-cloche',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <a routerLink="/notifications" routerLinkActive="nc-actif" class="nc-rangee" title="Notifications" aria-label="Notifications">
      <span class="nc-ico">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>
        </svg>
        @if (svc.nonLues() > 0) { <span class="nc-pastille nc-pastille-ico">{{ svc.nonLues() > 99 ? '99+' : svc.nonLues() }}</span> }
      </span>
      <span class="nc-lbl">Notifications</span>
      @if (svc.nonLues() > 0) { <span class="nc-pastille nc-pastille-lbl">{{ svc.nonLues() > 99 ? '99+' : svc.nonLues() }}</span> }
    </a>
  `,
  styles: [`
    :host { display: block; position: relative; margin: 14px 0 10px; }
    :host-context(.app.collapsed) { margin: 12px 0 8px; }
    .nc-rangee { display: flex; align-items: center; gap: 10px; width: 100%; background: transparent; border: none; color: #cfd6e3; text-decoration: none;
      padding: 10px 12px; border-radius: 8px; cursor: pointer; font: inherit; font-size: var(--fs-md); white-space: nowrap; text-align: left; }
    .nc-rangee:hover { background: rgba(255,255,255,.08); color: #fff; }
    .nc-rangee.nc-actif { background: var(--gold); color: #1b2436; font-weight: 600; }
    .nc-ico { position: relative; display: flex; flex: 0 0 auto; }
    .nc-lbl { flex: 1; overflow: hidden; text-overflow: ellipsis; }
    .nc-pastille { background: var(--red); color: #fff; font-size: var(--fs-xs); font-weight: 700; line-height: 1; padding: 3px 6px; border-radius: 999px; flex: 0 0 auto; }
    .nc-pastille-ico { display: none; position: absolute; top: -6px; right: -8px; font-size: var(--fs-2xs); padding: 2px 5px; }
    :host-context(.app.collapsed) .nc-rangee { justify-content: center; padding: 10px; }
    :host-context(.app.collapsed) .nc-lbl, :host-context(.app.collapsed) .nc-pastille-lbl { display: none; }
    :host-context(.app.collapsed) .nc-pastille-ico { display: block; }
  `],
})
export class NotificationsClocheComponent {
  readonly svc = inject(NotificationsService);
}

@Component({
  selector: 'app-notifications-toasts',
  standalone: true,
  template: `
    <div class="nt-pile" aria-live="polite">
      @for (t of svc.toasts(); track t.id) {
        <div class="nt-toast" [class.nt-critique]="t.niveau === 'critique'" [class.nt-action]="t.niveau === 'action'" role="status">
          <button type="button" class="nt-texte" (click)="svc.ouvrirToast(t)">{{ t.texte }}</button>
          <button type="button" class="nt-x" aria-label="Fermer" (click)="svc.fermerToast(t.id)">×</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .nt-pile { position: fixed; bottom: 84px; right: 16px; z-index: 1100; display: flex; flex-direction: column; gap: 8px; width: 340px; max-width: calc(100vw - 32px); pointer-events: none; }
    .nt-toast { pointer-events: auto; display: flex; align-items: flex-start; gap: 6px; background: var(--navy); color: #fff; border-left: 4px solid var(--info);
      border-radius: 8px; padding: 10px 8px 10px 12px; box-shadow: 0 8px 24px rgba(20,30,50,.3); }
    .nt-toast.nt-action { border-left-color: var(--amber); }
    .nt-toast.nt-critique { border-left-color: var(--red); }
    .nt-texte { flex: 1; text-align: left; background: none; border: none; color: inherit; font: inherit; font-size: var(--fs-base); line-height: 1.35; cursor: pointer; padding: 0; overflow-wrap: anywhere; }
    .nt-x { background: none; border: none; color: #cfd6e3; font-size: 18px; line-height: 1; cursor: pointer; padding: 0 4px; }
    .nt-x:hover { color: #fff; }
  `],
})
export class NotificationsToastsComponent {
  readonly svc = inject(NotificationsService);
}


// Bannière des urgences (07/11/2026) : bandeau rouge en haut de l'écran tant qu'une notification critique reste « à traiter »
// (délai de procédure à J-1 ou le jour même, conflit à décider, dépenses en attente depuis plus de 48 h…). Disparaît seule dès
// que l'action est faite.
@Component({
  selector: 'app-notifications-banniere',
  standalone: true,
  template: `
    @if (svc.urgences().length) {
      <div class="nb-banniere" role="alert">
        <span class="nb-texte">
          <strong>Urgent :</strong> {{ svc.urgences()[0].texte }}
          @if (svc.urgences().length > 1) { <span class="nb-plus">(+ {{ svc.urgences().length - 1 }} autre{{ svc.urgences().length > 2 ? 's' : '' }})</span> }
        </span>
        <button type="button" class="nb-bouton" (click)="svc.ouvrir(svc.urgences()[0])">Traiter</button>
        @if (svc.urgences().length > 1) { <button type="button" class="nb-bouton nb-sec" (click)="voirTout()">Voir tout</button> }
      </div>
    }
  `,
  styles: [`
    .nb-banniere { position: sticky; top: 0; z-index: 900; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      background: var(--red); color: #fff; padding: 9px 16px; font-size: var(--fs-base); box-shadow: 0 2px 8px rgba(20,30,50,.18); }
    .nb-texte { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .nb-plus { opacity: .85; margin-left: 4px; }
    .nb-bouton { background: #fff; color: var(--red); border: none; border-radius: 6px; padding: 5px 12px; font-weight: 600; cursor: pointer; font-size: var(--fs-sm); }
    .nb-bouton.nb-sec { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,.7); }
  `],
})
export class NotificationsBanniereComponent {
  readonly svc = inject(NotificationsService);
  private readonly router = inject(Router);
  voirTout(): void { this.router.navigate(['/notifications'], { queryParams: { filtre: 'a_traiter' } }); }
}
