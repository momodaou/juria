import { Component, inject, signal, HostListener } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { NotificationsService, FiltreNotifications, Notification } from './notifications.service';

// Cloche du centre de notifications (lot 1, 07/11/2026) : rangée en tête du menu latéral (visible aussi menu replié),
// panneau flottant à droite du menu, toasts discrets en haut à droite de l'écran. Les textes sont composés par le serveur
// (aucun montant, aucun nom de client).
@Component({
  selector: 'app-notifications-cloche',
  standalone: true,
  imports: [DatePipe],
  template: `
    <button type="button" class="nc-rangee" [class.nc-actif]="svc.ouvert()" [class.nc-page]="surPage()" (click)="svc.basculer(); $event.stopPropagation()"
            title="Notifications" aria-label="Notifications" [attr.aria-expanded]="svc.ouvert()">
      <span class="nc-ico">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>
        </svg>
        @if (svc.nonLues() > 0) { <span class="nc-pastille nc-pastille-ico">{{ svc.nonLues() > 99 ? '99+' : svc.nonLues() }}</span> }
      </span>
      <span class="nc-lbl">Notifications</span>
      @if (svc.nonLues() > 0) { <span class="nc-pastille nc-pastille-lbl">{{ svc.nonLues() > 99 ? '99+' : svc.nonLues() }}</span> }
    </button>

    @if (svc.ouvert()) {
      <div class="nc-panneau" (click)="$event.stopPropagation()" role="dialog" aria-label="Notifications">
        <div class="nc-entete">
          <strong>Notifications</strong>
          <button type="button" class="nc-lien" [disabled]="svc.nonLues() === 0" (click)="svc.toutLire()">Tout marquer comme lu</button>
        </div>
        <div class="nc-filtres">
          @for (f of filtres; track f.code) {
            <button type="button" [class.nc-on]="svc.filtre() === f.code" (click)="svc.charger(f.code)">
              {{ f.label }}@if (f.code === 'non_lues' && svc.nonLues() > 0) { ({{ svc.nonLues() }}) }@if (f.code === 'a_traiter' && svc.aTraiter() > 0) { ({{ svc.aTraiter() }}) }
            </button>
          }
        </div>
        @if (svc.permissionAlertes() === 'default') {
          <button type="button" class="nc-alertes" (click)="svc.activerAlertes()">🔔 Activer les alertes du navigateur (urgences quand JURIA est en arrière-plan)</button>
        } @else if (svc.permissionAlertes() === 'denied') {
          <p class="nc-alertes-info">Les alertes du navigateur sont bloquées : autorisez-les dans les réglages du site pour les recevoir.</p>
        }
        <div class="nc-liste">
          @for (n of svc.liste(); track n.id) {
            <button type="button" class="nc-item" [class.nc-nonlue]="!n.lue_le" (click)="svc.ouvrir(n)">
              <span class="nc-pt" [class.nc-critique]="n.niveau === 'critique'" [class.nc-action]="n.niveau === 'action'" [class.nc-info]="n.niveau === 'information'" aria-hidden="true"></span>
              <span class="nc-corps">
                <span class="nc-texte">{{ n.texte }}</span>
                <span class="nc-meta">
                  {{ n.cree_le | date: 'dd/MM/yyyy HH:mm' }}
                  @if (n.a_traiter) { <span class="nc-trait">À traiter</span> }
                </span>
              </span>
            </button>
          } @empty {
            <p class="nc-vide">@if (svc.chargement()) { Chargement… } @else { Rien à signaler. }</p>
          }
        </div>
        <div class="nc-pied">
          <button type="button" class="nc-voir-tout" (click)="voirTout()">Voir tout</button>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; position: relative; margin: 14px 0 10px; }
    :host-context(.app.collapsed) { margin: 12px 0 8px; }
    .nc-rangee { display: flex; align-items: center; gap: 10px; width: 100%; background: transparent; border: none; color: #cfd6e3;
      padding: 10px 12px; border-radius: 8px; cursor: pointer; font: inherit; font-size: var(--fs-md); white-space: nowrap; text-align: left; }
    .nc-rangee:hover { background: rgba(255,255,255,.08); color: #fff; }
    .nc-rangee.nc-actif { background: rgba(255,255,255,.12); color: #fff; }
    .nc-rangee.nc-page { background: var(--gold); color: #1b2436; font-weight: 600; }
    .nc-ico { position: relative; display: flex; flex: 0 0 auto; }
    .nc-lbl { flex: 1; overflow: hidden; text-overflow: ellipsis; }
    .nc-pastille { background: var(--red); color: #fff; font-size: var(--fs-xs); font-weight: 700; line-height: 1; padding: 3px 6px; border-radius: 999px; flex: 0 0 auto; }
    .nc-pastille-ico { display: none; position: absolute; top: -6px; right: -8px; font-size: var(--fs-2xs); padding: 2px 5px; }
    :host-context(.app.collapsed) .nc-rangee { justify-content: center; padding: 10px; }
    :host-context(.app.collapsed) .nc-lbl, :host-context(.app.collapsed) .nc-pastille-lbl { display: none; }
    :host-context(.app.collapsed) .nc-pastille-ico { display: block; }
    .nc-panneau { position: fixed; left: 232px; top: 12px; width: 380px; max-width: calc(100vw - 250px); max-height: calc(100vh - 24px);
      background: #fff; color: #22303f; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 36px rgba(20,30,50,.22);
      display: flex; flex-direction: column; z-index: 1000; }
    :host-context(.app.collapsed) .nc-panneau { left: 80px; max-width: calc(100vw - 100px); }
    .nc-entete { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px 8px; }
    .nc-lien { background: none; border: none; color: var(--info); cursor: pointer; font-size: var(--fs-sm); padding: 0; }
    .nc-lien:disabled { color: var(--grey); cursor: default; }
    .nc-filtres { display: flex; gap: 6px; padding: 0 14px 8px; border-bottom: 1px solid var(--line); }
    .nc-filtres button { background: var(--light); border: none; border-radius: 999px; padding: 4px 10px; font-size: var(--fs-sm); color: var(--slate); cursor: pointer; }
    .nc-filtres button.nc-on { background: var(--navy); color: #fff; }
    .nc-alertes { display: block; width: calc(100% - 28px); margin: 8px 14px 0; text-align: left; background: var(--info-bg); color: var(--info); border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; font-size: var(--fs-sm); cursor: pointer; }
    .nc-alertes-info { margin: 8px 14px 0; font-size: var(--fs-xs); color: var(--grey); }
    .nc-liste { overflow-y: auto; min-height: 0; flex: 1; }
    .nc-item { display: flex; gap: 10px; width: 100%; text-align: left; background: #fff; color: #22303f; border: none; border-bottom: 1px solid var(--line);
      padding: 10px 14px; cursor: pointer; font: inherit; }
    .nc-item:hover { background: var(--light); }
    .nc-item.nc-nonlue { background: #f6f9fd; }
    .nc-item.nc-nonlue .nc-texte { font-weight: 600; }
    .nc-pt { flex: 0 0 auto; width: 9px; height: 9px; border-radius: 50%; margin-top: 5px; background: var(--line); }
    .nc-pt.nc-critique { background: var(--red); } .nc-pt.nc-action { background: var(--amber); } .nc-pt.nc-info { background: var(--info); }
    .nc-corps { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .nc-texte { font-size: var(--fs-base); line-height: 1.35; overflow-wrap: anywhere; }
    .nc-meta { font-size: var(--fs-xs); color: var(--grey); display: flex; gap: 8px; align-items: center; }
    .nc-trait { background: var(--vigilance-bg); color: #8a5a00; border-radius: 4px; padding: 1px 6px; font-weight: 600; }
    .nc-pied { border-top: 1px solid var(--line); padding: 8px 14px; text-align: center; }
    .nc-voir-tout { background: none; border: none; color: var(--info); font-weight: 600; font-size: var(--fs-base); cursor: pointer; padding: 4px 8px; }
    .nc-voir-tout:hover { text-decoration: underline; }
    .nc-vide { text-align: center; color: var(--grey); padding: 22px 14px; margin: 0; font-size: var(--fs-base); }
  `],
})
export class NotificationsClocheComponent {
  readonly svc = inject(NotificationsService);
  private readonly router = inject(Router);
  /** La page complète « Notifications » est-elle affichée ? (la rangée du menu passe alors en doré) */
  readonly surPage = signal(this.router.url.startsWith('/notifications'));

  constructor() {
    this.router.events.subscribe((e) => { if (e instanceof NavigationEnd) this.surPage.set(e.urlAfterRedirects.startsWith('/notifications')); });
  }

  /** « Voir tout » : ferme le petit panneau et ouvre l'écran Notifications en grand format. */
  voirTout(): void {
    this.svc.fermer();
    this.router.navigate(['/notifications']);
  }
  readonly filtres: { code: FiltreNotifications; label: string }[] = [
    { code: 'tout', label: 'Tout' }, { code: 'non_lues', label: 'Non lues' }, { code: 'a_traiter', label: 'À traiter' },
  ];

  @HostListener('document:click')
  clicAilleurs(): void { if (this.svc.ouvert()) this.svc.fermer(); }

  @HostListener('document:keydown.escape')
  echap(): void { this.svc.fermer(); }

  trackN(_: number, n: Notification): string { return n.id; }
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
