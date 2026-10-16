import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
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
          <!-- 28/09/2026 — audit menu par menu : imputation_id déjà géré
               côté serveur (POST l'accepte, PUT /:id/statut aussi) mais
               jamais exposé à l'écran — impossible jusqu'ici de dire
               concrètement à qui un courrier est imputé. -->
          <label>Imputer à (optionnel)</label>
          <select class="in" [(ngModel)]="form.imputation_id" name="imputation">
            <option value="">—</option>
            @for (m of membres(); track m.id) { <option [value]="m.id">{{ m.prenom }} {{ m.nom }}</option> }
          </select>
        </div>
        <div class="col2">
          <label>Scan / pièce jointe</label>
          <input class="in" type="file" (change)="fichierChoisi($event)" />
          <!-- 14/10/2026 — gap signalé par l'utilisateur : un courrier (ex.
               demande initiale) précède souvent l'ouverture du dossier ;
               le scan n'a plus besoin d'attendre un dossier pour être
               conservé, voir courriers.js. -->
          @if (!form.dossier_id) { <p class="muted" style="margin:-6px 0 12px">Sans dossier, le scan est conservé directement sur le courrier — il rejoint automatiquement la GED dès qu'un dossier lui sera rattaché.</p> }
        </div>
      </div>
      <button class="btn" (click)="creer()" [disabled]="!form.correspondant || creation()">
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
      </div>
      <!-- 15/10/2026 — Q5 : le visa ne calcule jamais le vrai délai légal
           (dépend du degré/juridiction, seul l'avocat peut le déterminer) —
           simple raccourci vers Échéances pour le saisir soi-même. -->
      @if (dernierVisa(); as v) {
        <p class="ok-msg">✓ Courrier visé — <a class="lien" [routerLink]="['/echeancier']" [queryParams]="{ dossier: v.dossierId, dossierLabel: v.dossierNumero }">ajouter l'échéance procédurale réelle sur {{ v.dossierNumero }} →</a></p>
      }
      @if (courriers().length) {
        <table>
          <tr><th>Réf.</th><th>Sens</th><th>Type</th><th>Date</th><th>Correspondant</th><th>Objet</th><th>Dossier</th><th>Imputé à</th><th>Pièce</th><th>Statut</th><th></th></tr>
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
                {{ c.impute_a || '—' }}
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
                    <div>
                      <label>Imputer à</label>
                      <select class="in" [(ngModel)]="editForm.imputation_id" name="edImputation">
                        <option value="">—</option>
                        @for (m of membres(); track m.id) { <option [value]="m.id">{{ m.prenom }} {{ m.nom }}</option> }
                      </select>
                    </div>
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
  readonly editionId = signal<string | null>(null);
  readonly editionEnCours = signal(false);
  editForm: any = {};

  // Navigation inter-modules (06/09/2026) — voir facturation.component.ts.
  readonly filtreDossierId = signal<string | null>(null);
  readonly filtreDossierNumero = signal<string | null>(null);

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
    this.charger();
    this.api.utilisateurs().subscribe({ next: (u) => this.membres.set(u), error: () => {} });
  }

  charger(): void {
    const dossierId = this.filtreDossierId();
    this.api.courriers({
      sens: this.filtreSens, type: this.filtreType, q: this.recherche,
      ...(dossierId ? { dossier_id: dossierId } : {}),
      ...(this.filtreNumerisation ? { en_attente_numerisation: 'true' } : {}),
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
    if (this.auth.peut('courriers.viser') && c.dossier_id) {
      actions.push({ label: c.vise_le ? 'Re-viser' : 'Viser', action: () => this.viser(c) });
    }
    return actions;
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
