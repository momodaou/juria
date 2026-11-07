import { Component, OnInit, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { NotificationsService, FiltreNotifications } from '../../core/notifications.service';

// Écran « Notifications » (07/11/2026) : le centre de notifications en grand format, comme les autres menus. Mêmes données que la
// cloche du menu (qui n'est plus qu'un raccourci avec sa pastille) : filtres, marquer comme lu, « Voir plus », activation des
// alertes du navigateur. Les textes sont composés par le serveur (aucun montant, aucun nom de client).
@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [DatePipe],
  template: `
    <header class="page-head">
      <div>
        <h1>Notifications</h1>
        <p>Tout ce qui vous concerne : demandes de décision, tâches et diligences confiées, délais, informations. Cliquez sur une ligne pour ouvrir l'écran concerné.</p>
      </div>
      <button type="button" class="btn" [disabled]="svc.nonLues() === 0" (click)="svc.toutLire()">Tout marquer comme lu</button>
    </header>

    <div class="nt-barre">
      @for (f of filtres; track f.code) {
        <button type="button" class="nt-chip" [class.nt-on]="svc.filtre() === f.code" (click)="svc.charger(f.code)">
          {{ f.label }}@if (f.code === 'non_lues' && svc.nonLues() > 0) { ({{ svc.nonLues() }}) }@if (f.code === 'a_traiter' && svc.aTraiter() > 0) { ({{ svc.aTraiter() }}) }
        </button>
      }
    </div>

    @if (svc.permissionAlertes() === 'default') {
      <div class="nt-alertes">
        <span>Recevez une bulle du système pour les urgences quand JURIA est en arrière-plan.</span>
        <button type="button" class="btn" (click)="svc.activerAlertes()">Activer les alertes du navigateur</button>
      </div>
    } @else if (svc.permissionAlertes() === 'denied') {
      <p class="muted">Les alertes du navigateur sont bloquées : autorisez-les dans les réglages du site pour les recevoir.</p>
    } @else if (svc.permissionAlertes() === 'granted') {
      <p class="muted">Alertes du navigateur activées.</p>
    }

    <section class="panel nt-liste">
      @for (n of svc.liste(); track n.id) {
        <button type="button" class="nt-ligne" [class.nt-nonlue]="!n.lue_le" (click)="svc.ouvrirDepuisPage(n)">
          <span class="nt-pt" [class.nt-critique]="n.niveau === 'critique'" [class.nt-action]="n.niveau === 'action'" [class.nt-info]="n.niveau === 'information'"></span>
          <span class="nt-texte">{{ n.texte }}</span>
          <span class="nt-etiquettes">
            @if (n.a_traiter) { <span class="tag attente">À traiter</span> }
            @if (n.niveau === 'critique' && n.a_traiter) { <span class="tag haute">Urgent</span> }
          </span>
          <span class="nt-date">{{ n.cree_le | date: 'dd/MM/yyyy HH:mm' }}</span>
        </button>
      } @empty {
        <p class="muted nt-vide">@if (svc.chargement()) { Chargement… } @else { Rien à signaler. }</p>
      }
    </section>

    @if (svc.plusAnciennes()) {
      <p class="nt-plus"><button type="button" class="btn" [disabled]="svc.chargement()" (click)="svc.chargerPlus()">Voir les notifications plus anciennes</button></p>
    }
  `,
  styles: [`
    .btn { background: var(--gold); color: #1b2436; border: none; border-radius: 8px; padding: 9px 14px; font-weight: 600; cursor: pointer; font-size: var(--fs-base); }
    .btn:disabled { opacity: .5; cursor: default; }
    .nt-barre { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
    .nt-chip { background: var(--light); border: none; border-radius: 999px; padding: 6px 14px; font-size: var(--fs-base); color: var(--slate); cursor: pointer; }
    .nt-chip.nt-on { background: var(--navy); color: #fff; }
    .nt-alertes { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; background: var(--info-bg); border: 1px solid var(--line);
      border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; font-size: var(--fs-base); color: var(--info); }
    .nt-liste { padding: 0; overflow: hidden; }
    .nt-ligne { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; background: #fff; color: #22303f; border: none; border-bottom: 1px solid var(--line);
      padding: 13px 16px; cursor: pointer; font: inherit; font-size: var(--fs-md); }
    .nt-ligne:last-child { border-bottom: none; }
    .nt-ligne:hover { background: var(--light); }
    .nt-ligne.nt-nonlue { background: #f6f9fd; }
    .nt-ligne.nt-nonlue .nt-texte { font-weight: 600; }
    .nt-pt { flex: 0 0 auto; width: 10px; height: 10px; border-radius: 50%; background: var(--line); }
    .nt-pt.nt-critique { background: var(--red); } .nt-pt.nt-action { background: var(--amber); } .nt-pt.nt-info { background: var(--info); }
    .nt-texte { flex: 1; min-width: 0; overflow-wrap: anywhere; line-height: 1.4; }
    .nt-etiquettes { display: flex; gap: 6px; flex: 0 0 auto; }
    .nt-date { flex: 0 0 auto; color: var(--grey); font-size: var(--fs-sm); min-width: 120px; text-align: right; }
    .nt-vide { text-align: center; padding: 28px 16px; margin: 0; }
    .nt-plus { text-align: center; margin: 16px 0; }
  `],
})
export class NotificationsComponent implements OnInit {
  readonly svc = inject(NotificationsService);
  private readonly route = inject(ActivatedRoute);
  readonly filtres: { code: FiltreNotifications; label: string }[] = [
    { code: 'tout', label: 'Toutes' }, { code: 'non_lues', label: 'Non lues' }, { code: 'a_traiter', label: 'À traiter' },
  ];

  ngOnInit(): void {
    const f = this.route.snapshot.queryParamMap.get('filtre');
    this.svc.charger(f === 'a_traiter' || f === 'non_lues' ? f : 'tout');
    this.svc.rafraichirCompteur();
  }
}
