import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DocumentPreviewService } from '../../core/document-preview.service';
import { MenuActionsComponent, ActionMenuItem } from '../../core/menu-actions.component';
import { DossierPickerComponent } from '../../core/dossier-picker.component';

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
  imports: [FormsModule, RouterLink, MenuActionsComponent, DossierPickerComponent],
  template: `
    <header class="page-head">
      <div>
        <h1>Atelier d'actes</h1>
        <p>Génération d'un acte à partir d'un modèle (en-tête cabinet) ou d'un brouillon Assistant IA — toujours à valider par l'avocat.</p>
      </div>
    </header>

    <section class="panel">
      <h3>1. Dossier concerné</h3>
      <app-dossier-picker [valeur]="dossierId" (valeurChange)="dossierId = $event ?? ''"></app-dossier-picker>
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
            <button type="button" class="modele-item" [class.active]="modeleCode === m.code" (click)="choisirModele(m.code)">
              <span class="modele-nom">{{ m.nom }}</span>
              <span class="modele-cat">{{ m.categorie }}</span>
            </button>
          } @empty {
            <p class="muted">Aucun modèle ne correspond.</p>
          }
        </div>
        @if (champsVisibles().length) {
          <h4 class="sous-titre">Questionnaire</h4>
          @for (c of champsVisibles(); track c.cle) {
            <div class="champ">
              <label>{{ c.libelle }}@if (c.requis) { <span class="req"> *</span> }</label>
              @if (c.aide) { <p class="muted">{{ c.aide }}</p> }
              @switch (c.type) {
                @case ('texte') { <input class="in" [(ngModel)]="reponses[c.cle]" [name]="'q_' + c.cle" [placeholder]="c.defaut_balise ? '(rempli automatiquement si vide)' : ''" /> }
                @case ('texte_long') { <textarea class="in ta" [(ngModel)]="reponses[c.cle]" [name]="'q_' + c.cle"></textarea> }
                @case ('nombre') { <input class="in" inputmode="decimal" [(ngModel)]="reponses[c.cle]" [name]="'q_' + c.cle" /> }
                @case ('date') { <input class="in" type="date" [(ngModel)]="reponses[c.cle]" [name]="'q_' + c.cle" /> }
                @case ('oui_non') {
                  <select class="in" [(ngModel)]="reponses[c.cle]" [name]="'q_' + c.cle">
                    <option value="non">Non</option>
                    <option value="oui">Oui</option>
                  </select>
                }
                @case ('choix') {
                  <select class="in" [(ngModel)]="reponses[c.cle]" [name]="'q_' + c.cle">
                    <option value="">—</option>
                    @for (o of c.options; track o.valeur) { <option [value]="o.valeur">{{ o.libelle }}</option> }
                  </select>
                }
                @case ('juridiction') {
                  <select class="in" [(ngModel)]="reponses[c.cle]" [name]="'q_' + c.cle">
                    <option value="">—</option>
                    @for (j of juridictions(); track j.code) { <option [value]="j.code">{{ j.libelle }}</option> }
                  </select>
                }
                @case ('montant') {
                  <div class="montant">
                    <input class="in" inputmode="decimal" placeholder="Montant" [(ngModel)]="reponses[c.cle].valeur" [name]="'q_' + c.cle + '_v'" />
                    @if (c.devise_fixe) {
                      <span class="muted">{{ c.devise_fixe === 'XOF' ? 'F CFA' : 'Euro' }}</span>
                    } @else {
                      <select class="in" [(ngModel)]="reponses[c.cle].devise" [name]="'q_' + c.cle + '_d'">
                        <option value="XOF">F CFA</option>
                        <option value="EUR">Euro (contre-valeur au taux fixe)</option>
                        <option value="autre">Autre devise</option>
                      </select>
                    }
                    @if (!c.devise_fixe && reponses[c.cle].devise === 'autre') {
                      <input class="in" placeholder="Devise (ex. USD)" [(ngModel)]="reponses[c.cle].devise_libelle" [name]="'q_' + c.cle + '_l'" />
                      <input class="in" inputmode="decimal" placeholder="Contre-valeur en F CFA" [(ngModel)]="reponses[c.cle].contrevaleur" [name]="'q_' + c.cle + '_c'" />
                    }
                  </div>
                }
                @case ('liste') {
                  @for (el of reponses[c.cle]; track $index) {
                    <div class="element-liste">
                      @for (sc of c.sous_champs; track sc.cle) {
                        @switch (sc.type) {
                          @case ('date') { <input class="in" type="date" [title]="sc.libelle" [(ngModel)]="el[sc.cle]" [name]="'q_' + c.cle + $index + sc.cle" /> }
                          @case ('choix') {
                            <select class="in" [title]="sc.libelle" [(ngModel)]="el[sc.cle]" [name]="'q_' + c.cle + $index + sc.cle">
                              <option value="">{{ sc.libelle }}</option>
                              @for (o of sc.options; track o.valeur) { <option [value]="o.valeur">{{ o.libelle }}</option> }
                            </select>
                          }
                          @case ('pieces') { <textarea class="in ta" [placeholder]="sc.libelle" [(ngModel)]="el[sc.cle]" [name]="'q_' + c.cle + $index + sc.cle"></textarea> }
                          @default { <input class="in" [placeholder]="sc.libelle" [(ngModel)]="el[sc.cle]" [name]="'q_' + c.cle + $index + sc.cle" /> }
                        }
                      }
                      <button type="button" class="lien" (click)="retirerElement(c.cle, $index)">Retirer</button>
                    </div>
                  }
                  <button type="button" class="lien" (click)="ajouterElement(c.cle)">+ Ajouter</button>
                }
              }
            </div>
          }
        }
        @if (modeleChoisi()?.courrier_depart) {
          <label class="case"><input type="checkbox" [(ngModel)]="numeroter" name="numeroter" />
            Réserver un numéro de courrier départ au registre du courrier (utilisé comme N/Réf)</label>
        }
        <label>Pièces à citer <span class="muted">(facultatif — une par ligne)</span></label>
        <textarea class="in ta" [(ngModel)]="piecesTexte" name="piecesTexte"
                  placeholder="Ex. Contrat de vente du 29 janvier 2018&#10;Mise en demeure du 10 février 2021"></textarea>
        <p class="muted">Saisies une seule fois, elles alimentent les balises de pièces du modèle (liste « Pièce n° 1 : … » dans l'exposé, bordereau numéroté en fin d'acte).</p>
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
        @if (r.courrier_reference) {
          <p class="muted">Courrier départ enregistré au registre : <b>{{ r.courrier_reference }}</b> (utilisé comme N/Réf).</p>
        }
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
          <button class="lien" (click)="telechargerWord()" [disabled]="texteEdit !== r.texte"
                  [title]="texteEdit !== r.texte ? 'Enregistrez d abord les modifications' : 'Version Word du texte enregistré'">Télécharger Word (.docx)</button>
        </div>
        @if (erreurEdition()) { <p class="err">{{ erreurEdition() }}</p> }
      </section>
    }

    @if (auth.peut('actes.modeles.gerer')) {
      <section class="panel">
        <h3>Gérer les modèles <button class="lien" (click)="afficherGestion.set(!afficherGestion())">{{ afficherGestion() ? 'Masquer' : 'Afficher' }}</button></h3>
        @if (afficherGestion()) {
          <p class="muted">
            Balises disponibles dans le corps d'un modèle (une donnée absente de la fiche apparaît « [à compléter] » dans l'acte) :
          </p>
          @for (g of groupesBalises(); track g.groupe) {
            <p class="muted"><strong>{{ g.groupe }}</strong> :
              @for (b of g.balises; track b.cle) {
                <span [title]="b.description">{{ '{{' + b.cle + '}}' }}{{ $last ? '.' : ', ' }}</span>
              }
            </p>
          }

          <table>
            <tr><th>Nom</th><th>Catégorie</th><th>Statut</th><th>Validation</th><th></th></tr>
            @for (m of modelesGestion(); track m.id) {
              <tr>
                <td>{{ m.nom }}</td>
                <td>{{ m.categorie }}</td>
                <td>{{ m.actif ? 'Actif' : 'Désactivé' }}</td>
                <td>
                  <span class="badge-validation" [class.ok]="m.statut_validation === 'valide'">{{ m.statut_validation === 'valide' ? 'Validé' : 'À valider' }}</span>
                  @if (m.statut_validation === 'valide' && m.valide_par_nom) { <span class="muted"> {{ m.valide_par_nom }}</span> }
                </td>
                <td><app-menu-actions [actions]="actionsPourModele(m)" /></td>
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
          <input class="in" [(ngModel)]="modeleForm.famille" name="mfFamille" placeholder="Famille (ex. Requêtes conjointes)" />
          <label class="case"><input type="checkbox" [(ngModel)]="modeleForm.courrier_depart" name="mfCourrier" />
            Courrier départ : réserver un numéro au registre du courrier (balise n_ref)</label>
          <label>Questionnaire (JSON — liste de champs, voir l'aide de l'administrateur)</label>
          <textarea class="in ta-modele" [(ngModel)]="champsJson" name="mfChamps" rows="8" placeholder='[{"cle":"objet","libelle":"Objet","type":"texte","requis":true}]'></textarea>
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
    .sous-titre{margin:16px 0 6px}
    .champ{margin-bottom:8px}
    .req{color:var(--red,#b3261e)}
    .montant{display:flex;gap:8px;flex-wrap:wrap}
    .montant .in{max-width:240px}
    .element-liste{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;margin-bottom:6px}
    .element-liste .in{max-width:240px;margin:0}
    .case{display:block;margin:10px 0;font-size:var(--fs-base)}
    .badge-validation{font-size:var(--fs-xs);border-radius:10px;padding:2px 8px;background:#fdf0d5;color:#7a5200}
    .badge-validation.ok{background:#e1f3e4;color:#1d6b2f}
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

  readonly modeles = signal<any[]>([]);
  readonly resultat = signal<any | null>(null);
  readonly erreur = signal('');
  readonly generation = signal(false);
  readonly enregistrement = signal(false);
  readonly erreurEdition = signal('');

  dossierId = '';
  mode: 'modele' | 'ia' = 'modele';
  piecesTexte = '';
  reponses: any = {};
  numeroter = true;
  readonly juridictions = signal<{ code: string; libelle: string }[]>([]);
  modeleCode = '';
  modeleRecherche = '';
  instructionsIa = '';
  texteEdit = '';

  ngOnInit(): void {
    this.api.modelesActes().subscribe({ next: (m) => this.modeles.set(m) });
    this.api.listesValeurs('juridiction').subscribe({ next: (j) => this.juridictions.set(j) });
    if (this.auth.peut('actes.modeles.gerer')) {
      this.chargerModelesGestion();
      this.api.balisesActes().subscribe({ next: (b) => this.balises.set(b) });
    }
  }

  // Recherche par mot-clé plutôt qu'un <select> géant (13/09/2026) — filtre
  // côté client, la liste des modèles reste de taille modeste.
  modelesFiltres(): { code: string; nom: string; categorie: string }[] {
    const q = this.modeleRecherche.trim().toLowerCase();
    if (!q) return this.modeles();
    return this.modeles().filter((m) => m.nom.toLowerCase().includes(q) || m.categorie.toLowerCase().includes(q));
  }

  // Questionnaire du modèle choisi (28/10/2026).
  modeleChoisi(): any {
    return this.modeles().find((m) => m.code === this.modeleCode) ?? null;
  }

  choisirModele(code: string): void {
    this.modeleCode = code;
    this.reponses = {};
    for (const c of this.modeleChoisi()?.champs ?? []) {
      if (c.type === 'liste') this.reponses[c.cle] = [];
      else if (c.type === 'montant') this.reponses[c.cle] = { valeur: '', devise: 'XOF' };
      else if (c.defaut !== undefined) this.reponses[c.cle] = c.defaut;
      else if (c.type === 'oui_non') this.reponses[c.cle] = 'non';
    }
  }

  private conditionVraie(si?: string): boolean {
    const m = si ? /^(\w+)\s*(!=|=)\s*(.+)$/.exec(si) : null;
    if (!m) return true;
    const v = String(this.reponses[m[1]] ?? '');
    return m[2] === '=' ? v === m[3].trim() : v !== m[3].trim();
  }

  champsVisibles(): any[] {
    return (this.modeleChoisi()?.champs ?? []).filter((c: any) => c.type !== 'calcul' && this.conditionVraie(c.si));
  }

  ajouterElement(cle: string): void {
    (this.reponses[cle] ||= []).push({});
  }

  retirerElement(cle: string, i: number): void {
    this.reponses[cle].splice(i, 1);
  }

  // Champs requis encore vides (les champs remplis automatiquement par le dossier ne sont pas bloquants).
  private champsManquants(): string[] {
    return this.champsVisibles().filter((c: any) => {
      if (!c.requis) return false;
      const v = this.reponses[c.cle];
      if (c.type === 'liste') return !v?.length;
      if (c.type === 'montant') return !String(v?.valeur ?? '').trim();
      return v === undefined || v === null || String(v).trim() === '';
    }).map((c: any) => c.libelle);
  }

  peutGenerer(): boolean {
    if (!this.dossierId) return false;
    return this.mode === 'modele' ? !!this.modeleCode && this.champsManquants().length === 0 : !!this.instructionsIa;
  }

  generer(): void {
    this.generation.set(true);
    this.erreur.set('');
    this.resultat.set(null);
    const payload: any = { dossier_id: this.dossierId, mode: this.mode };
    if (this.mode === 'modele') {
      payload.modele_code = this.modeleCode;
      const reponses: any = {};
      for (const c of this.champsVisibles()) if (this.reponses[c.cle] !== undefined) reponses[c.cle] = this.reponses[c.cle];
      if (Object.keys(reponses).length) payload.reponses = reponses;
      if (this.modeleChoisi()?.courrier_depart && !this.numeroter) payload.numeroter = false;
      const pieces = this.piecesTexte.split('\n').map((l) => l.trim()).filter(Boolean);
      if (pieces.length) payload.pieces = pieces;
    } else payload.instructions_ia = this.instructionsIa;

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

  telechargerWord(): void {
    const r = this.resultat();
    if (!r) return;
    this.erreurEdition.set('');
    this.api.telechargerActeDocx(r.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const lien = document.createElement('a');
        lien.href = url;
        lien.download = `${r.nom}.docx`;
        lien.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      error: () => this.erreurEdition.set('Téléchargement du fichier Word impossible.'),
    });
  }

  // --- Gestion des modèles (actes.modeles.gerer) ---
  readonly afficherGestion = signal(false);
  readonly balises = signal<{ cle: string; groupe: string; description: string }[]>([]);
  // Balises regroupées par rubrique (Dossier, Client, Partie adverse…), ordre du catalogue.
  readonly groupesBalises = computed(() => {
    const groupes: { groupe: string; balises: { cle: string; description: string }[] }[] = [];
    for (const b of this.balises()) {
      let g = groupes.find((x) => x.groupe === b.groupe);
      if (!g) { g = { groupe: b.groupe, balises: [] }; groupes.push(g); }
      g.balises.push(b);
    }
    return groupes;
  });
  readonly modelesGestion = signal<any[]>([]);
  readonly modeleEditId = signal<string | null>(null);
  readonly erreurModele = signal('');
  modeleForm: any = { code: '', nom: '', categorie: 'autre', corps: '' };
  champsJson = '';

  private chargerModelesGestion(): void {
    this.api.modelesActesTous().subscribe({ next: (m) => this.modelesGestion.set(m) });
  }

  // Menu "⋮" (19/09/2026).
  actionsPourModele(m: any): ActionMenuItem[] {
    return [
      { label: 'Modifier', action: () => this.editerModele(m) },
      ...(m.statut_validation !== 'valide' ? [{ label: 'Valider ce modèle (relu par un avocat)', action: () => this.validerModele(m) }] : []),
      { label: m.actif ? 'Désactiver' : 'Réactiver', action: () => this.basculerActifModele(m), danger: m.actif },
    ];
  }

  editerModele(m: any): void {
    this.modeleEditId.set(m.id);
    this.modeleForm = { nom: m.nom, categorie: m.categorie, corps: m.corps, famille: m.famille ?? '', courrier_depart: !!m.courrier_depart };
    this.champsJson = m.champs?.length ? JSON.stringify(m.champs, null, 2) : '';
    this.erreurModele.set('');
  }

  annulerEditionModele(): void {
    this.modeleEditId.set(null);
    this.modeleForm = { code: '', nom: '', categorie: 'autre', corps: '' };
    this.champsJson = '';
    this.erreurModele.set('');
  }

  enregistrerModele(): void {
    this.erreurModele.set('');
    const id = this.modeleEditId();
    const payload = { ...this.modeleForm };
    if (this.champsJson.trim()) {
      try { payload.champs = JSON.parse(this.champsJson); }
      catch { this.erreurModele.set('Le questionnaire n\'est pas un JSON valide.'); return; }
    } else if (id) payload.champs = [];
    const suite = id
      ? this.api.modifierModeleActe(id, payload)
      : this.api.creerModeleActe(payload);
    suite.subscribe({
      next: () => {
        this.annulerEditionModele();
        this.chargerModelesGestion();
        this.api.modelesActes().subscribe({ next: (m) => this.modeles.set(m) });
      },
      error: (e) => this.erreurModele.set(e?.error?.error ?? 'Enregistrement impossible.'),
    });
  }

  validerModele(m: any): void {
    if (!window.confirm(`Confirmer que le modèle « ${m.nom} » a été relu et validé par un avocat ? Il sera alors proposé à la génération.`)) return;
    this.api.validerModeleActe(m.id).subscribe({
      next: () => {
        this.chargerModelesGestion();
        this.api.modelesActes().subscribe({ next: (mm) => this.modeles.set(mm) });
      },
      error: (e) => this.erreurModele.set(e?.error?.error ?? 'Validation impossible.'),
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
