import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, Dossier } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-echeancier',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, RouterLink],
  template: `
    <header class="page-head"><h1>Échéancier &amp; délais</h1></header>

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
          <tr><th>Échéance</th><th>Dossier</th><th>Type</th><th>Intitulé</th><th>Responsable</th><th>Alerte</th></tr>
          @for (e of evenements(); track e.id) {
            <tr>
              <td>{{ e.date_echeance | date:'dd/MM/yyyy' }}</td>
              <td><a class="lien" [routerLink]="['/dossiers', e.dossier_id]">{{ e.dossier_numero }}</a></td>
              <td>{{ libelleType(e.type) }}@if (e.type === 'autre' && e.precision) { : {{ e.precision }} }</td>
              <td>{{ e.titre || '—' }}</td>
              <td>{{ e.responsable || '—' }}</td>
              <td><span class="tag" [class.haute]="e.jours_restants <= 7" [class.moy]="e.jours_restants > 7 && e.jours_restants <= 15">{{ badge(e) }}</span></td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucune échéance enregistrée.</p> }
    </section>

    <section class="panel">
      <h3>Échéances administratives du cabinet</h3>
      <p class="muted" style="margin-bottom:12px">Obligations récurrentes du cabinet (fiscal, social, ordinal…), sans rattachement à un dossier ni un client.</p>
      @if (auth.peut('echeances_admin.gerer')) {
        <div class="add">
          <select [(ngModel)]="eaCategorie" name="eac">
            @for (c of categoriesEcheanceAdmin(); track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }
          </select>
          <input [(ngModel)]="eaLibelle" name="eal" placeholder="Libellé (ex. Renouvellement assurance RC pro)" style="flex:1;min-width:200px" />
          <select [(ngModel)]="eaPeriodicite" name="eap">
            @for (p of periodicitesEcheanceAdmin(); track p.code) { <option [value]="p.code">{{ p.libelle }}</option> }
          </select>
          <input type="date" [(ngModel)]="eaDate" name="ead" />
          <button class="btn" (click)="ajouterEcheanceAdmin()" [disabled]="!eaLibelle || !eaDate">Ajouter</button>
        </div>
      }
      @if (echeancesAdmin().length) {
        <table>
          <tr><th>Échéance</th><th>Catégorie</th><th>Libellé</th><th>Périodicité</th><th>Responsable</th><th>Payé</th><th>Alerte</th><th></th></tr>
          @for (e of echeancesAdmin(); track e.id) {
            <tr>
              <td>{{ e.prochaine_date | date:'dd/MM/yyyy' }}</td>
              <td>{{ libelleCategorieEcheanceAdmin(e.categorie) }}</td>
              <td>{{ e.libelle }}</td>
              <td>{{ libellePeriodiciteEcheanceAdmin(e.periodicite) }}</td>
              <td>{{ e.responsable || '—' }}</td>
              <td>@if (e.depense_montant) { {{ e.depense_montant | number }} FCFA } @else { — }</td>
              <td><span class="tag" [class.haute]="e.jours_restants <= 7" [class.moy]="e.jours_restants > 7 && e.jours_restants <= 15">{{ badge(e) }}</span></td>
              <td>
                @if (auth.peut('echeances_admin.gerer')) {
                  <input type="number" class="montant-decaisse" [(ngModel)]="montantsDecaisses[e.id]" name="md-{{e.id}}" placeholder="Montant décaissé" title="Montant réellement décaissé (FCFA) — optionnel, crée la dépense correspondante dans Dépenses &amp; caisse" />
                  <button class="lien" (click)="traiterEcheanceAdmin(e)">Marquer traité</button>
                }
              </td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucune échéance administrative enregistrée.</p> }
    </section>

    <section class="panel">
      <h3>Plan d'action — tâches</h3>
      @if (auth.peut('taches.creer')) {
        <div class="add">
          <input [(ngModel)]="ntTitre" name="nt" placeholder="Nouvelle tâche" style="flex:1;min-width:200px" />
          <input type="date" [(ngModel)]="ntEch" name="ne" />
          <button class="btn" (click)="ajouterTache()" [disabled]="!ntTitre">Ajouter</button>
        </div>
      }
      @if (taches().length) {
        <table>
          <tr><th>Tâche</th><th>Dossier</th><th>Échéance</th><th>Statut</th><th></th></tr>
          @for (t of taches(); track t.id) {
            <tr>
              <td>{{ t.titre }}</td>
              <td>@if (t.dossier_id) { <a class="lien" [routerLink]="['/dossiers', t.dossier_id]">{{ t.dossier_numero }}</a> } @else { — }</td>
              <td>{{ t.echeance ? (t.echeance | date:'dd/MM/yyyy') : '—' }}</td>
              <td><span class="tag" [class.done]="t.statut === 'termine'">{{ t.statut }}</span></td>
              <td>@if (t.statut !== 'termine' && auth.peut('taches.statut.modifier')) { <button class="lien" (click)="terminer(t)">Marquer fait</button> }</td>
            </tr>
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
    .montant-decaisse{width:110px;border:1px solid var(--line);border-radius:6px;padding:4px 6px;font-size:var(--fs-xs);margin-right:6px}
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

  // Échéances administratives du cabinet (11/09/2026) — gap comblé, voir
  // CLAUDE.md/HISTORY.md : la table et ses catalogues existaient depuis le
  // tout premier schéma, jamais reliés à aucun écran.
  readonly echeancesAdmin = signal<any[]>([]);
  readonly categoriesEcheanceAdmin = signal<{ code: string; libelle: string }[]>([]);
  readonly periodicitesEcheanceAdmin = signal<{ code: string; libelle: string }[]>([]);
  eaCategorie = 'fiscale'; eaLibelle = ''; eaPeriodicite = 'ponctuelle'; eaDate = '';
  // Montant décaissé saisi par ligne avant de cliquer « Marquer traité »
  // (optionnel — voir traiterEcheanceAdmin ci-dessous).
  montantsDecaisses: Record<string, number | null> = {};

  ngOnInit(): void {
    this.api.dossiers().subscribe({ next: (d) => this.dossiers.set(d), error: () => {} });
    this.api.listesValeurs('categorie_echeance').subscribe({ next: (v) => this.categoriesEcheanceAdmin.set(v), error: () => {} });
    this.api.listesValeurs('periodicite').subscribe({ next: (v) => this.periodicitesEcheanceAdmin.set(v), error: () => {} });
    const params = this.route.snapshot.queryParamMap;
    this.filtreDossierId.set(params.get('dossier'));
    this.filtreDossierNumero.set(params.get('dossierLabel'));
    this.charger();
  }

  charger(): void {
    const dossierId = this.filtreDossierId();
    this.api.evenements(dossierId ?? undefined).subscribe({ next: (e) => this.evenements.set(e), error: () => {} });
    this.api.taches(dossierId ? `?dossier_id=${dossierId}` : '').subscribe({ next: (t) => this.taches.set(t), error: () => {} });
    this.api.echeancesAdministratives().subscribe({ next: (e) => this.echeancesAdmin.set(e), error: () => {} });
  }

  libelleType(code: string): string {
    return this.typesEvenement.find((t) => t.code === code)?.libelle ?? code;
  }

  libelleCategorieEcheanceAdmin(code: string): string {
    return this.categoriesEcheanceAdmin().find((c) => c.code === code)?.libelle ?? code;
  }

  libellePeriodiciteEcheanceAdmin(code: string): string {
    return this.periodicitesEcheanceAdmin().find((p) => p.code === code)?.libelle ?? code;
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

  ajouterEcheanceAdmin(): void {
    this.api.creerEcheanceAdmin({
      categorie: this.eaCategorie, libelle: this.eaLibelle,
      periodicite: this.eaPeriodicite, prochaine_date: this.eaDate,
    }).subscribe({
      next: () => { this.eaLibelle = ''; this.eaDate = ''; this.charger(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Ajout impossible'),
    });
  }

  traiterEcheanceAdmin(e: any): void {
    this.erreur.set('');
    this.api.traiterEcheanceAdmin(e.id, this.montantsDecaisses[e.id]).subscribe({
      next: () => { delete this.montantsDecaisses[e.id]; this.charger(); },
      error: (err) => this.erreur.set(err?.error?.error ?? 'Action impossible'),
    });
  }

  ajouterTache(): void {
    this.api.creerTache({ titre: this.ntTitre, echeance: this.ntEch || null }).subscribe({
      next: () => { this.ntTitre = ''; this.ntEch = ''; this.charger(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Ajout impossible'),
    });
  }

  terminer(t: any): void {
    this.api.majTache(t.id, 'termine').subscribe({ next: () => this.charger(), error: () => {} });
  }
}
