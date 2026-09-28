import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, Dossier } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DocumentPreviewService } from '../../core/document-preview.service';
import { MenuActionsComponent, ActionMenuItem } from '../../core/menu-actions.component';

@Component({
  selector: 'app-courrier',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, MenuActionsComponent],
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
            <option value="convocation">Convocation</option>
            <option value="acte_huissier">Acte d'huissier</option>
            <option value="acte_notaire">Acte de notaire</option>
            <option value="decision_justice">Décision de justice</option>
            <option value="conclusions">Conclusions</option>
            <option value="courrier_officiel">Courrier officiel</option>
            <option value="administratif">Administratif</option>
            <option value="autre">Autre</option>
          </select>
        </div>
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
          <input class="in" [(ngModel)]="dossierRecherche" name="dossierRecherche"
                 (ngModelChange)="rechercherDossiers()" placeholder="Rechercher un dossier…" />
          @if (dossierResultats().length) {
            <div class="suggestions">
              @for (d of dossierResultats(); track d.id) {
                <button type="button" class="chip" (click)="choisirDossier(d)">{{ d.numero }} — {{ d.intitule }}</button>
              }
            </div>
          }
          @if (form.dossier_id) { <p class="muted">Sélectionné : {{ dossierLabel }} <button class="lien" (click)="viderDossier()">retirer</button></p> }
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
          <label>Scan / pièce jointe (GED)</label>
          <input class="in" type="file" (change)="fichierChoisi($event)" [disabled]="!form.dossier_id" />
          @if (!form.dossier_id) { <p class="muted" style="margin:-6px 0 12px">Sélectionnez d'abord un dossier ci-dessus pour pouvoir y joindre le scan.</p> }
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
          <option value="convocation">Convocation</option>
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
      </div>
      @if (courriers().length) {
        <table>
          <tr><th>Réf.</th><th>Sens</th><th>Type</th><th>Date</th><th>Correspondant</th><th>Objet</th><th>Dossier</th><th>Imputé à</th><th>Pièce</th><th>Statut</th><th></th></tr>
          @for (c of courriers(); track c.id) {
            <tr>
              <td>{{ c.reference }}</td>
              <td><span class="tag" [class.ok]="c.sens === 'arrivee'">{{ c.sens === 'arrivee' ? 'Arrivée' : 'Départ' }}</span></td>
              <td>{{ libelleType(c.type) }}</td>
              <td>{{ c.date_courrier | date:'dd/MM/yyyy' }}</td>
              <td>{{ c.correspondant }}</td>
              <td>{{ c.objet || '—' }}</td>
              <td>@if (c.dossier_id) { <a class="lien" [routerLink]="['/dossiers', c.dossier_id]">{{ c.dossier_numero }}</a> } @else { — }</td>
              <td>{{ c.impute_a || '—' }}</td>
              <td>
                @if (c.document_id) {
                  <button class="lien" (click)="apercuPiece(c)">Aperçu</button>
                } @else if (c.dossier_id && auth.peut('courriers.creer')) {
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
                        <option value="convocation">Convocation</option>
                        <option value="acte_huissier">Acte d'huissier</option>
                        <option value="acte_notaire">Acte de notaire</option>
                        <option value="decision_justice">Décision de justice</option>
                        <option value="conclusions">Conclusions</option>
                        <option value="courrier_officiel">Courrier officiel</option>
                        <option value="administratif">Administratif</option>
                        <option value="autre">Autre</option>
                      </select>
                    </div>
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
                  </div>
                  <p class="hint">La référence n'est pas modifiable — le dossier rattaché se corrige depuis la fiche du courrier concerné.</p>
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
    .suggestions{display:flex;flex-wrap:wrap;gap:6px;margin:-6px 0 12px}
    .chip{background:#fff;border:1px solid var(--line);border-radius:12px;padding:5px 11px;font-size:var(--fs-sm);cursor:pointer}
    .ok-msg{color:var(--green);font-size:var(--fs-base);margin-top:10px}
    .filtres{display:flex;gap:10px;margin-bottom:14px}
    .filtre{width:auto;margin:0;max-width:180px}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    .statut-select{border:1px solid var(--line);border-radius:6px;padding:4px 8px;font-size:var(--fs-sm)}
    .bandeau-filtre{background:var(--light);border-radius:8px;padding:9px 14px;font-size:var(--fs-base);color:var(--slate);margin-bottom:14px}
    .edition td{background:var(--light);padding:12px 14px}
    .hint{display:block;font-size:var(--fs-sm);color:var(--grey);margin:0 0 10px}
    .mini-file{max-width:110px;font-size:var(--fs-xs)}
  `],
})
export class CourrierComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly preview = inject(DocumentPreviewService);
  readonly courriers = signal<any[]>([]);
  readonly dossierResultats = signal<Dossier[]>([]);
  readonly dernierDeclenchement = signal<any | null>(null);
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
  dossierRecherche = '';
  dossierLabel = '';
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
    this.api.courriers({ sens: this.filtreSens, type: this.filtreType, q: this.recherche, ...(dossierId ? { dossier_id: dossierId } : {}) }).subscribe({ next: (c) => this.courriers.set(c) });
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

  viderDossier(): void {
    this.form.dossier_id = null;
    this.dossierLabel = '';
  }

  // 24/09/2026 — gap signalé par l'utilisateur : la colonne Type affichait
  // le code ENUM brut ("acte_huissier") au lieu d'un libellé français,
  // contrairement à la colonne Sens juste à côté (déjà traduite). Mêmes
  // intitulés que le <select> de création/filtre ci-dessus.
  libelleType(code: string): string {
    return ({
      lettre: 'Lettre', assignation: 'Assignation', convocation: 'Convocation',
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
        this.dossierLabel = '';
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

  changerStatut(c: any, statut: string): void {
    this.api.majStatutCourrier(c.id, { statut }).subscribe({ next: () => this.charger() });
  }

  // 28/09/2026 — audit menu par menu : jusqu'ici seuls le statut et le
  // fichier joint pouvaient évoluer après enregistrement — aucune route ni
  // action pour corriger une faute de frappe (correspondant, objet, type,
  // date) ou l'imputation.
  actionsPour(c: any): ActionMenuItem[] {
    if (!this.auth.peut('courriers.statut.modifier')) return [];
    return [{ label: 'Modifier', action: () => this.commencerEdition(c) }];
  }

  commencerEdition(c: any): void {
    this.erreur.set('');
    this.editForm = {
      type: c.type, date_courrier: c.date_courrier?.slice(0, 10), correspondant: c.correspondant,
      objet: c.objet, imputation_id: c.imputation_id || '',
    };
    this.editionId.set(c.id);
  }

  annulerEdition(): void {
    this.editionId.set(null);
    this.editForm = {};
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
