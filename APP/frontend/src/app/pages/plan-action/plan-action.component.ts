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
        <!-- 14/10/2026 — titre renommé "Tâches" (menu latéral idem),
             sous-titre inchangé — voir CLAUDE.md. -->
        <h1>Tâches</h1>
        <p>Suivi des tâches du cabinet.</p>
      </div>
      <div class="entete-actions">
        <!-- 14/10/2026 — vue par défaut selon le rôle (avocats : tout le
             cabinet ; les autres : Mes tâches), mais toujours basculable —
             jamais une restriction dure, voir CLAUDE.md. -->
        <button class="lien" (click)="basculerVue()">
          {{ vueFiltre() === 'mine' ? 'Voir tout le cabinet' : 'Voir mes tâches seulement' }}
        </button>
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
            <!-- 11/10/2026 — regroupement technique/administratif (même
                 découpage que verifierDelegationTache() de taches.js et le
                 job alertesTachesRetard.js) : rend visible, au moment du
                 choix, comment la tâche sera classée et à qui elle sera
                 rapportée si elle prend du retard. -->
            <select class="in" [(ngModel)]="form.type" name="type">
              <optgroup label="Travail juridique (technique)">
                <option value="recherche">Recherche</option>
                <option value="redaction">Rédaction</option>
                <option value="revue">Revue</option>
                <option value="appel_client">Appel client</option>
                <option value="depot">Dépôt</option>
              </optgroup>
              <optgroup label="Administratif / gestion">
                <option value="facturation">Facturation</option>
                <option value="relance">Relance</option>
                <option value="collecte_pieces">Collecte de pièces</option>
                <option value="autre">Autre</option>
              </optgroup>
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
              @for (u of responsablesDisponibles(); track u.id) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
            </select>
            <!-- 10/10/2026 — Bloc D du diagnostic instruction avocat ->
                 collaborateur : liste filtrée, indicatif côté écran (la
                 vraie garde est serveur, voir taches.js). -->
            @if (!estAvocat()) { <span class="hint">{{ hintDelegation() }}</span> }
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
          <!-- 10/10/2026 — champ "description" exposé (diagnostic
               instruction avocat -> collaborateur, Bloc A) : existait en
               base depuis le premier schéma, jamais accessible à l'écran. -->
          <div class="col2"><label>Instructions <span class="muted">(facultatif)</span></label><input class="in" [(ngModel)]="form.description" name="description" /></div>
        </div>
        <button class="btn" (click)="creer()" [disabled]="!form.titre || creationEnCours()">{{ creationEnCours() ? 'Ajout…' : 'Ajouter' }}</button>
        @if (erreur()) { <p class="err">{{ erreur() }}</p> }
      </section>
    }

    <div class="kanban">
      @for (col of colonnes; track col.statut) {
        <div class="colonne">
          <h4>{{ col.titre }} <span class="compte">{{ parStatut(col.statut).length }}</span></h4>
          @for (t of parStatut(col.statut); track t.id) {
            <div class="carte" [class.urgente]="t.priorite === 'urgente'">
              @if (editionId() === t.id) {
                <!-- Correction d'une tâche (25/09/2026) -->
                <div class="carte-edition">
                  <input class="in" [(ngModel)]="editForm.titre" name="edTitre" placeholder="Titre" />
                  <input class="in" type="date" [(ngModel)]="editForm.echeance" name="edEch" />
                  <select class="in" [(ngModel)]="editForm.priorite" name="edPrio">
                    <option value="basse">Basse</option><option value="normale">Normale</option>
                    <option value="haute">Haute</option><option value="urgente">Urgente</option>
                  </select>
                  <select class="in" [(ngModel)]="editForm.responsable_id" name="edResp">
                    <option value="">Responsable…</option>
                    @for (u of responsablesDisponibles(); track u.id) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
                  </select>
                  <input class="in" [(ngModel)]="editForm.description" name="edDesc" placeholder="Instructions (facultatif)" />
                  <div class="carte-actions">
                    <button class="lien" (click)="enregistrerEdition()" [disabled]="!editForm.titre">Enregistrer</button>
                    <button class="lien" (click)="editionId.set(null)">Annuler</button>
                  </div>
                  @if (erreurEdition()) { <p class="err">{{ erreurEdition() }}</p> }
                </div>
              } @else {
              <div class="carte-titre">{{ t.titre }}</div>
              <div class="carte-meta">
                <!-- 14/10/2026 — libellé français + couleur par catégorie
                     (technique/administratif), voir libelleType()/
                     categorieType() ci-dessous. -->
                <span class="tag" [class.technique]="categorieType(t.type) === 'technique'" [class.administratif]="categorieType(t.type) === 'administratif'">{{ libelleType(t.type) }}</span>
                @if (t.priorite !== 'normale') { <span class="tag" [class.haute]="t.priorite === 'haute' || t.priorite === 'urgente'">{{ t.priorite }}</span> }
              </div>
              @if (t.dossier_id) { <div class="carte-info"><a class="lien" [routerLink]="['/dossiers', t.dossier_id]">{{ t.dossier_numero }}</a></div> }
              @if (t.responsable) { <div class="carte-info">{{ t.responsable }}</div> }
              <!-- 10/10/2026 — "Confié par X" (diagnostic instruction
                   avocat -> collaborateur, Bloc A) : n'affiché que si le
                   créateur diffère du responsable, sinon redondant. -->
              @if (t.cree_par_nom && t.cree_par !== t.responsable_id) { <div class="carte-info">Confié par {{ t.cree_par_nom }}</div> }
              @if (t.description) { <div class="carte-info carte-desc">{{ t.description }}</div> }
              @if (t.echeance) { <div class="carte-info">Échéance : {{ t.echeance | date:'dd/MM/yyyy' }}</div> }
              @if (col.statut === 'a_valider' && t.validation_requise) { <div class="carte-info">🔒 Validation requise</div> }
              <!-- ← / → restent des liens directement visibles (19/09/2026) :
                   c'est l'action PRIMAIRE de ce kanban (déplacer une carte),
                   pas une action secondaire à cacher dans un menu — même
                   logique que Gmail/Linear qui gardent l'action la plus
                   fréquente visible et réservent le menu "⋮" aux actions
                   occasionnelles (Valider/Annuler/Réactiver ici).
                   10/10/2026 — la flèche → de "À valider" vers "Terminé" est
                   retirée quand validation_requise=true (le serveur refuse
                   désormais ce contournement, Bloc A du diagnostic) : seule
                   l'action "Valider" du menu "⋮" (réservée à taches.valider)
                   reste disponible dans ce cas. -->
              <div class="carte-actions">
                @if (col.statut !== 'annule' && col.statut !== 'a_faire' && auth.peut('taches.statut.modifier')) { <button class="lien" (click)="deplacer(t, -1)">←</button> }
                @if (col.statut !== 'annule' && col.statut !== 'termine' && auth.peut('taches.statut.modifier') && !(col.statut === 'a_valider' && t.validation_requise)) { <button class="lien" (click)="deplacer(t, 1)">→</button> }
                <app-menu-actions [actions]="actionsPourTache(t, col)" />
              </div>
              @if (erreurDeplacement() === t.id) { <p class="err">{{ erreur() }}</p> }
              }
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
    .carte-desc{font-style:italic}
    .carte-titre{font-weight:600;margin-bottom:5px}
    .carte-meta{display:flex;gap:5px;margin-bottom:5px;flex-wrap:wrap}
    .carte-info{color:var(--grey);font-size:var(--fs-xs);margin-top:2px}
    .carte-actions{display:flex;gap:10px;margin-top:8px}
    .vide{font-size:var(--fs-sm)}
    .carte-edition .in{margin:0 0 6px;padding:6px 8px;font-size:var(--fs-sm)}
    .tag.haute{background:#fbe6e5;color:#b13a36}
    /* 14/10/2026 — distinction visuelle technique/administratif (voir CLAUDE.md) */
    .tag.technique{background:#e3edfb;color:#1f5fa8}
    .tag.administratif{background:#f3ecdf;color:#8a6a2f}
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
  // 26/09/2026 — audit doublons : garde anti-double-clic (priorité basse,
  // pas d'avertissement de doublon métier — titres de tâche souvent
  // légitimement répétés, même traitement qu'Échéances).
  readonly creationEnCours = signal(false);
  readonly editionId = signal<string | null>(null);
  readonly erreurEdition = signal('');
  // 10/10/2026 — Bloc A du diagnostic : la flèche → échoue désormais (409)
  // sur une tâche validation_requise=true si l'arrière-plan réagit plus
  // vite que l'écran (ex. double-clic) — affiche l'erreur sur la carte
  // concernée plutôt que silencieusement rien.
  readonly erreurDeplacement = signal<string | null>(null);
  editForm: any = {};

  // Navigation inter-modules (06/09/2026) — voir facturation.component.ts.
  readonly filtreDossierId = signal<string | null>(null);
  readonly filtreDossierNumero = signal<string | null>(null);

  dossierRecherche = '';
  dossierLabel = '';
  form: any = { type: 'autre', priorite: 'normale', validation_requise: false };

  // 14/10/2026 — vue par défaut selon le rôle (discussion avec
  // l'utilisateur, voir CLAUDE.md) : les profils habilités à déléguer
  // (avocats) démarrent sur tout le cabinet, cohérent avec leur visibilité
  // déjà complète sur la délégation ; les autres démarrent sur "Mes
  // tâches" (assignées à eux + celles qu'ils ont eux-mêmes confiées, pour
  // le juriste) — mais PEUVENT basculer sur tout le cabinet, ce n'est
  // jamais une permission qui retire l'accès (recommandation retenue :
  // un filtre d'affichage par défaut, pas une restriction dure). Un
  // juriste reste traité comme "les autres" ici : son droit de délégation
  // est restreint (pas vers un avocat, pas de tâche technique), donc son
  // confort par défaut doit rester "Mes tâches", pas tout le cabinet.
  readonly vueFiltre = signal<'mine' | 'tout'>('mine');

  basculerVue(): void {
    this.vueFiltre.update((v) => (v === 'mine' ? 'tout' : 'mine'));
    this.charger();
  }

  parStatut(statut: string): any[] {
    return this.taches().filter((t) => t.statut === statut);
  }

  // 14/10/2026 — libellé français + catégorie (technique/administratif)
  // du type de tâche, même découpage que verifierDelegationTache() et le
  // regroupement du formulaire de création ci-dessous — affichage
  // uniquement, la donnée en base reste le code ENUM.
  private readonly LIBELLES_TYPE: Record<string, string> = {
    recherche: 'Recherche', redaction: 'Rédaction', revue: 'Revue', depot: 'Dépôt',
    appel_client: 'Appel client', facturation: 'Facturation', relance: 'Relance',
    collecte_pieces: 'Collecte de pièces', autre: 'Autre',
  };
  private readonly TYPES_ADMINISTRATIFS = ['facturation', 'relance', 'collecte_pieces', 'autre'];

  libelleType(type: string): string {
    return this.LIBELLES_TYPE[type] ?? type;
  }

  categorieType(type: string): 'technique' | 'administratif' {
    return this.TYPES_ADMINISTRATIFS.includes(type) ? 'administratif' : 'technique';
  }

  // 10/10/2026 — Bloc D du diagnostic "instruction avocat -> collaborateur"
  // (voir CLAUDE.md) : qui peut confier une tâche à quelqu'un d'autre.
  // Indicatif côté écran uniquement — la vraie garde est serveur
  // (verifierDelegationTache() dans taches.js), même principe que le
  // filtrage du responsable de dossier dans ouverture.component.ts.
  private readonly rolesAvocatTache = ['associe', 'associe_fondateur', 'of_counsel', 'avocat_stagiaire', 'collaborateur'];

  estAvocat(): boolean {
    return this.rolesAvocatTache.includes(this.auth.utilisateur()?.role ?? '');
  }

  estJuriste(): boolean {
    return this.auth.utilisateur()?.role === 'juriste';
  }

  hintDelegation(): string {
    return this.estJuriste()
      ? "Vous ne pouvez confier une tâche qu'à vous-même, à un stagiaire non-avocat ou à l'assistante (et uniquement pour des tâches administratives)."
      : 'Vous ne pouvez vous assigner cette tâche qu\'à vous-même.';
  }

  responsablesDisponibles(): any[] {
    const moi = this.auth.utilisateur();
    if (!moi || this.estAvocat()) return this.utilisateurs();
    if (this.estJuriste()) {
      return this.utilisateurs().filter((u: any) => u.id === moi.id || ['stagiaire', 'assistante'].includes(u.role));
    }
    return this.utilisateurs().filter((u: any) => u.id === moi.id);
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.filtreDossierId.set(params.get('dossier'));
    this.filtreDossierNumero.set(params.get('dossierLabel'));
    // 14/10/2026 — vue par défaut : tout le cabinet pour qui peut déléguer
    // librement (avocats), "Mes tâches" pour les autres (dont le juriste,
    // au droit de délégation restreint) — voir le commentaire sur
    // vueFiltre ci-dessus.
    this.vueFiltre.set(this.estAvocat() ? 'tout' : 'mine');
    this.charger();
    this.api.utilisateurs().subscribe({ next: (u) => this.utilisateurs.set(u) });

    // 10/10/2026 — Bloc C du diagnostic "instruction avocat -> collaborateur"
    // (voir CLAUDE.md) : arrivée depuis "Transformer en tâche" (messagerie) —
    // le dossier est déjà filtré ci-dessus, on pré-remplit aussi le
    // formulaire de création et on l'ouvre directement, pour que l'auteur du
    // message n'ait plus qu'à choisir le responsable et valider.
    const titre = params.get('titre');
    if (titre) {
      this.form.titre = titre;
      if (this.filtreDossierId()) {
        this.form.dossier_id = this.filtreDossierId();
        this.dossierLabel = this.filtreDossierNumero() || '';
      }
      this.afficherForm.set(true);
    }
  }

  charger(): void {
    const dossierId = this.filtreDossierId();
    const params = new URLSearchParams();
    if (dossierId) params.set('dossier_id', dossierId);
    // 14/10/2026 — le filtre dossier (navigation inter-modules) prime sur
    // "Mes tâches" : arriver sur un dossier précis doit montrer toutes ses
    // tâches, pas seulement les miennes.
    else if (this.vueFiltre() === 'mine') params.set('mine', '1');
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
    this.creationEnCours.set(true);
    this.api.creerTache(this.form).subscribe({
      next: () => {
        this.creationEnCours.set(false);
        this.afficherForm.set(false);
        this.form = { type: 'autre', priorite: 'normale', validation_requise: false };
        this.dossierLabel = '';
        this.charger();
      },
      error: (e) => { this.creationEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Ajout impossible.'); },
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
    if (col.statut !== 'termine' && this.auth.peut('taches.creer')) items.push({ label: 'Modifier', action: () => this.commencerEdition(t) });
    if (col.statut !== 'termine' && this.auth.peut('taches.statut.modifier')) items.push({ label: 'Annuler', action: () => this.annulerTache(t), danger: true });
    return items;
  }

  commencerEdition(t: any): void {
    this.erreurEdition.set('');
    this.editForm = {
      titre: t.titre, echeance: t.echeance ? String(t.echeance).slice(0, 10) : '',
      priorite: t.priorite, responsable_id: t.responsable_id ?? '', description: t.description ?? '',
    };
    this.editionId.set(t.id);
  }

  enregistrerEdition(): void {
    const id = this.editionId();
    if (!id) return;
    const f = this.editForm;
    this.api.majDetailsTache(id, {
      titre: f.titre, echeance: f.echeance || null, priorite: f.priorite, responsable_id: f.responsable_id || undefined,
      description: f.description || null,
    }).subscribe({
      next: () => { this.editionId.set(null); this.charger(); },
      error: (e) => this.erreurEdition.set(e?.error?.error ?? 'Modification impossible'),
    });
  }

  deplacer(t: any, sens: 1 | -1): void {
    this.erreurDeplacement.set(null);
    const i = this.colonnes.findIndex((c) => c.statut === t.statut);
    const suivant = this.colonnes[i + sens];
    if (!suivant) return;
    this.api.majTache(t.id, suivant.statut).subscribe({
      next: () => this.charger(),
      error: (e) => { this.erreur.set(e?.error?.error ?? 'Déplacement impossible.'); this.erreurDeplacement.set(t.id); },
    });
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
