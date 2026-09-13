import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, Dossier } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DocumentPreviewService } from '../../core/document-preview.service';

// Atelier d'actes — réécrit le 13/09/2026 (demande explicite de l'utilisateur,
// suite à une analyse des pratiques du secteur, voir HISTORY.md) :
//  - le texte généré est désormais éditable, avec un cycle brouillon/validé ;
//  - un vrai PDF imprimable (en-tête cabinet) remplace le <pre> figé ;
//  - le catalogue de modèles vient de la base (modeles_actes), plus du code
//    en dur — recherche par mot-clé plutôt qu'un <select> géant, et un
//    panneau de gestion (ajouter/modifier/désactiver) pour qui en a le droit.
@Component({
  selector: 'app-actes',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <header class="page-head">
      <div>
        <h1>Atelier d'actes</h1>
        <p>Génération d'un acte à partir d'un modèle (en-tête cabinet) ou d'un brouillon Assistant IA — toujours à valider par l'avocat.</p>
      </div>
    </header>

    <section class="panel">
      <h3>1. Dossier concerné</h3>
      <input class="in" [(ngModel)]="dossierRecherche" name="dossierRecherche"
             (ngModelChange)="rechercherDossiers()" placeholder="Rechercher un dossier par numéro ou intitulé…" />
      @if (dossierResultats().length) {
        <div class="suggestions">
          @for (d of dossierResultats(); track d.id) {
            <button type="button" class="chip" (click)="choisirDossier(d)">{{ d.numero }} — {{ d.intitule }}</button>
          }
        </div>
      }
      @if (dossierId) { <p class="muted">Sélectionné : {{ dossierLabel }}</p> }
    </section>

    <section class="panel">
      <h3>2. Source du contenu</h3>
      <div class="mode-switch">
        <button type="button" class="mode-btn" [class.active]="mode==='modele'" (click)="mode='modele'">Modèle du cabinet</button>
        <button type="button" class="mode-btn" [class.active]="mode==='ia'" (click)="mode='ia'">Assistant IA <span class="ia-tag">projet à valider</span></button>
      </div>

      @if (mode === 'modele') {
        <label>Modèle — rechercher par nom ou catégorie</label>
        <input class="in" [(ngModel)]="modeleRecherche" name="modeleRecherche" placeholder="Ex. mise en demeure, conclusions, avis…" />
        <div class="modeles-liste">
          @for (m of modelesFiltres(); track m.code) {
            <button type="button" class="modele-item" [class.active]="modeleCode === m.code" (click)="modeleCode = m.code">
              <span class="modele-nom">{{ m.nom }}</span>
              <span class="modele-cat">{{ m.categorie }}</span>
            </button>
          } @empty {
            <p class="muted">Aucun modèle ne correspond.</p>
          }
        </div>
        <p class="muted lien-biblio">
          Besoin d'un modèle-fichier à compléter à la main (trame Word, etc.) ?
          <a routerLink="/biblio" class="lien">Consultez la Bibliothèque</a>.
        </p>
      } @else {
        <label>Instructions pour l'IA</label>
        <textarea class="in ta" [(ngModel)]="instructionsIa" name="instructions"
                  placeholder="Ex. Rédiger une demande de renvoi pour production de pièces…"></textarea>
      }

      @if (auth.peut('actes.generer')) {
        <button class="btn" (click)="generer()" [disabled]="!peutGenerer() || generation()">
          {{ generation() ? 'Génération…' : 'Générer l\\'acte' }}
        </button>
      } @else {
        <p class="err">Vous n'êtes pas autorisé à générer un acte.</p>
      }
      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
    </section>

    @if (resultat(); as r) {
      <section class="panel">
        <h3>Résultat — {{ r.nom }}
          <span class="tag" [class.ok]="r.statut === 'valide'">{{ r.statut === 'valide' ? 'Validé' : 'Brouillon' }}</span>
          <span class="version">v{{ r.version }}</span>
        </h3>
        <p class="muted">Enregistré dans la GED du dossier
          (<a [routerLink]="['/dossiers', dossierId]">voir la fiche dossier</a>).</p>

        <textarea class="in edition" [(ngModel)]="texteEdit" name="texteEdit" rows="18"></textarea>

        <div class="actions-resultat">
          @if (auth.peut('actes.generer')) {
            <button class="btn" (click)="enregistrer()" [disabled]="enregistrement() || texteEdit === r.texte">
              {{ enregistrement() ? 'Enregistrement…' : 'Enregistrer les modifications' }}
            </button>
            @if (r.statut === 'valide') {
              <button class="lien" (click)="changerStatut('brouillon')">Repasser en brouillon</button>
            } @else {
              <button class="lien" (click)="changerStatut('valide')">Valider</button>
            }
          }
          <button class="lien" (click)="apercuPdf()">Aperçu PDF</button>
          <button class="lien" (click)="telechargerPdf()">Télécharger PDF</button>
        </div>
        @if (erreurEdition()) { <p class="err">{{ erreurEdition() }}</p> }
      </section>
    }

    @if (auth.peut('actes.modeles.gerer')) {
      <section class="panel">
        <h3>Gérer les modèles <button class="lien" (click)="afficherGestion.set(!afficherGestion())">{{ afficherGestion() ? 'Masquer' : 'Afficher' }}</button></h3>
        @if (afficherGestion()) {
          <p class="muted">
            Placeholders disponibles dans le corps d'un modèle :
            {{ '{{client}}' }}, {{ '{{partie_adverse}}' }}, {{ '{{destinataire}}' }}, {{ '{{dossier_numero}}' }},
            {{ '{{dossier_intitule}}' }}, {{ '{{dossier_objet_ou_intitule}}' }}, {{ '{{dossier_juridiction}}' }},
            {{ '{{dossier_mode_honoraires}}' }}, {{ '{{date}}' }}, {{ '{{avocat}}' }}, {{ '{{cabinet_raison_sociale}}' }},
            {{ '{{cabinet_forme}}' }}, {{ '{{cabinet_adresse}}' }}, {{ '{{cabinet_telephone}}' }}, {{ '{{cabinet_email}}' }},
            {{ '{{cabinet_rccm}}' }}, {{ '{{cabinet_nif}}' }}, {{ '{{cabinet_compte_carpa}}' }}.
          </p>

          <table>
            <tr><th>Nom</th><th>Catégorie</th><th>Statut</th><th></th></tr>
            @for (m of modelesGestion(); track m.id) {
              <tr>
                <td>{{ m.nom }}</td>
                <td>{{ m.categorie }}</td>
                <td>{{ m.actif ? 'Actif' : 'Désactivé' }}</td>
                <td>
                  <button class="lien" (click)="editerModele(m)">Modifier</button>
                  <button class="lien" (click)="basculerActifModele(m)">{{ m.actif ? 'Désactiver' : 'Réactiver' }}</button>
                </td>
              </tr>
            }
          </table>

          <h4>{{ modeleEditId() ? 'Modifier le modèle' : 'Nouveau modèle' }}</h4>
          @if (!modeleEditId()) {
            <input class="in" [(ngModel)]="modeleForm.code" name="mfCode" placeholder="Code (unique, ex. avis_juridique_fiscal)" />
          }
          <input class="in" [(ngModel)]="modeleForm.nom" name="mfNom" placeholder="Nom affiché" />
          <select class="in" [(ngModel)]="modeleForm.categorie" name="mfCategorie">
            <option value="correspondance">Correspondance</option>
            <option value="conclusions">Conclusions / actes de procédure</option>
            <option value="contrat">Contrat</option>
            <option value="decision">Décision</option>
            <option value="courrier_officiel">Courrier officiel</option>
            <option value="note_interne">Note interne / rapport</option>
            <option value="recherche">Recherche / avis juridique</option>
            <option value="autre">Autre</option>
          </select>
          <textarea class="in ta-modele" [(ngModel)]="modeleForm.corps" name="mfCorps" rows="14"
                    placeholder="Corps du modèle, avec placeholders (voir la liste ci-dessus)"></textarea>
          <div class="actions-resultat">
            <button class="btn" (click)="enregistrerModele()" [disabled]="!modeleForm.nom || !modeleForm.corps || (!modeleEditId() && !modeleForm.code)">
              Enregistrer
            </button>
            @if (modeleEditId()) {
              <button class="lien" (click)="annulerEditionModele()">Annuler</button>
            }
          </div>
          @if (erreurModele()) { <p class="err">{{ erreurModele() }}</p> }
        }
      </section>
    }
  `,
  styles: [`
    .in{display:block;width:100%;max-width:560px;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md);font-family:inherit}
    .ta{min-height:90px;resize:vertical}
    .ta-modele{min-height:220px;resize:vertical;font-family:'Courier New',monospace;font-size:var(--fs-sm);max-width:100%}
    .edition{min-height:360px;resize:vertical;font-family:'Segoe UI',system-ui,sans-serif;font-size:var(--fs-base);max-width:100%;background:#f7f9fc}
    label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .suggestions{display:flex;flex-wrap:wrap;gap:6px;margin:-6px 0 12px}
    .chip{background:#fff;border:1px solid var(--line);border-radius:12px;padding:5px 11px;font-size:var(--fs-sm);cursor:pointer}
    .mode-switch{display:flex;gap:8px;margin-bottom:14px}
    .mode-btn{background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 14px;font-size:var(--fs-base);cursor:pointer;color:var(--slate)}
    .mode-btn.active{background:var(--navy);color:#fff;border-color:var(--navy)}
    .ia-tag{background:#eef;border:1px solid #d5d9f5;color:#43489a;border-radius:12px;padding:1px 7px;font-size:var(--fs-2xs);font-weight:600;margin-left:4px}
    .modeles-liste{display:flex;flex-direction:column;gap:4px;max-height:260px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:6px;margin-bottom:12px;max-width:560px}
    .modele-item{display:flex;justify-content:space-between;align-items:center;background:none;border:none;border-radius:6px;padding:8px 10px;cursor:pointer;text-align:left;width:100%}
    .modele-item:hover{background:var(--light)}
    .modele-item.active{background:var(--navy);color:#fff}
    .modele-nom{font-weight:600;font-size:var(--fs-base)}
    .modele-cat{font-size:var(--fs-xs);color:var(--grey)}
    .modele-item.active .modele-cat{color:#cfd6e3}
    .lien-biblio{margin-top:-6px}
    .tag{background:#fbf1dc;color:#9a6c12;font-size:var(--fs-xs);font-weight:700;padding:2px 8px;border-radius:999px;margin-left:8px}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    .version{color:var(--grey);font-size:var(--fs-sm);margin-left:8px}
    .actions-resultat{display:flex;align-items:center;gap:14px;margin:10px 0;flex-wrap:wrap}
  `],
})
export class ActesComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly preview = inject(DocumentPreviewService);

  readonly modeles = signal<{ code: string; nom: string; categorie: string }[]>([]);
  readonly dossierResultats = signal<Dossier[]>([]);
  readonly resultat = signal<any | null>(null);
  readonly erreur = signal('');
  readonly generation = signal(false);
  readonly enregistrement = signal(false);
  readonly erreurEdition = signal('');

  dossierRecherche = '';
  dossierLabel = '';
  dossierId = '';
  mode: 'modele' | 'ia' = 'modele';
  modeleCode = '';
  modeleRecherche = '';
  instructionsIa = '';
  texteEdit = '';

  ngOnInit(): void {
    this.api.modelesActes().subscribe({ next: (m) => this.modeles.set(m) });
    if (this.auth.peut('actes.modeles.gerer')) this.chargerModelesGestion();
  }

  rechercherDossiers(): void {
    this.dossierId = '';
    if (this.dossierRecherche.length < 2) { this.dossierResultats.set([]); return; }
    this.api.dossiers(this.dossierRecherche).subscribe({ next: (d) => this.dossierResultats.set(d) });
  }

  choisirDossier(d: Dossier): void {
    this.dossierId = d.id;
    this.dossierLabel = `${d.numero} — ${d.intitule}`;
    this.dossierResultats.set([]);
    this.dossierRecherche = '';
  }

  // Recherche par mot-clé plutôt qu'un <select> géant (13/09/2026) — filtre
  // côté client, la liste des modèles reste de taille modeste.
  modelesFiltres(): { code: string; nom: string; categorie: string }[] {
    const q = this.modeleRecherche.trim().toLowerCase();
    if (!q) return this.modeles();
    return this.modeles().filter((m) => m.nom.toLowerCase().includes(q) || m.categorie.toLowerCase().includes(q));
  }

  peutGenerer(): boolean {
    if (!this.dossierId) return false;
    return this.mode === 'modele' ? !!this.modeleCode : !!this.instructionsIa;
  }

  generer(): void {
    this.generation.set(true);
    this.erreur.set('');
    this.resultat.set(null);
    const payload: any = { dossier_id: this.dossierId, mode: this.mode };
    if (this.mode === 'modele') payload.modele_code = this.modeleCode;
    else payload.instructions_ia = this.instructionsIa;

    this.api.genererActe(payload).subscribe({
      next: (r) => { this.generation.set(false); this.resultat.set(r); this.texteEdit = r.texte; },
      error: (e) => { this.generation.set(false); this.erreur.set(e?.error?.error ?? 'Génération impossible.'); },
    });
  }

  enregistrer(): void {
    const r = this.resultat();
    if (!r) return;
    this.erreurEdition.set('');
    this.enregistrement.set(true);
    this.api.modifierActe(r.id, this.texteEdit).subscribe({
      next: (maj) => { this.enregistrement.set(false); this.resultat.set(maj); },
      error: (e) => { this.enregistrement.set(false); this.erreurEdition.set(e?.error?.error ?? 'Enregistrement impossible.'); },
    });
  }

  changerStatut(statut: 'brouillon' | 'valide'): void {
    const r = this.resultat();
    if (!r) return;
    this.erreurEdition.set('');
    this.api.changerStatutActe(r.id, statut).subscribe({
      next: (maj) => this.resultat.update((cur) => cur ? { ...cur, statut: maj.statut } : cur),
      error: (e) => this.erreurEdition.set(e?.error?.error ?? 'Changement de statut impossible.'),
    });
  }

  apercuPdf(): void {
    const r = this.resultat();
    if (!r) return;
    this.preview.ouvrir(`${r.nom}.pdf`, this.api.telechargerActePdf(r.id));
  }

  telechargerPdf(): void {
    const r = this.resultat();
    if (!r) return;
    this.api.telechargerActePdf(r.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      error: () => this.erreurEdition.set('Téléchargement du PDF impossible.'),
    });
  }

  // --- Gestion des modèles (actes.modeles.gerer) ---
  readonly afficherGestion = signal(false);
  readonly modelesGestion = signal<any[]>([]);
  readonly modeleEditId = signal<string | null>(null);
  readonly erreurModele = signal('');
  modeleForm: any = { code: '', nom: '', categorie: 'autre', corps: '' };

  private chargerModelesGestion(): void {
    this.api.modelesActesTous().subscribe({ next: (m) => this.modelesGestion.set(m) });
  }

  editerModele(m: any): void {
    this.modeleEditId.set(m.id);
    this.modeleForm = { nom: m.nom, categorie: m.categorie, corps: m.corps };
    this.erreurModele.set('');
  }

  annulerEditionModele(): void {
    this.modeleEditId.set(null);
    this.modeleForm = { code: '', nom: '', categorie: 'autre', corps: '' };
    this.erreurModele.set('');
  }

  enregistrerModele(): void {
    this.erreurModele.set('');
    const id = this.modeleEditId();
    const suite = id
      ? this.api.modifierModeleActe(id, this.modeleForm)
      : this.api.creerModeleActe(this.modeleForm);
    suite.subscribe({
      next: () => {
        this.annulerEditionModele();
        this.chargerModelesGestion();
        this.api.modelesActes().subscribe({ next: (m) => this.modeles.set(m) });
      },
      error: (e) => this.erreurModele.set(e?.error?.error ?? 'Enregistrement impossible.'),
    });
  }

  basculerActifModele(m: any): void {
    const suite = m.actif
      ? this.api.desactiverModeleActe(m.id)
      : this.api.modifierModeleActe(m.id, { actif: true });
    suite.subscribe({
      next: () => {
        this.chargerModelesGestion();
        this.api.modelesActes().subscribe({ next: (mm) => this.modeles.set(mm) });
      },
      error: (e) => this.erreurModele.set(e?.error?.error ?? 'Action impossible.'),
    });
  }
}
