import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, Dossier } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MenuActionsComponent, ActionMenuItem } from '../../core/menu-actions.component';

@Component({
  selector: 'app-echeancier',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, MenuActionsComponent],
  template: `
    <header class="page-head"><h1>Échéances</h1></header>

    @if (filtreDossierNumero()) {
      <p class="filtre">Filtré sur le dossier <b>{{ filtreDossierNumero() }}</b> — <a class="lien" routerLink="." [queryParams]="{}">voir tout l'échéancier</a></p>
    }

    <section class="panel">
      <p class="muted" style="margin-bottom:12px">Filet de sécurité : chaque délai déclenche des alertes automatiques J-30, J-15, J-7, J-1 et jour J.</p>
      @if (auth.peut('evenements.creer')) {
        <div class="add">
          <select [(ngModel)]="nvDossier" name="d">
            <option value="">Dossier…</option>
            @for (d of dossiers(); track d.id) { <option [value]="d.id">{{ d.numero }} — {{ d.intitule }}</option> }
          </select>
          <select [(ngModel)]="nvType" name="t">
            @for (t of typesEvenementSaisie; track t.code) { <option [value]="t.code">{{ t.libelle }}</option> }
          </select>
          @if (nvType === 'autre') {
            <input [(ngModel)]="nvPrecision" name="tp" placeholder="Préciser…" />
          }
          <input [(ngModel)]="nvTitre" name="ti" placeholder="Intitulé" />
          <input type="date" [(ngModel)]="nvDate" name="da" />
          <button class="btn" (click)="ajouter()" [disabled]="!nvDossier || !nvDate || ajoutEvEnCours()">{{ ajoutEvEnCours() ? 'Ajout…' : 'Ajouter' }}</button>
        </div>
      }
      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
    </section>

    <section class="panel">
      <h3>Prochaines échéances</h3>
      @if (evenements().length) {
        <table>
          <tr><th>Échéance</th><th>Dossier</th><th>Type</th><th>Intitulé</th><th>Responsable</th><th>Alerte</th><th></th></tr>
          @for (e of evenements(); track e.id) {
            <tr>
              <td>{{ e.date_echeance | date:'dd/MM/yyyy' }}</td>
              <!-- 14/10/2026 — nom du dossier en plus de la seule référence,
                   pour reconnaître le dossier sans avoir à cliquer (même
                   besoin que la tuile "Délais à venir" du Tableau de bord,
                   qui l'affichait déjà). -->
              <td>
                <a class="lien dossier-ref" [routerLink]="['/dossiers', e.dossier_id]">{{ e.dossier_numero }}</a>
                @if (e.dossier_intitule) { <div class="dossier-nom">{{ e.dossier_intitule }}</div> }
              </td>
              <td>{{ libelleType(e.type) }}@if (e.type === 'autre' && e.precision) { : {{ e.precision }} }</td>
              <td>{{ e.titre || '—' }}</td>
              <td>{{ e.responsable || '—' }}</td>
              <td><span class="tag" [class.haute]="e.jours_restants <= 7" [class.moy]="e.jours_restants > 7 && e.jours_restants <= 15">{{ badge(e) }}</span></td>
              <td><app-menu-actions [actions]="actionsPourEvenement(e)" /></td>
            </tr>
            @if (editionEvId() === e.id) {
              <tr class="edition">
                <td colspan="7">
                  <div class="add">
                    <select [(ngModel)]="evForm.type" name="evType">
                      @if (evForm.type === 'audience') { <option value="audience">Audience (ancien)</option> }
                      @for (t of typesEvenementSaisie; track t.code) { <option [value]="t.code">{{ t.libelle }}</option> }
                    </select>
                    @if (evForm.type === 'autre') { <input [(ngModel)]="evForm.precision" name="evPrec" placeholder="Préciser…" /> }
                    <input [(ngModel)]="evForm.titre" name="evTitre" placeholder="Intitulé" style="flex:1;min-width:160px" />
                    <input type="date" [(ngModel)]="evForm.date_echeance" name="evDate" />
                    <select [(ngModel)]="evForm.responsable_id" name="evResp">
                      @for (u of membres(); track u.id) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
                    </select>
                  </div>
                  <p class="hint">Changer la date vaut report : les alertes J-30 → jour J repartent sur la nouvelle date.</p>
                  <button class="lien" (click)="enregistrerEvenement()" [disabled]="!evForm.date_echeance">Enregistrer</button>
                  <button class="lien" (click)="editionEvId.set(null)">Annuler</button>
                </td>
              </tr>
            }
          }
        </table>
      } @else { <p class="muted">Aucune échéance enregistrée.</p> }
    </section>

    <!-- 14/10/2026 — cette section était un doublon intégral de Plan
         d'action (même table, création/édition/kanban en double) :
         confusion signalée par l'utilisateur entre les deux écrans.
         Devenue un simple rappel en lecture seule des tâches à échéance,
         cohérent avec la logique propre à cette page (délais à venir) ;
         toute action réelle (créer, modifier, déplacer, déléguer) se fait
         désormais exclusivement dans le Plan d'action — voir CLAUDE.md. -->
    <section class="panel">
      <div class="entete-section">
        <h3>Tâches à venir</h3>
        <a class="lien" routerLink="/plan-action" [queryParams]="filtreDossierId() ? {dossier: filtreDossierId(), dossierLabel: filtreDossierNumero()} : {}">Gérer dans l'écran Tâches →</a>
      </div>
      <p class="muted" style="margin-bottom:12px">Rappel des tâches non terminées ayant une échéance — la création et le suivi se font dans l'écran Tâches.</p>
      @if (tachesAVenir().length) {
        <table>
          <tr><th>Tâche</th><th>Dossier</th><th>Responsable</th><th>Échéance</th></tr>
          @for (t of tachesAVenir(); track t.id) {
            <tr>
              <td>{{ t.titre }}</td>
              <td>
                @if (t.dossier_id) {
                  <a class="lien dossier-ref" [routerLink]="['/dossiers', t.dossier_id]">{{ t.dossier_numero }}</a>
                  @if (t.dossier_intitule) { <div class="dossier-nom">{{ t.dossier_intitule }}</div> }
                } @else { — }
              </td>
              <td>{{ t.responsable || '—' }}</td>
              <td>{{ t.echeance | date:'dd/MM/yyyy' }}</td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucune tâche à venir.</p> }
    </section>
  `,
  styles: [`
    .add{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
    .add select,.add input{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:var(--fs-base)}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .tag.moy{background:#fbf1dc;color:#9a6c12}
    .tag.done{background:#e3f5ec;color:#157a4f}
    .filtre{background:var(--light);border-radius:8px;padding:9px 14px;font-size:var(--fs-base);color:var(--slate);margin-bottom:14px}
    .entete-section{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
    .entete-section h3{margin:0}
    .edition td{background:var(--light);padding:12px 14px}
    .hint{font-size:var(--fs-sm);color:var(--slate);margin:4px 0 8px}
    /* 14/10/2026 — référence + nom du dossier empilés dans la même
       cellule (plus de visibilité sans cliquer), même besoin que la
       tuile "Délais à venir" du Tableau de bord. */
    .dossier-ref{font-weight:600}
    .dossier-nom{font-size:var(--fs-xs);color:var(--grey)}
  `],
})
export class EcheancierComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  readonly evenements = signal<any[]>([]);
  readonly taches = signal<any[]>([]);
  // 14/10/2026 — rappel en lecture seule (voir commentaire dans le
  // template) : tâches non terminées/annulées ayant une échéance.
  readonly tachesAVenir = computed(() => this.taches().filter((t) => t.echeance && t.statut !== 'termine' && t.statut !== 'annule'));
  readonly dossiers = signal<Dossier[]>([]);
  readonly erreur = signal('');
  // 26/09/2026 — audit doublons : garde anti-double-clic (priorité basse
  // pour ce module, titres/objets souvent légitimement répétés — pas
  // d'avertissement de doublon métier ici, contrairement à Facturation/
  // Rôle d'audience/Dépenses/Rétrocessions).
  readonly ajoutEvEnCours = signal(false);
  readonly membres = signal<any[]>([]);

  // Correction des échéances (25/09/2026).
  readonly editionEvId = signal<string | null>(null);
  evForm: any = {};

  // Navigation inter-modules (06/09/2026) — voir facturation.component.ts.
  readonly filtreDossierId = signal<string | null>(null);
  readonly filtreDossierNumero = signal<string | null>(null);

  // 10 types (11/09/2026) — les 8 déjà prévus par l'ENUM type_evenement
  // (dont Rendez-vous/Relance client, jusque-là absents de ce menu) plus
  // « Diligence / démarche » (générique, tout ce qui ne rentre pas déjà
  // dans un type précis) et « Autre » (avec précision libre).
  // 25/10/2026 — « Audience » retiré de la saisie (Rôle d'audience = source
  // unique), conservé pour libeller les anciennes échéances.
  get typesEvenementSaisie() { return this.typesEvenement.filter((t) => t.code !== 'audience'); }

  readonly typesEvenement = [
    { code: 'audience', libelle: 'Audience' },
    { code: 'rendez_vous', libelle: 'Rendez-vous' },
    { code: 'delai_procedure', libelle: 'Délai de procédure' },
    { code: 'delai_recours', libelle: 'Délai de recours' },
    { code: 'echeance_contractuelle', libelle: 'Échéance contractuelle' },
    { code: 'depot', libelle: 'Dépôt' },
    { code: 'relance_client', libelle: 'Relance client' },
    { code: 'prescription', libelle: 'Prescription' },
    { code: 'diligence', libelle: 'Diligence / démarche' },
    { code: 'autre', libelle: 'Autre' },
  ];

  nvDossier = ''; nvType = 'delai_procedure'; nvTitre = ''; nvDate = ''; nvPrecision = '';

  ngOnInit(): void {
    this.api.dossiers().subscribe({ next: (d) => this.dossiers.set(d), error: () => {} });
    this.api.utilisateurs().subscribe({ next: (u) => this.membres.set(u), error: () => {} });
    const params = this.route.snapshot.queryParamMap;
    this.filtreDossierId.set(params.get('dossier'));
    this.filtreDossierNumero.set(params.get('dossierLabel'));
    this.charger();
  }

  charger(): void {
    const dossierId = this.filtreDossierId();
    this.api.evenements(dossierId ?? undefined).subscribe({ next: (e) => this.evenements.set(e), error: () => {} });
    this.api.taches(dossierId ? `?dossier_id=${dossierId}` : '').subscribe({ next: (t) => this.taches.set(t), error: () => {} });
  }

  libelleType(code: string): string {
    return this.typesEvenement.find((t) => t.code === code)?.libelle ?? code;
  }

  badge(e: any): string {
    const j = e.jours_restants;
    if (j < 0) return 'dépassé';
    if (j === 0) return 'jour J';
    return 'J-' + j;
  }

  ajouter(): void {
    this.ajoutEvEnCours.set(true);
    this.api.creerEvenement({
      dossier_id: this.nvDossier, type: this.nvType, titre: this.nvTitre,
      date_echeance: this.nvDate, precision: this.nvType === 'autre' ? this.nvPrecision : null,
    }).subscribe({
      next: () => { this.ajoutEvEnCours.set(false); this.nvTitre = ''; this.nvDate = ''; this.nvPrecision = ''; this.charger(); },
      error: (e) => { this.ajoutEvEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Ajout impossible'); },
    });
  }

  // Échéances : traiter / modifier-reporter / annuler (25/09/2026 — le
  // statut existait en base mais rien ne le posait, un délai accompli
  // restait affiché indéfiniment).
  actionsPourEvenement(e: any): ActionMenuItem[] {
    if (!this.auth.peut('evenements.creer')) return [];
    return [
      { label: 'Marquer traité', action: () => this.changerStatutEvenement(e, 'traite') },
      { label: 'Modifier / reporter', action: () => this.modifierEvenement(e) },
      { label: 'Annuler', action: () => this.changerStatutEvenement(e, 'annule'), danger: true },
    ];
  }

  modifierEvenement(e: any): void {
    this.erreur.set('');
    this.evForm = {
      type: e.type, titre: e.titre, precision: e.precision ?? '',
      date_echeance: String(e.date_echeance).slice(0, 10), responsable_id: e.responsable_id,
    };
    this.editionEvId.set(e.id);
  }

  enregistrerEvenement(): void {
    const id = this.editionEvId();
    if (!id) return;
    const f = this.evForm;
    this.api.majEvenement(id, { ...f, precision: f.type === 'autre' ? f.precision : null }).subscribe({
      next: () => { this.editionEvId.set(null); this.charger(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Modification impossible'),
    });
  }

  changerStatutEvenement(e: any, statut: 'traite' | 'annule'): void {
    const libelle = e.titre || this.libelleType(e.type);
    if (statut === 'annule' && !confirm(`Annuler l'échéance « ${libelle} » ? Elle ne déclenchera plus d'alerte.`)) return;
    this.erreur.set('');
    this.api.statutEvenement(e.id, statut).subscribe({
      next: () => this.charger(),
      error: (err) => this.erreur.set(err?.error?.error ?? 'Action impossible'),
    });
  }
}
