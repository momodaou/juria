import { Component, inject, signal, OnInit } from '@angular/core';
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
            @for (t of typesEvenement; track t.code) { <option [value]="t.code">{{ t.libelle }}</option> }
          </select>
          @if (nvType === 'autre') {
            <input [(ngModel)]="nvPrecision" name="tp" placeholder="Préciser…" />
          }
          <input [(ngModel)]="nvTitre" name="ti" placeholder="Intitulé" />
          <input type="date" [(ngModel)]="nvDate" name="da" />
          <button class="btn" (click)="ajouter()" [disabled]="!nvDossier || !nvDate">Ajouter</button>
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
              <td><a class="lien" [routerLink]="['/dossiers', e.dossier_id]">{{ e.dossier_numero }}</a></td>
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
                      @for (t of typesEvenement; track t.code) { <option [value]="t.code">{{ t.libelle }}</option> }
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

    <section class="panel">
      <div class="entete-section">
        <h3>Plan d'action — tâches</h3>
        <button class="lien" (click)="basculerAnciennesTaches()">
          {{ afficherAnciennesTaches() ? 'Masquer les tâches anciennes' : 'Voir les tâches plus anciennes' }}
        </button>
      </div>
      @if (auth.peut('taches.creer')) {
        <div class="add">
          <input [(ngModel)]="ntTitre" name="nt" placeholder="Nouvelle tâche" style="flex:1;min-width:200px" />
          <input type="date" [(ngModel)]="ntEch" name="ne" />
          <button class="btn" (click)="ajouterTache()" [disabled]="!ntTitre">Ajouter</button>
        </div>
      }
      @if (taches().length) {
        <table>
          <tr><th>Tâche</th><th>Dossier</th><th>Responsable</th><th>Échéance</th><th>Statut</th><th></th></tr>
          @for (t of taches(); track t.id) {
            <tr>
              <td>{{ t.titre }}</td>
              <td>@if (t.dossier_id) { <a class="lien" [routerLink]="['/dossiers', t.dossier_id]">{{ t.dossier_numero }}</a> } @else { — }</td>
              <td>{{ t.responsable || '—' }}</td>
              <td>{{ t.echeance ? (t.echeance | date:'dd/MM/yyyy') : '—' }}</td>
              <td><span class="tag" [class.done]="t.statut === 'termine'">{{ t.statut }}</span></td>
              <td><app-menu-actions [actions]="actionsPourTache(t)" /></td>
            </tr>
            @if (editionTacheId() === t.id) {
              <tr class="edition">
                <td colspan="6">
                  <div class="add">
                    <input [(ngModel)]="tForm.titre" name="tTitre" placeholder="Titre" style="flex:1;min-width:200px" />
                    <input type="date" [(ngModel)]="tForm.echeance" name="tEch" />
                    <select [(ngModel)]="tForm.priorite" name="tPrio">
                      @for (p of priorites; track p.code) { <option [value]="p.code">{{ p.libelle }}</option> }
                    </select>
                    <select [(ngModel)]="tForm.responsable_id" name="tResp">
                      <option value="">Responsable…</option>
                      @for (u of membres(); track u.id) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
                    </select>
                  </div>
                  <button class="lien" (click)="enregistrerTache()" [disabled]="!tForm.titre">Enregistrer</button>
                  <button class="lien" (click)="editionTacheId.set(null)">Annuler</button>
                </td>
              </tr>
            }
          }
        </table>
      } @else { <p class="muted">Aucune tâche.</p> }
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
  `],
})
export class EcheancierComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  readonly evenements = signal<any[]>([]);
  readonly taches = signal<any[]>([]);
  readonly dossiers = signal<Dossier[]>([]);
  readonly erreur = signal('');
  readonly afficherAnciennesTaches = signal(false);
  readonly membres = signal<any[]>([]);

  // Correction des échéances et des tâches (25/09/2026).
  readonly editionEvId = signal<string | null>(null);
  evForm: any = {};
  readonly editionTacheId = signal<string | null>(null);
  tForm: any = {};
  readonly priorites = [
    { code: 'basse', libelle: 'Basse' }, { code: 'normale', libelle: 'Normale' },
    { code: 'haute', libelle: 'Haute' }, { code: 'urgente', libelle: 'Urgente' },
  ];

  // Navigation inter-modules (06/09/2026) — voir facturation.component.ts.
  readonly filtreDossierId = signal<string | null>(null);
  readonly filtreDossierNumero = signal<string | null>(null);

  // 10 types (11/09/2026) — les 8 déjà prévus par l'ENUM type_evenement
  // (dont Rendez-vous/Relance client, jusque-là absents de ce menu) plus
  // « Diligence / démarche » (générique, tout ce qui ne rentre pas déjà
  // dans un type précis) et « Autre » (avec précision libre).
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

  nvDossier = ''; nvType = 'audience'; nvTitre = ''; nvDate = ''; nvPrecision = '';
  ntTitre = ''; ntEch = '';

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
    const params = new URLSearchParams();
    if (dossierId) params.set('dossier_id', dossierId);
    if (this.afficherAnciennesTaches()) params.set('anciennes', 'true');
    const qs = params.toString();
    this.api.taches(qs ? `?${qs}` : '').subscribe({ next: (t) => this.taches.set(t), error: () => {} });
  }

  basculerAnciennesTaches(): void {
    this.afficherAnciennesTaches.update((v) => !v);
    this.charger();
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
    this.api.creerEvenement({
      dossier_id: this.nvDossier, type: this.nvType, titre: this.nvTitre,
      date_echeance: this.nvDate, precision: this.nvType === 'autre' ? this.nvPrecision : null,
    }).subscribe({
      next: () => { this.nvTitre = ''; this.nvDate = ''; this.nvPrecision = ''; this.charger(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Ajout impossible'),
    });
  }

  ajouterTache(): void {
    this.api.creerTache({ titre: this.ntTitre, echeance: this.ntEch || null }).subscribe({
      next: () => { this.ntTitre = ''; this.ntEch = ''; this.charger(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Ajout impossible'),
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

  // Menu "⋮" (19/09/2026) ; « Modifier » ajouté le 25/09/2026.
  actionsPourTache(t: any): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];
    const peutStatut = this.auth.peut('taches.statut.modifier');
    if (t.statut === 'annule') return peutStatut ? [{ label: 'Réactiver', action: () => this.reactiverTache(t) }] : [];
    if (t.statut === 'termine') return [];
    if (peutStatut) items.push({ label: 'Marquer fait', action: () => this.terminer(t) });
    if (this.auth.peut('taches.creer')) items.push({ label: 'Modifier', action: () => this.modifierTache(t) });
    if (peutStatut) items.push({ label: 'Annuler', action: () => this.annulerTache(t), danger: true });
    return items;
  }

  modifierTache(t: any): void {
    this.erreur.set('');
    this.tForm = {
      titre: t.titre, echeance: t.echeance ? String(t.echeance).slice(0, 10) : '',
      priorite: t.priorite, responsable_id: t.responsable_id ?? '',
    };
    this.editionTacheId.set(t.id);
  }

  enregistrerTache(): void {
    const id = this.editionTacheId();
    if (!id) return;
    const f = this.tForm;
    this.api.majDetailsTache(id, {
      titre: f.titre, echeance: f.echeance || null, priorite: f.priorite, responsable_id: f.responsable_id || undefined,
    }).subscribe({
      next: () => { this.editionTacheId.set(null); this.charger(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Modification impossible'),
    });
  }

  terminer(t: any): void {
    this.api.majTache(t.id, 'termine').subscribe({ next: () => this.charger(), error: () => {} });
  }

  // Statut "annulé" (13/09/2026) — voir plan-action.component.ts pour le
  // même comblement côté kanban.
  annulerTache(t: any): void {
    if (!confirm(`Annuler la tâche « ${t.titre} » ?`)) return;
    this.api.majTache(t.id, 'annule').subscribe({ next: () => this.charger(), error: () => {} });
  }

  reactiverTache(t: any): void {
    this.api.majTache(t.id, 'a_faire').subscribe({ next: () => this.charger(), error: () => {} });
  }
}
