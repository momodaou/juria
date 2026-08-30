import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Dossier } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

const COLONNES = [
  { statut: 'a_faire', titre: 'À faire' },
  { statut: 'en_cours', titre: 'En cours' },
  { statut: 'a_valider', titre: 'À valider' },
  { statut: 'termine', titre: 'Terminé' },
];

@Component({
  selector: 'app-plan-action',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <header class="page-head">
      <div>
        <h1>Plan d'action</h1>
        <p>Suivi des tâches du cabinet.</p>
      </div>
      @if (auth.peut('taches.creer')) {
        <button class="btn" (click)="afficherForm.set(!afficherForm())">
          {{ afficherForm() ? 'Annuler' : '+ Nouvelle tâche' }}
        </button>
      }
    </header>

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
              @if (t.dossier_numero) { <div class="carte-info">{{ t.dossier_numero }}</div> }
              @if (t.responsable) { <div class="carte-info">{{ t.responsable }}</div> }
              @if (t.echeance) { <div class="carte-info">Échéance : {{ t.echeance | date:'dd/MM/yyyy' }}</div> }
              <div class="carte-actions">
                @if (col.statut !== 'a_faire' && auth.peut('taches.statut.modifier')) { <button class="lien" (click)="deplacer(t, -1)">←</button> }
                @if (col.statut === 'a_valider' && auth.peut('taches.valider')) { <button class="lien" (click)="valider(t)">Valider</button> }
                @if (col.statut !== 'termine' && auth.peut('taches.statut.modifier')) { <button class="lien" (click)="deplacer(t, 1)">→</button> }
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
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:14px}
    label{font-size:12px;color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:680px}
    .col2{grid-column:1 / -1}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .suggestions{display:flex;flex-wrap:wrap;gap:6px;margin:-6px 0 12px}
    .chip{background:#fff;border:1px solid var(--line);border-radius:12px;padding:5px 11px;font-size:12.5px;cursor:pointer}
    .kanban{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
    @media(max-width:980px){.kanban{grid-template-columns:1fr 1fr}}
    .colonne{background:#f7f9fc;border:1px solid var(--line);border-radius:10px;padding:12px;min-height:140px}
    .colonne h4{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--grey);margin:0 0 10px;display:flex;justify-content:space-between}
    .compte{background:#fff;border:1px solid var(--line);border-radius:10px;padding:0 7px;font-size:11px}
    .carte{background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px 11px;margin-bottom:9px;font-size:13px}
    .carte.urgente{border-left:3px solid var(--red)}
    .carte-titre{font-weight:600;margin-bottom:5px}
    .carte-meta{display:flex;gap:5px;margin-bottom:5px;flex-wrap:wrap}
    .carte-info{color:var(--grey);font-size:11.5px;margin-top:2px}
    .carte-actions{display:flex;gap:10px;margin-top:8px}
    .lien{background:none;border:none;color:var(--gold);cursor:pointer;font-size:12.5px;padding:0;font-weight:600}
    .vide{font-size:12px}
    .tag.haute{background:#fbe6e5;color:#b13a36}
  `],
})
export class PlanActionComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly colonnes = COLONNES;
  readonly taches = signal<any[]>([]);
  readonly utilisateurs = signal<any[]>([]);
  readonly dossierResultats = signal<Dossier[]>([]);
  readonly afficherForm = signal(false);
  readonly erreur = signal('');

  dossierRecherche = '';
  dossierLabel = '';
  form: any = { type: 'autre', priorite: 'normale', validation_requise: false };

  parStatut(statut: string): any[] {
    return this.taches().filter((t) => t.statut === statut);
  }

  ngOnInit(): void {
    this.charger();
    this.api.utilisateurs().subscribe({ next: (u) => this.utilisateurs.set(u) });
  }

  charger(): void {
    this.api.taches().subscribe({ next: (t) => this.taches.set(t) });
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
}
