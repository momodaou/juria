import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DocumentPreviewService } from '../../core/document-preview.service';
import { MenuActionsComponent, ActionMenuItem } from '../../core/menu-actions.component';
import { DossierPickerComponent } from '../../core/dossier-picker.component';

@Component({
  selector: 'app-courrier',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, MenuActionsComponent, DossierPickerComponent],
  template: `
    <header class="page-head">
      <div>
        <h1>Registre du courrier</h1>
        <p>Arrivée / départ, référencement automatique, déclenchement d'événements.</p>
      </div>
    </header>

    @if (filtreDossierNumero()) {
      <p class="bandeau-filtre">Filtré sur le dossier <b>{{ filtreDossierNumero() }}</b> — <a class="lien" routerLink="." [queryParams]="{}">voir tout le courrier</a></p>
    }

    @if (auth.peut('courriers.creer')) {
    <section class="panel">
      <h3>Nouveau courrier</h3>
      <div class="grid2">
        <div>
          <label>Sens</label>
          <select class="in" [(ngModel)]="form.sens" name="sens">
            <option value="arrivee">Arrivée</option>
            <option value="depart">Départ</option>
          </select>
        </div>
        <div>
          <label>Type</label>
          <select class="in" [(ngModel)]="form.type" name="type">
            <option value="lettre">Lettre</option>
            <option value="assignation">Assignation</option>
            <option value="requete">Requête</option>
            <option value="convocation">Convocation</option>
            <option value="notification">Notification (avocat à avocat, notaire…)</option>
            <option value="acte_huissier">Acte d'huissier</option>
            <option value="acte_notaire">Acte de notaire</option>
            <option value="decision_justice">Décision de justice</option>
            <option value="conclusions">Conclusions</option>
            <option value="courrier_officiel">Courrier officiel</option>
            <option value="administratif">Administratif</option>
            <option value="autre">Autre</option>
          </select>
        </div>
        <!-- 14/10/2026 — libellé libre si "Autre" (gap signalé par
             l'utilisateur), même patron que Rôle d'audience/type_audience. -->
        @if (form.type === 'autre') {
          <div><label>Préciser</label><input class="in" [(ngModel)]="form.type_precision" name="typePrecision" /></div>
        }
        <div><label>Date</label><input class="in" type="date" [(ngModel)]="form.date_courrier" name="date" /></div>
        <div>
          <label>Nature du correspondant</label>
          <select class="in" [(ngModel)]="form.acteur_type" name="acteur">
            <option value="">—</option>
            <option value="client">Client</option>
            <option value="confrere">Confrère</option>
            <option value="huissier">Huissier</option>
            <option value="notaire">Notaire</option>
            <option value="juridiction">Juridiction</option>
            <option value="administration">Administration</option>
            <option value="autre">Autre</option>
          </select>
        </div>
        <div class="col2">
          <label>{{ form.sens === 'arrivee' ? 'Expéditeur' : 'Destinataire' }}</label>
          <input class="in" [(ngModel)]="form.correspondant" name="correspondant" />
        </div>
        <div class="col2"><label>Objet</label><input class="in" [(ngModel)]="form.objet" name="objet" /></div>

        <div class="col2">
          <label>Dossier concerné (optionnel)</label>
          <app-dossier-picker [valeur]="form.dossier_id" (valeurChange)="form.dossier_id = $event"></app-dossier-picker>
        </div>

        <div>
          <label>Support</label>
          <select class="in" [(ngModel)]="form.support" name="support">
            <option value="papier">Papier</option>
            <option value="numerique">Numérique</option>
            <option value="mixte">Mixte</option>
          </select>
        </div>
        <div>
          <!-- 17/10/2026 — l'assistante enregistre avec l'AVOCAT DESTINATAIRE
               (jamais d'imputation à ce stade) ; l'avocat oriente puis impute. -->
          <label>{{ form.sens === 'arrivee' ? (form.dossier_id ? 'Avocat destinataire' : 'Avocat destinataire (obligatoire sans dossier)') : 'Avocat' }}</label>
          <select class="in" [(ngModel)]="form.destinataire_id" name="destinataire">
            <option value="">—</option>
            @for (m of avocats(); track m.id) { <option [value]="m.id">{{ m.prenom }} {{ m.nom }}</option> }
          </select>
        </div>
        <div class="col2">
          <label>Scan / pièce jointe</label>
          <input class="in" type="file" (change)="fichierChoisi($event)" />
          <!-- 14/10/2026 — gap signalé par l'utilisateur : un courrier (ex.
               demande initiale) précède souvent l'ouverture du dossier ;
               le scan n'a plus besoin d'attendre un dossier pour être
               conservé, voir courriers.js. -->
          @if (!form.dossier_id && form.sens === 'arrivee') { <p class="muted" style="margin:-6px 0 12px">Sans dossier : l'acte est transmis à l'avocat destinataire, qui l'orientera (rattacher, créer le dossier ou sans suite). Le scan est conservé sur le courrier et rejoint automatiquement la GED dès qu'un dossier lui est rattaché.</p> }
        </div>
      </div>
      <button class="btn" (click)="creer()" [disabled]="!form.correspondant || creation() || (form.sens === 'arrivee' && !form.dossier_id && !form.destinataire_id)">
        {{ creation() ? 'Enregistrement…' : 'Enregistrer le courrier' }}
      </button>
      @if (dernierDeclenchement()) {
        <p class="ok-msg">✓ Déclenchement automatique : {{ libelleDeclenchement(dernierDeclenchement()) }}</p>
      }
      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
    </section>
    }

    <section class="panel">
      <div class="filtres">
        <select class="in filtre" [(ngModel)]="filtreSens" (ngModelChange)="charger()">
          <option value="">Tous sens</option>
          <option value="arrivee">Arrivée</option>
          <option value="depart">Départ</option>
        </select>
        <!-- 24/09/2026 — gap signalé par l'utilisateur : aucun filtre par
             type de courrier jusqu'ici (seulement sens + recherche libre). -->
        <select class="in filtre" [(ngModel)]="filtreType" (ngModelChange)="charger()">
          <option value="">Tous types</option>
          <option value="lettre">Lettre</option>
          <option value="assignation">Assignation</option>
          <option value="requete">Requête</option>
          <option value="convocation">Convocation</option>
          <option value="notification">Notification</option>
          <option value="acte_huissier">Acte d'huissier</option>
          <option value="acte_notaire">Acte de notaire</option>
          <option value="decision_justice">Décision de justice</option>
          <option value="conclusions">Conclusions</option>
          <option value="courrier_officiel">Courrier officiel</option>
          <option value="administratif">Administratif</option>
          <option value="autre">Autre</option>
        </select>
        <input class="search" placeholder="Rechercher (référence, correspondant, objet)…"
               [(ngModel)]="recherche" (ngModelChange)="charger()" />
        <!-- 15/10/2026 — Q3 : file de travail "papier reçu, pas encore
             numérisé" pour l'accueil. -->
        <label class="chk"><input type="checkbox" [(ngModel)]="filtreNumerisation" (ngModelChange)="charger()" /> En attente de numérisation</label>
        <label class="chk"><input type="checkbox" [(ngModel)]="filtreMes" (ngModelChange)="charger()" /> Mes courriers</label>
        <label class="chk"><input type="checkbox" [(ngModel)]="filtreAOrienter" (ngModelChange)="charger()" /> À orienter</label>
      </div>
      <!-- 15/10/2026 — Q5 : le visa ne calcule jamais le vrai délai légal
           (dépend du degré/juridiction, seul l'avocat peut le déterminer) —
           simple raccourci vers Échéances pour le saisir soi-même. -->
      @if (dernierVisa(); as v) {
        <p class="ok-msg">✓ Courrier visé — <a class="lien" [routerLink]="['/echeancier']" [queryParams]="{ dossier: v.dossierId, dossierLabel: v.dossierNumero }">ajouter l'échéance procédurale réelle sur {{ v.dossierNumero }} →</a></p>
      }
      @if (courriers().length) {
        <table>
          <tr><th>Réf.</th><th>Sens</th><th>Type</th><th>Date</th><th>Correspondant</th><th>Objet</th><th>Dossier</th><th>Destinataire / imputé</th><th>Pièce</th><th>Statut</th><th></th></tr>
          @for (c of courriers(); track c.id) {
            <tr>
              <td>{{ c.reference }}</td>
              <td><span class="tag" [class.ok]="c.sens === 'arrivee'">{{ c.sens === 'arrivee' ? 'Arrivée' : 'Départ' }}</span></td>
              <td>{{ libelleType(c.type, c.type_precision) }}</td>
              <td>{{ c.date_courrier | date:'dd/MM/yyyy' }}</td>
              <td>{{ c.correspondant }}</td>
              <td>{{ c.objet || '—' }}</td>
              <td>@if (c.dossier_id) { <a class="lien" [routerLink]="['/dossiers', c.dossier_id]">{{ c.dossier_numero }}</a> } @else { — }</td>
              <td>
                @if (c.destinataire_nom) { <span class="muted-sm">Destinataire :</span> {{ c.destinataire_nom }}<br> }
                @if (c.orientation === 'a_orienter') { <span class="tag attente">À orienter</span><br> }
                @if (c.orientation === 'sans_suite') { <span class="tag" [title]="c.orientation_motif || ''">Sans suite</span><br> }
                @if (c.impute_a) { <span class="muted-sm">Imputé à :</span> {{ c.impute_a }} }
                @if (!c.destinataire_nom && !c.impute_a && c.orientation !== 'a_orienter') { — }
                <!-- 15/10/2026 — transmis_par/transmis_le existaient déjà
                     (depuis le tout premier schéma) mais n'étaient jamais
                     affichés ; vise_par/vise_le sont nouveaux (Q1). -->
                @if (c.transmis_le) { <br><span class="muted-sm">transmis le {{ c.transmis_le | date:'dd/MM/yyyy HH:mm' }}</span> }
                @if (c.vise_le) { <br><span class="muted-sm">visé par {{ c.vise_par_nom }} le {{ c.vise_le | date:'dd/MM/yyyy HH:mm' }}</span> }
              </td>
              <td>
                @if (c.document_id) {
                  <button class="lien" (click)="apercuPiece(c)">Aperçu</button> ·
                  <button class="lien" (click)="ouvrirPiece(c)">Ouvrir</button>
                } @else if (c.fichier_brut_nom) {
                  <!-- 14/10/2026 — pièce déposée avant qu'un dossier
                       n'existe (fichier_brut_*) : même actions, lues
                       depuis le courrier plutôt que la GED tant qu'aucun
                       dossier n'est rattaché. -->
                  <button class="lien" (click)="apercuPieceBrute(c)">Aperçu</button> ·
                  <button class="lien" (click)="ouvrirPieceBrute(c)">Ouvrir</button>
                } @else if (auth.peut('courriers.creer')) {
                  <input type="file" class="mini-file" (change)="joindrePiece(c, $event)" title="Joindre le scan de ce courrier" />
                } @else { — }
              </td>
              <td>
                @if (auth.peut('courriers.statut.modifier')) {
                  <select class="statut-select" [ngModel]="c.statut" (ngModelChange)="changerStatut(c, $event)">
                    <option value="recu">Reçu</option>
                    <option value="impute">Imputé</option>
                    <option value="en_traitement">En traitement</option>
                    <option value="traite">Traité</option>
                    <option value="expedie">Expédié</option>
                  </select>
                } @else {
                  {{ c.statut }}
                }
                <!-- 15/10/2026 — Q4 : envoi effectif tracé symétriquement
                     à l'imputation côté arrivée. -->
                @if (c.expedie_le) { <br><span class="muted-sm">expédié le {{ c.expedie_le | date:'dd/MM/yyyy HH:mm' }}</span> }
              </td>
              <td><app-menu-actions [actions]="actionsPour(c)" /></td>
            </tr>
            @if (orientationId() === c.id) {
              <tr class="edition">
                <td colspan="11">
                  <b>Orienter l'acte {{ c.reference }}</b> — que devient-il ?
                  <div class="grid2" style="margin-top:8px">
                    <div class="col2">
                      <label>Décision</label>
                      <select class="in" [(ngModel)]="orientForm.decision" name="orDecision">
                        <option value="rattache">Rattacher à un dossier existant</option>
                        <option value="cree">J'ai déjà créé le dossier</option>
                        <option value="nouveau">Créer le dossier maintenant</option>
                        <option value="sans_suite">Classer sans suite</option>
                      </select>
                    </div>
                    @if (orientForm.decision === 'rattache' || orientForm.decision === 'cree') {
                      <div class="col2"><label>Dossier</label>
                        <app-dossier-picker [valeur]="orientForm.dossier_id" (valeurChange)="orientForm.dossier_id = $event"></app-dossier-picker></div>
                    }
                    @if (orientForm.decision === 'sans_suite') {
                      <div class="col2"><label>Motif (obligatoire)</label><input class="in" [(ngModel)]="orientForm.motif" name="orMotif" /></div>
                    }
                  </div>
                  <button class="lien" (click)="orienter(c)" [disabled]="orientationEnCours()">{{ libelleOrienter() }}</button>
                  <button class="lien" (click)="orientationId.set(null)">Annuler</button>
                  @if (erreur()) { <p class="err">{{ erreur() }}</p> }
                </td>
              </tr>
            }
            @if (imputationId() === c.id) {
              <tr class="edition">
                <td colspan="11">
                  <b>Imputer le travail — {{ c.reference }}</b> (crée une tâche liée au dossier, visible dans « Mes tâches » du collaborateur)
                  <div class="grid2" style="margin-top:8px">
                    <div>
                      <label>Collaborateur (juriste, avocat stagiaire, stagiaire)</label>
                      <select class="in" [(ngModel)]="imputForm.imputation_id" name="imCollab">
                        <option value="">—</option>
                        @for (m of imputables(); track m.id) { <option [value]="m.id">{{ m.prenom }} {{ m.nom }}</option> }
                      </select>
                    </div>
                    <div><label>Échéance du travail (facultative)</label><input class="in" type="date" [(ngModel)]="imputForm.echeance" name="imEch" /></div>
                    <div class="col2"><label>Instructions (obligatoires)</label>
                      <textarea class="in" rows="3" [(ngModel)]="imputForm.instructions" name="imInstr" placeholder="Que doit-il faire ? (analyse, conclusions, pièces à réunir…)"></textarea></div>
                  </div>
                  <button class="lien" (click)="imputer(c)" [disabled]="imputationEnCours() || !imputForm.imputation_id || !imputForm.instructions">{{ imputationEnCours() ? 'Enregistrement…' : 'Imputer' }}</button>
                  <button class="lien" (click)="imputationId.set(null)">Annuler</button>
                  @if (erreur()) { <p class="err">{{ erreur() }}</p> }
                </td>
              </tr>
            }
            @if (editionId() === c.id) {
              <tr class="edition">
                <td colspan="11">
                  <div class="grid2">
                    <div>
                      <label>Type</label>
                      <select class="in" [(ngModel)]="editForm.type" name="edType">
                        <option value="lettre">Lettre</option>
                        <option value="assignation">Assignation</option>
                        <option value="requete">Requête</option>
                        <option value="convocation">Convocation</option>
                        <option value="notification">Notification</option>
                        <option value="acte_huissier">Acte d'huissier</option>
                        <option value="acte_notaire">Acte de notaire</option>
                        <option value="decision_justice">Décision de justice</option>
                        <option value="conclusions">Conclusions</option>
                        <option value="courrier_officiel">Courrier officiel</option>
                        <option value="administratif">Administratif</option>
                        <option value="autre">Autre</option>
                      </select>
                    </div>
                    @if (editForm.type === 'autre') {
                      <div><label>Préciser</label><input class="in" [(ngModel)]="editForm.type_precision" name="edTypePrecision" /></div>
                    }
                    <div><label>Date</label><input class="in" type="date" [(ngModel)]="editForm.date_courrier" name="edDate" /></div>
                    <div class="col2"><label>Correspondant</label><input class="in" [(ngModel)]="editForm.correspondant" name="edCorrespondant" /></div>
                    <div class="col2"><label>Objet</label><input class="in" [(ngModel)]="editForm.objet" name="edObjet" /></div>
                    <!-- 14/10/2026 — gap trouvé en construisant la migration
                         automatique de pièce : PUT /api/courriers/:id accepte
                         dossier_id depuis le 28/09/2026, mais aucun écran ne
                         l'exposait (le texte d'aide ci-dessous promettait une
                         « fiche du courrier » qui n'a jamais existé). Sans ce
                         champ, impossible de rattacher un dossier après coup
                         et donc de déclencher la migration de la pièce. -->
                    <div class="col2">
                      <label>Dossier (optionnel)</label>
                      <app-dossier-picker [valeur]="editForm.dossier_id" [nomInitial]="editDossierLabel" (valeurChange)="editForm.dossier_id = $event"></app-dossier-picker>
                    </div>
                  </div>
                  <p class="hint">La référence n'est pas modifiable.</p>
                  <button class="lien" (click)="enregistrerEdition()" [disabled]="editionEnCours()">{{ editionEnCours() ? 'Enregistrement…' : 'Enregistrer' }}</button>
                  <button class="lien" (click)="annulerEdition()">Annuler</button>
                  @if (erreur()) { <p class="err">{{ erreur() }}</p> }
                </td>
              </tr>
            }
          }
        </table>
      } @else {
        <p class="muted">Aucun courrier enregistré.</p>
      }
    </section>
  `,
  styles: [`
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md)}
    label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:680px}
    .col2{grid-column:1 / -1}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .ok-msg{color:var(--green);font-size:var(--fs-base);margin-top:10px}
    .filtres{display:flex;gap:10px;margin-bottom:14px}
    .filtre{width:auto;margin:0;max-width:180px}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    .statut-select{border:1px solid var(--line);border-radius:6px;padding:4px 8px;font-size:var(--fs-sm)}
    .bandeau-filtre{background:var(--light);border-radius:8px;padding:9px 14px;font-size:var(--fs-base);color:var(--slate);margin-bottom:14px}
    .edition td{background:var(--light);padding:12px 14px}
    .hint{display:block;font-size:var(--fs-sm);color:var(--grey);margin:0 0 10px}
    .mini-file{max-width:110px;font-size:var(--fs-xs)}
    .muted-sm{font-size:var(--fs-xs);color:var(--grey)}
    .chk{display:flex;align-items:center;gap:6px;font-size:var(--fs-sm);color:var(--slate);font-weight:400;white-space:nowrap}
  `],
})
export class CourrierComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly preview = inject(DocumentPreviewService);
  readonly courriers = signal<any[]>([]);
  editDossierLabel = '';
  readonly dernierDeclenchement = signal<any | null>(null);
  // 15/10/2026 — Q1 : raccourci affiché après un visa réussi, voir viser().
  readonly dernierVisa = signal<{ dossierId: string; dossierNumero: string } | null>(null);
  readonly erreur = signal('');
  readonly creation = signal(false);
  // Annuaire (GET /api/utilisateurs, ouvert à tous) pour le sélecteur
  // « Imputer à » — 28/09/2026.
  readonly membres = signal<any[]>([]);
  // Registre : avocat destinataire / collaborateurs imputables (17/10/2026).
  private static readonly ROLES_AVOCAT = ['associe', 'associe_fondateur', 'of_counsel', 'avocat_stagiaire', 'collaborateur'];
  private static readonly ROLES_IMPUTABLES = ['avocat_stagiaire', 'juriste', 'stagiaire'];
  readonly avocats = computed(() => this.membres().filter((m) => CourrierComponent.ROLES_AVOCAT.includes(m.role)));
  readonly imputables = computed(() => this.membres().filter((m) => CourrierComponent.ROLES_IMPUTABLES.includes(m.role)));
  readonly orientationId = signal<string | null>(null);
  readonly imputationId = signal<string | null>(null);
  readonly orientationEnCours = signal(false);
  readonly imputationEnCours = signal(false);
  orientForm: any = { decision: 'rattache' };
  imputForm: any = {};

  libelleOrienter(): string {
    if (this.orientForm.decision === 'nouveau') return 'Ouvrir la création du dossier →';
    return this.orientationEnCours() ? 'Enregistrement…' : "Valider l'orientation";
  }
  private peutOrienterOuImputer(c: any): boolean {
    const u = this.auth.utilisateur();
    return !!u && (u.role === 'associe' || u.role === 'associe_fondateur' || c.destinataire_id === u.id);
  }
  readonly editionId = signal<string | null>(null);
  readonly editionEnCours = signal(false);
  editForm: any = {};

  // Navigation inter-modules (06/09/2026) — voir facturation.component.ts.
  readonly filtreDossierId = signal<string | null>(null);
  readonly filtreDossierNumero = signal<string | null>(null);

  filtreMes = false;
  filtreAOrienter = false;
  recherche = '';
  filtreSens = '';
  filtreType = '';
  filtreNumerisation = false;
  form: any = { sens: 'arrivee', type: 'lettre', support: 'papier', date_courrier: new Date().toISOString().slice(0, 10) };
  fichierNouveauCourrier: File | null = null;

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.filtreDossierId.set(params.get('dossier'));
    this.filtreDossierNumero.set(params.get('dossierLabel'));
    if (params.get('orientation') === 'a_orienter') this.filtreAOrienter = true;
    this.charger();
    this.api.utilisateurs().subscribe({ next: (u) => this.membres.set(u), error: () => {} });
  }

  charger(): void {
    const dossierId = this.filtreDossierId();
    this.api.courriers({
      sens: this.filtreSens, type: this.filtreType, q: this.recherche,
      ...(dossierId ? { dossier_id: dossierId } : {}),
      ...(this.filtreNumerisation ? { en_attente_numerisation: 'true' } : {}),
      ...(this.filtreMes ? { mes: 'true' } : {}),
      ...(this.filtreAOrienter ? { orientation: 'a_orienter' } : {}),
    }).subscribe({ next: (c) => this.courriers.set(c) });
  }

  // 24/09/2026 — gap signalé par l'utilisateur : la colonne Type affichait
  // le code ENUM brut ("acte_huissier") au lieu d'un libellé français,
  // contrairement à la colonne Sens juste à côté (déjà traduite). Mêmes
  // intitulés que le <select> de création/filtre ci-dessus.
  // 14/10/2026 — libellé libre pour "Autre" (gap signalé par l'utilisateur),
  // même patron que libelleTypeAudience() (Rôle d'audience, même jour).
  libelleType(code: string, precision?: string | null): string {
    if (code === 'autre') return precision || 'Autre';
    return ({
      lettre: 'Lettre', assignation: 'Assignation', requete: 'Requête', convocation: 'Convocation',
      notification: 'Notification',
      acte_huissier: "Acte d'huissier", acte_notaire: 'Acte de notaire',
      decision_justice: 'Décision de justice', conclusions: 'Conclusions',
      courrier_officiel: 'Courrier officiel', administratif: 'Administratif', autre: 'Autre',
    } as Record<string, string>)[code] ?? code;
  }

  libelleDeclenchement(d: any): string {
    if (d.type === 'evenement') return `échéance créée « ${d.titre} » (${new Date(d.date_echeance).toLocaleDateString('fr-FR')})`;
    if (d.type === 'diligence') return `diligence créée « ${d.objet} »`;
    if (d.type === 'tache') return `tâche créée « ${d.titre} »`;
    return '';
  }

  creer(): void {
    this.creation.set(true);
    this.erreur.set('');
    this.dernierDeclenchement.set(null);
    const fichier = this.fichierNouveauCourrier;
    this.api.creerCourrier(this.form).subscribe({
      next: (c) => {
        this.creation.set(false);
        if (c.declenchement) this.dernierDeclenchement.set(c.declenchement);
        this.form = { sens: 'arrivee', type: 'lettre', support: 'papier', date_courrier: new Date().toISOString().slice(0, 10) };
        this.fichierNouveauCourrier = null;
        // Le scan n'est joint qu'une fois le courrier créé (il faut son id) —
        // n'échoue jamais la création elle-même si le téléversement rate.
        if (fichier) {
          this.api.joindreDocumentCourrier(c.id, fichier).subscribe({
            next: () => this.charger(),
            error: (e) => { this.erreur.set(e?.error?.error ?? 'Courrier enregistré, mais le téléversement de la pièce a échoué.'); this.charger(); },
          });
        } else {
          this.charger();
        }
      },
      error: (e) => { this.creation.set(false); this.erreur.set(e?.error?.error ?? 'Enregistrement impossible.'); },
    });
  }

  fichierChoisi(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.fichierNouveauCourrier = input.files?.[0] ?? null;
  }

  // Joindre le scan sur un courrier déjà enregistré (rattaché entre-temps
  // à un dossier, ou simplement pas scanné au moment de la saisie).
  joindrePiece(c: any, event: Event): void {
    const input = event.target as HTMLInputElement;
    const fichier = input.files?.[0];
    if (!fichier) return;
    this.erreur.set('');
    this.api.joindreDocumentCourrier(c.id, fichier).subscribe({
      next: () => this.charger(),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Téléversement impossible.'),
    });
  }

  apercuPiece(c: any): void {
    this.preview.ouvrir(c.reference, this.api.telechargerDocument(c.document_id));
  }

  // 09/10/2026 — gap signalé par l'utilisateur (actions de document
  // manquantes à certains endroits) : seul « Aperçu » existait ici, sans
  // repli si le format n'est pas prévisualisable (le composant d'aperçu
  // affiche alors juste « utilisez Ouvrir/Télécharger », sans que ces
  // actions existent nulle part sur cet écran) ni en cas de fichier perdu
  // du stockage (404, voir storage.js) — même repli que dossier-detail.
  ouvrirPiece(c: any): void {
    this.erreur.set('');
    this.api.telechargerDocument(c.document_id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      error: (e) => this.erreur.set(e?.status === 404 ? 'Fichier introuvable dans le stockage.' : 'Téléchargement impossible'),
    });
  }

  // 14/10/2026 — même patron qu'apercuPiece()/ouvrirPiece() ci-dessus, mais
  // pour la pièce d'un courrier encore sans dossier (fichier_brut_*,
  // voir courriers.js) : migrée automatiquement vers la GED (et donc vers
  // les 2 méthodes ci-dessus) dès qu'un dossier est rattaché.
  apercuPieceBrute(c: any): void {
    this.preview.ouvrir(c.reference, this.api.telechargerFichierBrutCourrier(c.id));
  }

  ouvrirPieceBrute(c: any): void {
    this.erreur.set('');
    this.api.telechargerFichierBrutCourrier(c.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      error: (e) => this.erreur.set(e?.status === 404 ? 'Fichier introuvable dans le stockage.' : 'Téléchargement impossible'),
    });
  }

  changerStatut(c: any, statut: string): void {
    this.api.majStatutCourrier(c.id, { statut }).subscribe({ next: () => this.charger() });
  }

  // 28/09/2026 — audit menu par menu : jusqu'ici seuls le statut et le
  // fichier joint pouvaient évoluer après enregistrement — aucune route ni
  // action pour corriger une faute de frappe (correspondant, objet, type,
  // date) ou l'imputation.
  actionsPour(c: any): ActionMenuItem[] {
    const actions: ActionMenuItem[] = [];
    if (this.auth.peut('courriers.statut.modifier')) {
      actions.push({ label: 'Modifier', action: () => this.commencerEdition(c) });
    }
    // 15/10/2026 — Q1 : réservé à un avocat du dossier (vérifié côté
    // serveur) — n'a de sens que si un dossier est déjà rattaché.
    if (c.sens === 'arrivee' && this.peutOrienterOuImputer(c)) {
      if (c.orientation === 'a_orienter') {
        actions.push({ label: 'Orienter…', action: () => { this.erreur.set(''); this.orientForm = { decision: 'rattache' }; this.imputationId.set(null); this.orientationId.set(c.id); } });
      } else if (c.dossier_id && c.orientation !== 'sans_suite') {
        actions.push({ label: c.imputation_id ? 'Réimputer…' : 'Imputer…', action: () => { this.erreur.set(''); this.imputForm = {}; this.orientationId.set(null); this.imputationId.set(c.id); } });
      }
    }
    if (this.auth.peut('courriers.viser') && c.dossier_id) {
      actions.push({ label: c.vise_le ? 'Re-viser' : 'Viser', action: () => this.viser(c) });
    }
    return actions;
  }

  orienter(c: any): void {
    const d = this.orientForm;
    if (d.decision === 'nouveau') {
      this.router.navigate(['/ouverture'], { queryParams: { courrier: c.id, courrierRef: c.reference } });
      return;
    }
    this.erreur.set('');
    this.orientationEnCours.set(true);
    const payload: any = { decision: d.decision === 'sans_suite' ? 'sans_suite' : d.decision, dossier_id: d.dossier_id || undefined, motif: d.motif || undefined };
    this.api.orienterCourrier(c.id, payload).subscribe({
      next: () => { this.orientationEnCours.set(false); this.orientationId.set(null); this.charger(); },
      error: (e) => { this.orientationEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Orientation impossible.'); },
    });
  }

  imputer(c: any): void {
    this.erreur.set('');
    this.imputationEnCours.set(true);
    this.api.imputerCourrier(c.id, { imputation_id: this.imputForm.imputation_id, instructions: this.imputForm.instructions, echeance: this.imputForm.echeance || undefined }).subscribe({
      next: () => { this.imputationEnCours.set(false); this.imputationId.set(null); this.charger(); },
      error: (e) => { this.imputationEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Imputation impossible.'); },
    });
  }

  viser(c: any): void {
    this.erreur.set('');
    this.dernierVisa.set(null);
    this.api.viserCourrier(c.id).subscribe({
      next: () => { this.dernierVisa.set({ dossierId: c.dossier_id, dossierNumero: c.dossier_numero }); this.charger(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Visa impossible.'),
    });
  }

  commencerEdition(c: any): void {
    this.erreur.set('');
    this.editForm = {
      type: c.type, type_precision: c.type_precision || '', date_courrier: c.date_courrier?.slice(0, 10), correspondant: c.correspondant,
      objet: c.objet, imputation_id: c.imputation_id || '', dossier_id: c.dossier_id || '',
    };
    this.editDossierLabel = c.dossier_id ? (c.dossier_numero || '') : '';
    this.editionId.set(c.id);
  }

  annulerEdition(): void {
    this.editionId.set(null);
    this.editForm = {};
    this.editDossierLabel = '';
  }

  enregistrerEdition(): void {
    const id = this.editionId();
    if (!id || this.editionEnCours()) return;
    this.erreur.set('');
    this.editionEnCours.set(true);
    this.api.majCourrier(id, this.editForm).subscribe({
      next: () => { this.editionEnCours.set(false); this.editionId.set(null); this.editForm = {}; this.charger(); },
      error: (e) => { this.editionEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Modification impossible.'); },
    });
  }
}
