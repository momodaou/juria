import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, Dossier } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MenuActionsComponent, ActionMenuItem } from '../../core/menu-actions.component';

const COLONNES = [
  { statut: 'a_faire', titre: 'À faire' },
  { statut: 'en_cours', titre: 'En cours' },
  { statut: 'a_valider', titre: 'À valider' },
  { statut: 'termine', titre: 'Terminé' },
  // Statut déjà prévu en base et accepté par l'API depuis toujours, mais
  // jamais câblé à aucun écran (13/09/2026, gap comblé) — pas dans le
  // circuit séquentiel à_faire→…→terminé (pas de flèches ←/→ dessus,
  // voir le template), juste une colonne à part avec un "Réactiver".
  { statut: 'annule', titre: 'Annulé' },
];

@Component({
  selector: 'app-plan-action',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, MenuActionsComponent],
  template: `
    <header class="page-head">
      <div>
        <h1>Plan d'action</h1>
        <p>Suivi des tâches du cabinet.</p>
      </div>
      <div class="entete-actions">
        <button class="lien" (click)="basculerAnciennes()">
          {{ afficherAnciennes() ? 'Masquer les tâches anciennes' : 'Voir les tâches plus anciennes' }}
        </button>
        @if (auth.peut('taches.creer')) {
          <button class="btn" (click)="afficherForm.set(!afficherForm())">
            {{ afficherForm() ? 'Annuler' : '+ Nouvelle tâche' }}
          </button>
        }
      </div>
    </header>

    @if (filtreDossierNumero()) {
      <p class="bandeau-filtre">Filtré sur le dossier <b>{{ filtreDossierNumero() }}</b> — <a class="lien" routerLink="." [queryParams]="{}">voir tout le plan d'action</a></p>
    }

    @if (afficherForm()) {
      <section class="panel">
        <h3>Nouvelle tâche</h3>
        <div class="grid2">
          <div class="col2"><label>Titre</label><input class="in" [(ngModel)]="form.titre" name="titre" /></div>
          <div>
            <label>Type</label>
            <select class="in" [(ngModel)]="form.type" name="type">
              <option value="recherche">Recherche</option>
              <option value="redaction">Rédaction</option>
              <option value="revue">Revue</option>
              <option value="depot">Dépôt</option>
              <option value="appel_client">Appel client</option>
              <option value="facturation">Facturation</option>
              <option value="relance">Relance</option>
              <option value="collecte_pieces">Collecte de pièces</option>
              <option value="autre">Autre</option>
            </select>
          </div>
          <div>
            <label>Priorité</label>
            <select class="in" [(ngModel)]="form.priorite" name="priorite">
              <option value="basse">Basse</option>
              <option value="normale">Normale</option>
              <option value="haute">Haute</option>
              <option value="urgente">Urgente</option>
            </select>
          </div>
          <div><label>Échéance</label><input class="in" type="date" [(ngModel)]="form.echeance" name="echeance" /></div>
          <div>
            <label>Responsable</label>
            <select class="in" [(ngModel)]="form.responsable_id" name="responsable">
              <option value="">—</option>
              @for (u of utilisateurs(); track u.id) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
            </select>
          </div>
          <div class="col2">
            <label>Dossier (optionnel)</label>
            <input class="in" [(ngModel)]="dossierRecherche" name="dossierRecherche"
                   (ngModelChange)="rechercherDossiers()" placeholder="Rechercher un dossier…" />
            @if (dossierResultats().length) {
              <div class="suggestions">
                @for (d of dossierResultats(); track d.id) {
                  <button type="button" class="chip" (click)="choisirDossier(d)">{{ d.numero }} — {{ d.intitule }}</button>
                }
              </div>
            }
            @if (form.dossier_id) { <p class="muted">Sélectionné : {{ dossierLabel }}</p> }
          </div>
          <div><label><input type="checkbox" [(ngModel)]="form.validation_requise" name="validation" /> Validation associé requise</label></div>
        </div>
        <button class="btn" (click)="creer()" [disabled]="!form.titre">Ajouter</button>
        @if (erreur()) { <p class="err">{{ erreur() }}</p> }
      </section>
    }

    <div class="kanban">
      @for (col of colonnes; track col.statut) {
        <div class="colonne">
          <h4>{{ col.titre }} <span class="compte">{{ parStatut(col.statut).length }}</span></h4>
          @for (t of parStatut(col.statut); track t.id) {
            <div class="carte" [class.urgente]="t.priorite === 'urgente'">
              <div class="carte-titre">{{ t.titre }}</div>
              <div class="carte-meta">
                <span class="tag">{{ t.type }}</span>
                @if (t.priorite !== 'normale') { <span class="tag" [class.haute]="t.priorite === 'haute' || t.priorite === 'urgente'">{{ t.priorite }}</span> }
              </div>
              @if (t.dossier_id) { <div class="carte-info"><a class="lien" [routerLink]="['/dossiers', t.dossier_id]">{{ t.dossier_numero }}</a></div> }
              @if (t.responsable) { <div class="carte-info">{{ t.responsable }}</div> }
              @if (t.echeance) { <div class="carte-info">Échéance : {{ t.echeance | date:'dd/MM/yyyy' }}</div> }
              <!-- ← / → restent des liens directement visibles (19/09/2026) :
                   c'est l'action PRIMAIRE de ce kanban (déplacer une carte),
                   pas une action secondaire à cacher dans un menu — même
                   logique que Gmail/Linear qui gardent l'action la plus
                   fréquente visible et réservent le menu "⋮" aux actions
                   occasionnelles (Valider/Annuler/Réactiver ici). -->
              <div class="carte-actions">
                @if (col.statut !== 'annule' && col.statut !== 'a_faire' && auth.peut('taches.statut.modifier')) { <button class="lien" (click)="deplacer(t, -1)">←</button> }
                @if (col.statut !== 'annule' && col.statut !== 'termine' && auth.peut('taches.statut.modifier')) { <button class="lien" (click)="deplacer(t, 1)">→</button> }
                <app-menu-actions [actions]="actionsPourTache(t, col)" />
              </div>
            </div>
          } @empty {
            <p class="muted vide">Aucune tâche.</p>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md)}
    label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:680px}
    .col2{grid-column:1 / -1}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .suggestions{display:flex;flex-wrap:wrap;gap:6px;margin:-6px 0 12px}
    .chip{background:#fff;border:1px solid var(--line);border-radius:12px;padding:5px 11px;font-size:var(--fs-sm);cursor:pointer}
    .kanban{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}
    @media(max-width:1180px){.kanban{grid-template-columns:1fr 1fr}}
    .colonne{background:#f7f9fc;border:1px solid var(--line);border-radius:10px;padding:12px;min-height:140px}
    .colonne h4{font-size:var(--fs-sm);text-transform:uppercase;letter-spacing:.5px;color:var(--grey);margin:0 0 10px;display:flex;justify-content:space-between}
    .compte{background:#fff;border:1px solid var(--line);border-radius:10px;padding:0 7px;font-size:var(--fs-xs)}
    .carte{background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px 11px;margin-bottom:9px;font-size:var(--fs-base)}
    .carte.urgente{border-left:3px solid var(--red)}
    .carte-titre{font-weight:600;margin-bottom:5px}
    .carte-meta{display:flex;gap:5px;margin-bottom:5px;flex-wrap:wrap}
    .carte-info{color:var(--grey);font-size:var(--fs-xs);margin-top:2px}
    .carte-actions{display:flex;gap:10px;margin-top:8px}
    .vide{font-size:var(--fs-sm)}
    .tag.haute{background:#fbe6e5;color:#b13a36}
    .bandeau-filtre{background:var(--light);border-radius:8px;padding:9px 14px;font-size:var(--fs-base);color:var(--slate);margin-bottom:14px}
    .entete-actions{display:flex;gap:14px;align-items:center}
  `],
})
export class PlanActionComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  readonly colonnes = COLONNES;
  readonly taches = signal<any[]>([]);
  readonly utilisateurs = signal<any[]>([]);
  readonly dossierResultats = signal<Dossier[]>([]);
  readonly afficherForm = signal(false);
  readonly afficherAnciennes = signal(false);
  readonly erreur = signal('');

  // Navigation inter-modules (06/09/2026) — voir facturation.component.ts.
  readonly filtreDossierId = signal<string | null>(null);
  readonly filtreDossierNumero = signal<string | null>(null);

  dossierRecherche = '';
  dossierLabel = '';
  form: any = { type: 'autre', priorite: 'normale', validation_requise: false };

  parStatut(statut: string): any[] {
    return this.taches().filter((t) => t.statut === statut);
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.filtreDossierId.set(params.get('dossier'));
    this.filtreDossierNumero.set(params.get('dossierLabel'));
    this.charger();
    this.api.utilisateurs().subscribe({ next: (u) => this.utilisateurs.set(u) });
  }

  charger(): void {
    const dossierId = this.filtreDossierId();
    const params = new URLSearchParams();
    if (dossierId) params.set('dossier_id', dossierId);
    if (this.afficherAnciennes()) params.set('anciennes', 'true');
    const qs = params.toString();
    this.api.taches(qs ? `?${qs}` : '').subscribe({ next: (t) => this.taches.set(t) });
  }

  basculerAnciennes(): void {
    this.afficherAnciennes.update((v) => !v);
    this.charger();
  }

  rechercherDossiers(): void {
    this.form.dossier_id = null;
    if (this.dossierRecherche.length < 2) { this.dossierResultats.set([]); return; }
    this.api.dossiers(this.dossierRecherche).subscribe({ next: (d) => this.dossierResultats.set(d) });
  }

  choisirDossier(d: Dossier): void {
    this.form.dossier_id = d.id;
    this.dossierLabel = `${d.numero} — ${d.intitule}`;
    this.dossierResultats.set([]);
    this.dossierRecherche = '';
  }

  creer(): void {
    this.erreur.set('');
    this.api.creerTache(this.form).subscribe({
      next: () => {
        this.afficherForm.set(false);
        this.form = { type: 'autre', priorite: 'normale', validation_requise: false };
        this.dossierLabel = '';
        this.charger();
      },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Ajout impossible.'),
    });
  }

  // Menu "⋮" (19/09/2026) — actions occasionnelles seulement ; ←/→ restent
  // des liens visibles à côté (voir commentaire dans le template).
  actionsPourTache(t: any, col: any): ActionMenuItem[] {
    if (col.statut === 'annule') {
      return this.auth.peut('taches.statut.modifier') ? [{ label: 'Réactiver', action: () => this.reactiver(t) }] : [];
    }
    const items: ActionMenuItem[] = [];
    if (col.statut === 'a_valider' && this.auth.peut('taches.valider')) items.push({ label: 'Valider', action: () => this.valider(t) });
    if (col.statut !== 'termine' && this.auth.peut('taches.statut.modifier')) items.push({ label: 'Annuler', action: () => this.annulerTache(t), danger: true });
    return items;
  }

  deplacer(t: any, sens: 1 | -1): void {
    const i = this.colonnes.findIndex((c) => c.statut === t.statut);
    const suivant = this.colonnes[i + sens];
    if (!suivant) return;
    this.api.majTache(t.id, suivant.statut).subscribe({ next: () => this.charger() });
  }

  valider(t: any): void {
    this.api.validerTache(t.id).subscribe({
      next: () => this.charger(),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Validation impossible (rôle associé requis).'),
    });
  }

  // Statut "annulé" (13/09/2026) : prévu en base et déjà accepté par
  // l'API depuis toujours, mais aucun écran ne le proposait — comblé ici.
  // Jamais destructeur (réversible via "Réactiver"), pas de confirmation
  // technique requise, mais un simple `confirm()` évite un clic accidentel
  // à côté des flèches ←/→ voisines.
  annulerTache(t: any): void {
    if (!confirm(`Annuler la tâche « ${t.titre} » ?`)) return;
    this.api.majTache(t.id, 'annule').subscribe({ next: () => this.charger() });
  }

  reactiver(t: any): void {
    this.api.majTache(t.id, 'a_faire').subscribe({ next: () => this.charger() });
  }
}
