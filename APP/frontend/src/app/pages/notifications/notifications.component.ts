import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { NotificationsService, FiltreNotifications } from '../../core/notifications.service';
import { ApiService } from '../../core/api.service';

// Écran « Notifications » (07/11/2026) : le centre de notifications en grand format, comme les autres menus. Mêmes données que la
// cloche du menu (qui n'est plus qu'un raccourci avec sa pastille) : filtres, marquer comme lu, « Voir plus », activation des
// alertes du navigateur. Les textes sont composés par le serveur ; depuis la revue du 12/11/2026 ils peuvent porter un montant ou
// un nom d'avocat (la bulle du système reste neutre). « Marquer comme traitée » : niveau Action seulement.
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
      <div class="nt-aide">
        <b>Les alertes du navigateur sont bloquées.</b>
        <ul>
          <li><b>Safari :</b> menu Safari, Réglages, Sites web, Notifications ; cochez « Autoriser les sites web à demander l'autorisation d'envoyer des notifications », autorisez JURIA, puis rechargez la page.</li>
          <li><b>Chrome :</b> icône à gauche de l'adresse, Notifications, Autoriser.</li>
          <li><b>Mac :</b> vérifiez aussi Réglages Système, Notifications, votre navigateur (et que le mode Concentration ne les masque pas).</li>
          <li><b>Application du Dock :</b> activez la ligne « JURIA » dans Réglages Système, Notifications, puis quittez l'application (Cmd+Q) et rouvrez-la : l'autorisation n'est relue qu'au démarrage.</li>
        </ul>
      </div>
    } @else if (svc.permissionAlertes() === 'granted') {
      <p class="muted">Alertes du navigateur activées : une bulle neutre vous prévient des urgences et des messages quand JURIA n'est pas devant vous.
        <button type="button" class="nt-test" (click)="svc.testerAlerte()">Tester l'alerte</button></p>
    }

    <section class="panel nt-liste">
      @for (n of svc.liste(); track n.id) {
        <div class="nt-rangee">
          <button type="button" class="nt-ligne" [class.nt-nonlue]="!n.lue_le" (click)="svc.ouvrirDepuisPage(n)">
            <span class="nt-pt" [class.nt-critique]="n.niveau === 'critique'" [class.nt-action]="n.niveau === 'action'" [class.nt-info]="n.niveau === 'information'" [class.nt-rouge]="n.rouge"></span>
            <span class="nt-texte">{{ n.texte }}</span>
            <span class="nt-etiquettes">
              @if (n.a_traiter) { <span class="tag attente">À traiter</span> }
              @if (n.niveau === 'critique' && n.a_traiter) { <span class="tag haute">Urgent</span> }
            </span>
            <span class="nt-date">{{ n.cree_le | date: 'dd/MM/yyyy HH:mm' }}</span>
          </button>
          @if (n.a_traiter && n.niveau === 'action') {
            <button type="button" class="nt-traitee" (click)="svc.marquerTraitee(n)">Marquer comme traitée</button>
          }
        </div>
      } @empty {
        <p class="muted nt-vide">@if (svc.chargement()) { Chargement… } @else { Rien à signaler. }</p>
      }
    </section>

    <section class="panel nt-prefs">
      <h3>Mes préférences d'e-mail</h3>
      <p class="muted">Ces réglages ne décident que de recevoir un e-mail <b>en plus</b>. Vos notifications arrivent toujours dans la cloche, le bandeau des urgences et, si vous les avez activées, les alertes du navigateur : elles ne se désactivent pas.</p>
      @if (prefs(); as p) {
        @if (!p.emails_actifs_cabinet) {
          <p class="nt-note">Les e-mails de notification ne sont pas encore activés pour le cabinet : vos choix sont enregistrés et s'appliqueront à l'activation.</p>
        }
        <label class="nt-pref"><input type="checkbox" [checked]="p.valeurs.recap_lundi" (change)="changer('recap_lundi', $any($event.target).checked)" />
          <span><b>Le point du lundi</b> : un e-mail le lundi matin avec vos tâches, vos diligences et, selon votre rôle, les retards à suivre.</span></label>
        <label class="nt-pref"><input type="checkbox" [checked]="p.valeurs.recap_quotidien" (change)="changer('recap_quotidien', $any($event.target).checked)" />
          <span><b>Les récapitulatifs du matin et du soir</b> (jours ouvrés) : dépenses en attente de décision le matin, dossiers créés dans la journée le soir, selon votre rôle.</span></label>
        <label class="nt-pref"><input type="checkbox" [checked]="p.valeurs.email_urgence" [disabled]="p.verrouille.email_urgence" (change)="changer('email_urgence', $any($event.target).checked)" />
          <span><b>L'e-mail d'urgence</b> : un délai de procédure qui approche, un état de charges soumis à votre décision.
            @if (p.verrouille.email_urgence) { <i>Non modifiable pour les avocats : un délai de procédure ne doit jamais passer inaperçu.</i> }</span></label>
        @if (messagePrefs()) { <p class="nt-ok">{{ messagePrefs() }}</p> }
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
    .nt-prefs { margin-top: 18px; display: grid; gap: 10px; }
    .nt-prefs h3 { margin: 0; }
    .nt-pref { display: flex; gap: 10px; align-items: flex-start; font-size: var(--fs-base); cursor: pointer; }
    .nt-pref input { margin-top: 3px; }
    .nt-note { background: var(--light); border-radius: 8px; padding: 8px 12px; font-size: var(--fs-sm); color: var(--slate); margin: 0; }
    .nt-ok { color: var(--green, #2f7d54); font-size: var(--fs-sm); margin: 0; }
    .nt-rangee { display: flex; align-items: stretch; border-bottom: 1px solid var(--line); background: #fff; }
    .nt-rangee .nt-ligne { flex: 1; min-width: 0; border-bottom: none; }
    .nt-traitee { flex: 0 0 auto; background: none; border: none; border-left: 1px solid var(--line); padding: 0 14px; font: inherit; font-size: var(--fs-sm); font-weight: 600; color: var(--gold); cursor: pointer; }
    .nt-traitee:hover { background: var(--light); }
    .nt-pt.nt-rouge { background: var(--red); box-shadow: 0 0 0 2px rgba(190,60,60,.25); }
    .nt-aide { background: var(--vigilance-bg); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; font-size: var(--fs-base); color: #6b4a00; }
    .nt-aide ul { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 3px; }
    .nt-test { background: none; border: none; padding: 0 0 0 8px; font: inherit; font-weight: 600; color: var(--gold); cursor: pointer; }
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
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  readonly prefs = signal<any | null>(null);
  readonly messagePrefs = signal('');
  changer(cle: 'recap_lundi' | 'recap_quotidien' | 'email_urgence', valeur: boolean): void {
    this.api.enregistrerPreferencesNotifications({ [cle]: valeur }).subscribe({
      next: (r) => { this.prefs.set(r); this.messagePrefs.set('Préférence enregistrée.'); },
      error: () => this.messagePrefs.set('Enregistrement impossible, réessayez.'),
    });
  }
  readonly filtres: { code: FiltreNotifications; label: string }[] = [
    { code: 'tout', label: 'Toutes' }, { code: 'non_lues', label: 'Non lues' }, { code: 'a_traiter', label: 'À traiter' },
  ];

  ngOnInit(): void {
    const f = this.route.snapshot.queryParamMap.get('filtre');
    this.svc.charger(f === 'a_traiter' || f === 'non_lues' ? f : 'tout');
    this.svc.rafraichirCompteur();
    this.api.preferencesNotifications().subscribe({ next: (r) => this.prefs.set(r), error: () => {} });
  }
}
