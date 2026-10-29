import { Component, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, MoyenPaiement } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MenuActionsComponent, ActionMenuItem } from '../../core/menu-actions.component';
import { DossierPickerComponent } from '../../core/dossier-picker.component';
import { CATEGORIES_CABINET, CATEGORIES_DEBOURS, estDebours } from '../../core/categories-depense';
import { ReglementFormComponent } from '../../core/reglement-form.component';
import { DocumentPreviewService } from '../../core/document-preview.service';

// État mensuel des charges (24/10/2026). Fonctionnement du cabinet : l'admin
// générale / le comptable prépare l'état (catalogue + reports + ponctuelles),
// le soumet aux associés, qui approuvent, rejettent ou REPORTENT chaque ligne
// et orientent le moyen de paiement ; l'approbation crée une dépense validée
// (décaissement dans « Dépenses & caisse »). Les salaires restent dans le module RH.
// Pas de zone.js : tout changement passe par un signal ; les formulaires sont
// des objets simples relus à l'envoi, puis l'écran est rechargé.
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

@Component({
  selector: 'app-etat-charges',
  standalone: true,
  imports: [DecimalPipe, NgTemplateOutlet, FormsModule, MenuActionsComponent, RouterLink, ReglementFormComponent, DossierPickerComponent],
  template: `
    <header class="page-head">
      <div>
        <h1>États mensuels des charges</h1>
        <p>Préparé par l’administration, décidé par les associés : approuver, rejeter ou reporter chaque charge. <a class="lien" routerLink="/depenses">← Dépenses &amp; caisse</a></p>
      </div>
      @if (auth.peut('depenses.creer')) {
        <div class="creation">
          <select class="sel" [ngModel]="moisChoisi()" (ngModelChange)="moisChoisi.set(+$event)" name="moisNouveau">
            @for (n of mois12; track n) { <option [ngValue]="n">{{ moisNom(n) }}</option> }
          </select>
          <select class="sel" [ngModel]="anneeChoisie()" (ngModelChange)="anneeChoisie.set(+$event)" name="anneeNouveau">
            @for (a of annees; track a) { <option [ngValue]="a">{{ a }}</option> }
          </select>
          <button class="btn" (click)="creerEtat()" [disabled]="enCours()">+ Nouvel état</button>
        </div>
      }
    </header>
    @if (erreur()) { <p class="err">{{ erreur() }}</p> }

    <nav class="onglets">
      <button class="onglet" [class.actif]="onglet() === 'etats'" (click)="onglet.set('etats')">États mensuels <span class="nb">{{ etats().length }}</span></button>
      <button class="onglet" [class.actif]="onglet() === 'catalogue'" (click)="onglet.set('catalogue')">Charges habituelles <span class="nb">{{ modeles().length }}</span></button>
    </nav>

    @if (onglet() === 'etats') {
    <section class="panel">
      <h3>États</h3>
      @if (!etats().length) { <p class="hint">Aucun état pour le moment. Choisissez un mois puis « Nouvel état » : il se remplit avec vos charges habituelles et les charges reportées.</p> }
      @else {
        <table>
          <tr><th>Mois</th><th>Statut</th><th>Charges</th><th class="num">Total (FCFA)</th><th>À décider</th><th>Reportées</th><th>En retard</th><th></th></tr>
          @for (e of etats(); track e.id) {
            <tr [class.sel]="detail()?.id === e.id">
              <td><b>{{ libelleMois(e.mois) }}</b></td>
              <td>{{ libelleStatut(e.statut) }}</td>
              <td>{{ e.nb_lignes }}</td>
              <td class="num">{{ e.total | number }}</td>
              <td>{{ e.nb_a_decider }}</td>
              <td>{{ e.nb_reportees }}</td>
              <td>@if (e.nb_en_retard) { <span class="retard">{{ e.nb_en_retard }}</span> }</td>
              <td class="actions"><button class="lien" (click)="ouvrir(e.id, true)">{{ detail()?.id === e.id ? 'Affiché' : 'Ouvrir' }}</button></td>
            </tr>
          }
        </table>
      }
    </section>

    @if (detail(); as d) {
      <section class="panel" id="detail-etat">
        <h3>{{ libelleMois(d.mois) }} — {{ libelleStatut(d.statut) }}
          <button class="lien" style="margin-left:12px" (click)="detailReplie.set(!detailReplie())">{{ detailReplie() ? '▸ Déplier' : '▾ Replier' }}</button>
        </h3>
        @if (detailReplie()) {
          <p class="hint">{{ d.lignes.length }} ligne(s) · total hors rejetées : {{ d.totaux.total | number }} FCFA · {{ d.totaux.a_decider | number }} FCFA à décider@if (d.en_retard) { · ⚠ {{ d.en_retard }} en retard }</p>
        } @else {
        @if (d.en_retard) {
          <p class="alerte">⚠ {{ d.en_retard }} charge(s) reportée(s) depuis {{ seuil }} mois ou plus : à traiter en priorité.</p>
        }
        <div class="kpis">
          <div class="kpi"><div class="n">{{ d.totaux.total | number }}</div><div class="l">Total hors rejetées (FCFA)</div></div>
          <div class="kpi green"><div class="n">{{ d.totaux.approuve | number }}</div><div class="l">Approuvé (FCFA)</div></div>
          <div class="kpi amber"><div class="n">{{ d.totaux.reporte | number }}</div><div class="l">Reporté (FCFA)</div></div>
          <div class="kpi red"><div class="n">{{ d.totaux.rejete | number }}</div><div class="l">Rejeté (FCFA)</div></div>
          <div class="kpi"><div class="n">{{ d.totaux.a_decider | number }}</div><div class="l">À décider (FCFA)</div></div>
        </div>

        @if (messageCompletion()) { <p class="hint">{{ messageCompletion() }}</p> }
        <div class="barre">
          <button class="btn ghost sm" (click)="apercu(d)">👁 Aperçu / PDF</button>
          @if (d.statut === 'en_preparation' && auth.peut('depenses.creer')) {
            <button class="btn ghost sm" (click)="completer(d.id)" [disabled]="enCours()" title="Ajoute à cet état les charges habituelles du catalogue dues ce mois-ci et qui n’y figurent pas encore">+ Charges habituelles manquantes</button>
            <button class="btn sm" (click)="action(d.id, 'soumettre')" [disabled]="enCours() || !d.lignes.length">Soumettre aux associés</button>
          }
          @if (d.statut === 'soumis' && auth.peut('depenses.creer') && !decisionsPrises(d)) {
            <button class="btn ghost sm" (click)="action(d.id, 'rouvrir')" [disabled]="enCours()">Rouvrir pour modifier</button>
          }
          @if (d.statut === 'soumis' && auth.peut('depenses.decision') && aApprouver(d).length) {
            <button class="btn ghost sm" (click)="groupeOuvert.set(!groupeOuvert())" title="Raccourci facultatif : les lignes peuvent toujours être décidées une à une">Approuver toutes les lignes en attente…</button>
          }
          @if (d.statut === 'soumis' && auth.peut('depenses.decision')) {
            <button class="btn sm" (click)="action(d.id, 'cloturer')" [disabled]="enCours() || aDecider(d)">Clôturer l’état</button>
          }
        </div>

        @if (groupeOuvert() && d.statut === 'soumis') {
          <div class="groupe">
            <b>Approuver {{ aApprouver(d).length }} ligne(s) en attente — {{ totalAApprouver(d) | number }} FCFA</b>
            <p class="hint">Les lignes déjà rejetées, reportées ou approuvées ne sont pas touchées ; celles à montant nul restent à traiter à la main. Une ligne qui a déjà un moyen de paiement le garde ; le moyen ci-dessous ne sert qu’aux autres (il pourra être précisé ou corrigé au décaissement).</p>
            <div class="reglement-bloc">
              <app-reglement-form sens="decaissement" cleMode="mode_paiement" [exigerReferences]="false" [exigerMoyen]="false"
                                  [modele]="groupe" [catalogue]="catalogue()"></app-reglement-form>
            </div>
            <div class="btns">
              <button class="btn sm" (click)="approuverTout(d)" [disabled]="enCours()">Confirmer l’approbation</button>
              <button class="lien" (click)="groupeOuvert.set(false)">Annuler</button>
            </div>
          </div>
        }

        <table>
          <tr><th>Charge</th><th>Période couverte</th><th class="num">Montant (FCFA)</th>@if (afficherMoyen(d)) { <th>Moyen / compte</th> }<th>Décision</th><th></th></tr>
          @for (g of groupes(d); track g.cle) {
          <tr class="groupe-titre"><td [attr.colspan]="nbColonnes(d)"><b>{{ g.titre }}</b> · {{ g.lignes.length }} ligne(s) · {{ g.total | number }} FCFA</td></tr>
          @for (l of g.lignes; track l.id) {
            <tr [class.retard-ligne]="l.retard_mois >= seuil && l.decision === 'en_attente'">
              <td>
                <b>{{ l.libelle }}</b>
                @if (l.categorie === 'autre' && l.precision_autre) { <span class="tag">Autre : {{ l.precision_autre }}</span> }
                @if (l.type !== 'fixe') { <span class="tag">ponctuelle</span> }
                @if (estArriere(l, d.mois)) { <span class="tag report">arriéré depuis {{ libelleMois(l.periode_debut.slice(0, 7)) }}</span> }
                @if (l.nb_pieces) { <span class="tag">📎 {{ l.nb_pieces }}</span> }
                @if (l.nature === 'dossier') { <span class="tag">Dossier {{ l.dossier_numero }}@if (l.refacturable_client) { · refacturable }</span> }
                @if (l.beneficiaire) { <div class="obs">Bénéficiaire : {{ l.beneficiaire }}</div> }
                @if (l.report_de) { <span class="tag report">reportée · retard {{ l.retard_mois }} mois</span> }
                @if (l.observation) { <div class="obs">{{ l.observation }}</div> }
              </td>
              <td>{{ periode(l) }}</td>
              <td class="num">{{ l.montant | number }}@if (l.montant_precedent !== null && l.montant_precedent !== undefined) { <div class="obs">mois préc. : {{ l.montant_precedent | number }}{{ ecart(l) }}</div> }</td>
              @if (afficherMoyen(d)) { <td>{{ moyen(l) }}</td> }
              <td>
                @switch (l.decision) {
                  @case ('approuvee') {
                    <span class="ok">Approuvée</span>
                    @if (l.depense_statut === 'validee') { <div class="obs"><a class="lien" routerLink="/depenses" [queryParams]="{ statut: 'validee' }">À décaisser →</a></div> }
                    @else if (l.depense_statut) { <div class="obs">dépense {{ libelleDepense(l.depense_statut) }}</div> }
                  }
                  @case ('rejetee') { <span class="ko">Rejetée</span><div class="obs">{{ l.motif }}</div> }
                  @case ('reportee') { <span class="rep">Reportée</span>@if (l.motif) { <div class="obs">{{ l.motif }}</div> } }
                  @default { }
                }
              </td>
              <td class="actions">
                @if (d.statut === 'soumis' && l.decision === 'en_attente' && auth.peut('depenses.decision')) {
                  <button class="btn ghost sm" (click)="editer(l)">Décider…</button>
                }
                @if (actionsPourLigne(d, l).length) { <app-menu-actions [actions]="actionsPourLigne(d, l)" /> }
              </td>
            </tr>
            @if (piecesLigneId() === l.id) {
              <tr class="edit" [id]="'pieces-ligne-' + l.id">
                <td [attr.colspan]="nbColonnes(d)">
                  <b>Justificatifs de la charge</b> — devis, facture, preuve de paiement. Ils suivent la dépense à l’approbation.
                  @if (listePieces().length) {
                    <table>
                      <tr><th>Type</th><th>Fichier</th><th>Ajouté par</th><th></th></tr>
                      @for (p of listePieces(); track p.id) {
                        <tr>
                          <td>{{ libellePiece(p.type) }}</td><td>{{ p.nom }}</td><td>{{ p.ajoute_par || '—' }}</td>
                          <td class="actions">
                            <button class="lien" (click)="apercuPiece(d, l, p)">Aperçu</button>
                            @if (peutAjouterPiece(d, l)) { <button class="lien" (click)="retirerPiece(d, l, p)">Retirer</button> }
                          </td>
                        </tr>
                      }
                    </table>
                  } @else { <p class="muted">Aucun justificatif.</p> }
                  @if (peutAjouterPiece(d, l)) {
                    <div class="champs">
                      <div><label>Type de pièce</label>
                        <select class="in" [(ngModel)]="pieceType" name="pieceType">
                          <option value="devis">Devis</option><option value="facture">Facture</option>
                          <option value="preuve_paiement">Preuve de paiement</option><option value="autre">Autre</option>
                        </select></div>
                      <div class="large"><label>Fichier (PDF, image, Word, Excel)</label><input class="in" type="file" (change)="choisirPiece($event)" /></div>
                    </div>
                    <div class="btns">
                      <button class="btn sm" (click)="ajouterPiece(d, l)" [disabled]="!pieceFichier || pieceEnCours()">{{ pieceEnCours() ? 'Envoi…' : 'Ajouter le justificatif' }}</button>
                      <button class="lien" (click)="piecesLigneId.set(null)">Fermer</button>
                    </div>
                  } @else {
                    @if (l.decision !== 'en_attente') { <p class="hint">Charge déjà décidée : les justificatifs s’ajoutent désormais sur la dépense (Dépenses &amp; caisse › Pièces / devis).</p> }
                    <button class="lien" (click)="piecesLigneId.set(null)">Fermer</button>
                  }
                </td>
              </tr>
            }
            @if (edition()?.id === l.id) {
              <tr class="edit" [id]="'edit-ligne-' + l.id">
                <td [attr.colspan]="nbColonnes(d)">
                  @if (d.statut === 'en_preparation') {
                    <div class="champs">
                      <div class="large"><label>Libellé</label><input class="in" maxlength="240" [(ngModel)]="form.libelle" name="el" /></div>
                      <div><label>Catégorie</label>
                        <select class="in" [(ngModel)]="form.categorie" name="ec"><optgroup label="Charges du cabinet">@for (c of categoriesCabinet; track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }</optgroup><optgroup label="Débours et frais de procédure">@for (c of categoriesDebours; track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }</optgroup></select></div>
                      @if (form.categorie === 'autre') {
                        <div class="large"><label>Précisez « Autre » *</label><input class="in" maxlength="120" [(ngModel)]="form.precision_autre" name="ep" placeholder="Nature de la charge" /></div>
                      }
                      <div><label>Rattachement</label>
                        <select class="in" [(ngModel)]="form.nature" name="en"><option value="cabinet">Charge du cabinet</option><option value="dossier">Liée à un dossier (débours)</option></select></div>
                      @if (form.nature === 'dossier') {
                        <div class="large"><label>Dossier *</label>
                          <app-dossier-picker [valeur]="form.dossier_id" [nomInitial]="form.dossier_numero" (valeurChange)="form.dossier_id = $event"></app-dossier-picker></div>
                        <div class="large cases"><label><input type="checkbox" [(ngModel)]="form.refacturable_client" name="er" /> Débours refacturable au client</label></div>
                      } @else if (estDebours(form.categorie)) {
                        <p class="hint large">Cette catégorie concerne en général un dossier : choisissez « Liée à un dossier » pour la rattacher et la refacturer.</p>
                      }
                      <div class="large"><label>Bénéficiaire (facultatif)</label><input class="in" maxlength="160" [(ngModel)]="form.beneficiaire" name="eb" placeholder="Fournisseur ou personne payée" /></div>
                      <div><label>Type</label>
                        <select class="in" [(ngModel)]="form.type" name="et"><option value="fixe">Fixe</option><option value="ponctuelle">Ponctuelle</option></select></div>
                      <div class="etroit"><label>Arriéré (mois impayés avant ce mois)</label>
                        <input class="in" type="number" min="0" max="36" [ngModel]="form.arriere" (ngModelChange)="appliquerArriere(form, $event, d.mois)" name="ear" /></div>
                      <div><label>Période — début</label><input class="in" type="date" [(ngModel)]="form.periode_debut" name="ed" /></div>
                      <div><label>Période — fin</label><input class="in" type="date" [(ngModel)]="form.periode_fin" name="ef" /></div>
                      <div class="large"><label>Observation (ex. 3 mois d’arriéré)</label><input class="in" [(ngModel)]="form.observation" name="eo" /></div>
                    </div>
                  }
                  <div class="champs">
                    <div class="etroit"><label>Montant (FCFA)</label><input class="in" type="number" min="0" [(ngModel)]="form.montant" name="em" /></div>
                    @if (d.statut === 'soumis') {
                      <div class="large"><label>Motif (obligatoire pour rejeter)</label><input class="in" [(ngModel)]="form.motif" name="emo" /></div>
                    }
                  </div>
                  @if (d.statut === 'soumis' || peutOrienter) {
                    <div class="reglement-bloc">
                      <app-reglement-form sens="decaissement" cleMode="mode_paiement" [exigerReferences]="false" [exigerMoyen]="false"
                                          [modele]="form" [catalogue]="catalogue()"></app-reglement-form>
                    </div>
                  }
                  @if (d.statut === 'soumis') {
                    <div class="btns">
                      <button class="btn sm" (click)="decider(d.id, l.id, 'approuvee')" [disabled]="enCours()">Approuver</button>
                      <button class="btn ghost sm" (click)="decider(d.id, l.id, 'reportee')" [disabled]="enCours()">Reporter au mois suivant</button>
                      <button class="btn ghost danger sm" (click)="decider(d.id, l.id, 'rejetee')" [disabled]="enCours() || !form.motif">Rejeter</button>
                      <button class="lien" (click)="edition.set(null)">Annuler</button>
                    </div>
                  } @else {
                    <div class="btns">
                      <button class="btn sm" (click)="enregistrerLigne(d.id, l.id)" [disabled]="enCours() || !form.libelle || (form.categorie === 'autre' && !form.precision_autre?.trim()) || (form.nature === 'dossier' && !form.dossier_id)">Enregistrer</button>
                      <button class="lien" (click)="edition.set(null)">Annuler</button>
                    </div>
                  }
                </td>
              </tr>
            }
          }
          }
        </table>

        @if (d.statut === 'en_preparation' && auth.peut('depenses.creer')) {
          <h4 class="sous-titre">Ajouter une charge ponctuelle</h4>
          <div class="champs">
            <div class="large"><label>Libellé</label><input class="in" maxlength="240" [(ngModel)]="ajout.libelle" name="al" /></div>
            <div><label>Catégorie</label>
              <select class="in" [(ngModel)]="ajout.categorie" name="ac"><optgroup label="Charges du cabinet">@for (c of categoriesCabinet; track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }</optgroup><optgroup label="Débours et frais de procédure">@for (c of categoriesDebours; track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }</optgroup></select></div>
            @if (ajout.categorie === 'autre') {
              <div class="large"><label>Précisez « Autre » *</label><input class="in" maxlength="120" [(ngModel)]="ajout.precision_autre" name="ap" placeholder="Nature de la charge" /></div>
            }
            <div><label>Rattachement</label>
              <select class="in" [(ngModel)]="ajout.nature" name="an"><option value="cabinet">Charge du cabinet</option><option value="dossier">Liée à un dossier (débours)</option></select></div>
            @if (ajout.nature === 'dossier') {
              <div class="large"><label>Dossier *</label>
                <app-dossier-picker [valeur]="ajout.dossier_id" (valeurChange)="ajout.dossier_id = $event"></app-dossier-picker></div>
              <div class="large cases"><label><input type="checkbox" [(ngModel)]="ajout.refacturable_client" name="ar" /> Débours refacturable au client</label></div>
            } @else if (estDebours(ajout.categorie)) {
              <p class="hint large">Cette catégorie concerne en général un dossier : choisissez « Liée à un dossier » pour la rattacher et la refacturer.</p>
            }
            <div class="large"><label>Bénéficiaire (facultatif)</label><input class="in" maxlength="160" [(ngModel)]="ajout.beneficiaire" name="ab" placeholder="Fournisseur ou personne payée" /></div>
            <div><label>Montant (FCFA)</label><input class="in" type="number" min="0" [(ngModel)]="ajout.montant" name="am" /></div>
            <div class="etroit"><label>Arriéré (mois impayés avant ce mois)</label>
              <input class="in" type="number" min="0" max="36" [ngModel]="ajout.arriere" (ngModelChange)="appliquerArriere(ajout, $event, d.mois)" name="aar" /></div>
            @if (ajout.arriere > 0) { <p class="hint large">Période couverte : {{ libelleMois(ajout.periode_debut.slice(0, 7)) }} → {{ libelleMois(ajout.periode_fin.slice(0, 7)) }}. Le montant est le total dû sur cette période.</p> }
            <div class="large"><label>Observation</label><input class="in" [(ngModel)]="ajout.observation" name="ao" /></div>
          </div>
          @if (peutOrienter) {
            <div class="reglement-bloc">
              <app-reglement-form sens="decaissement" cleMode="mode_paiement" [exigerReferences]="false" [exigerMoyen]="false"
                                  [modele]="ajout" [catalogue]="catalogue()"></app-reglement-form>
            </div>
          } @else {
            <p class="hint">Le moyen de paiement et le compte sont orientés par les associés. Les justificatifs s’ajoutent ensuite avec « 📎 Pièces ».</p>
          }
          <button class="btn" (click)="ajouterLigne(d.id)" [disabled]="enCours() || !ajout.libelle || (ajout.categorie === 'autre' && !ajout.precision_autre?.trim()) || (ajout.nature === 'dossier' && !ajout.dossier_id)">Ajouter à l’état</button>
        }
        @if (d.statut === 'clos') { <p class="hint">État clos. Les charges approuvées sont à décaisser dans « Dépenses &amp; caisse » ; les charges reportées reviennent dans l’état du mois suivant.</p> }
      }
      </section>
    }
    }

    @if (onglet() === 'catalogue') {
    <section class="panel">
      <h3>Charges habituelles
        @if (auth.peut('depenses.creer') && !modeleEnEdition()) {
          <button class="btn sm" style="margin-left:12px" (click)="ouvrirAjoutModele()">+ Ajouter une charge habituelle</button>
        }
      </h3>
      <p class="intro">Ce catalogue sert uniquement à pré-remplir chaque nouvel état (pour un état déjà créé, utilisez « + Charges habituelles manquantes ») : il ne déclenche jamais de paiement. Les salaires restent dans le module RH.</p>

      <ng-template #formModele>
          <div class="champs">
            <div class="large"><label>Libellé</label><input class="in" maxlength="240" [(ngModel)]="modele.libelle" name="ml" /></div>
            <div><label>Catégorie</label>
              <select class="in" [(ngModel)]="modele.categorie" name="mc"><optgroup label="Charges du cabinet">@for (c of categoriesCabinet; track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }</optgroup><optgroup label="Débours et frais de procédure">@for (c of categoriesDebours; track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }</optgroup></select></div>
            @if (modele.categorie === 'autre') {
              <div class="large"><label>Précisez « Autre » *</label><input class="in" maxlength="120" [(ngModel)]="modele.precision_autre" name="mpa" placeholder="Nature de la charge" /></div>
            }
            <div><label>Type</label>
              <select class="in" [(ngModel)]="modele.type" name="mt"><option value="fixe">Fixe</option><option value="ponctuelle">Ponctuelle récurrente</option></select></div>
            <div><label>Montant habituel (FCFA)</label><input class="in" type="number" min="0" [(ngModel)]="modele.montant_habituel" name="mm" /></div>
            <div><label>Périodicité</label>
              <select class="in" [(ngModel)]="modele.periodicite" name="mp">
                <option value="mensuelle">Mensuelle</option><option value="trimestrielle">Trimestrielle</option><option value="annuelle">Annuelle</option>
              </select></div>
            @if (modele.periodicite !== 'mensuelle') {
              <div><label>{{ modele.periodicite === 'annuelle' ? 'Mois d’échéance' : '1er mois du cycle' }}</label>
                <select class="in" [(ngModel)]="modele.mois_echeance" name="me">@for (n of mois12; track n) { <option [ngValue]="n">{{ moisNom(n) }}</option> }</select></div>
            }
            @if (modele.periodicite === 'mensuelle') {
              <div class="etroit"><label>Arriéré à régler (mois)</label>
                <input class="in" type="number" min="0" max="36" [(ngModel)]="modele.arriere_mois" name="mar" /></div>
              @if (modele.arriere_mois > 0) {
                <p class="hint large">À usage unique : au prochain état (ou en le complétant), cette charge sera reprise sur {{ modele.arriere_mois + 1 }} mois, pour {{ (modele.montant_habituel || 0) * (modele.arriere_mois + 1) | number }} FCFA (modifiable dans l’état). Le compteur repassera ensuite à zéro.</p>
              }
            }
            <div class="large"><label>Bénéficiaire habituel (facultatif)</label><input class="in" maxlength="160" [(ngModel)]="modele.beneficiaire" name="mb" placeholder="Fournisseur ou personne payée" /></div>
            <div class="large cases"><label><input type="checkbox" [(ngModel)]="modele.montant_variable" name="mv" /> Le montant change d’un mois à l’autre</label></div>
          </div>
          @if (peutOrienter) {
            <div class="reglement-bloc">
              <p class="hint">Moyen de paiement et compte habituels : proposés dès la création de chaque état, que les associés peuvent changer à la décision.</p>
              <app-reglement-form sens="decaissement" cleMode="mode_paiement" [exigerReferences]="false" [exigerMoyen]="false"
                                  [modele]="modele" [catalogue]="catalogue()"></app-reglement-form>
            </div>
          }
          <div class="btns">
            <button class="btn" (click)="enregistrerModele()" [disabled]="enCours() || !modele.libelle || (modele.categorie === 'autre' && !modele.precision_autre?.trim())">{{ modeleEnEdition() ? 'Enregistrer' : 'Ajouter au catalogue' }}</button>
            <button class="lien" (click)="nouveauModele()">Annuler</button>
          </div>
      </ng-template>

      @if (ajoutModeleOuvert() && !modeleEnEdition() && auth.peut('depenses.creer')) {
        <div class="groupe" id="form-ajout-modele">
          <h4 class="sous-titre">Ajouter une charge habituelle</h4>
          <ng-container [ngTemplateOutlet]="formModele"></ng-container>
        </div>
      }

      @if (!modeles().length) { <p class="hint">Aucune charge habituelle pour le moment.</p> }
      @else {
        <table>
          <tr><th>Charge</th><th>Périodicité</th><th class="num">Montant habituel</th>@if (peutOrienter) { <th>Moyen proposé</th> }<th></th></tr>
          @for (m of modeles(); track m.id) {
            <tr [class.sel]="modeleEnEdition() === m.id">
              <td><b>{{ m.libelle }}</b> @if (m.categorie === 'autre' && m.precision_autre) { <span class="tag">Autre : {{ m.precision_autre }}</span> } @if (m.montant_variable) { <span class="tag">montant variable</span> } @if (m.arriere_mois > 0) { <span class="tag report">arriéré : {{ m.arriere_mois }} mois à reprendre</span> }</td>
              <td>{{ libellePeriodicite(m) }}</td>
              <td class="num">{{ m.montant_habituel | number }}</td>
              @if (peutOrienter) { <td>{{ moyen(m) }}</td> }
              <td class="actions">
                @if (auth.peut('depenses.creer')) {
                  <button class="lien" (click)="editerModele(m)">Modifier</button>
                  <button class="lien" (click)="retirerModele(m.id)">Retirer</button>
                }
              </td>
            </tr>
            @if (modeleEnEdition() === m.id) {
              <tr class="edit" [id]="'edit-modele-' + m.id">
                <td [attr.colspan]="peutOrienter ? 5 : 4">
                  <h4 class="sous-titre">Modifier la charge</h4>
                  <ng-container [ngTemplateOutlet]="formModele"></ng-container>
                </td>
              </tr>
            }
          }
        </table>
      }
    </section>
    }
  `,
  styles: [`
    :host{display:block;padding-bottom:90px}
    .creation{display:flex;gap:8px;align-items:center}
    .onglets{display:flex;gap:4px;margin:0 0 14px;border-bottom:1px solid var(--line)}
    .onglet{background:none;border:none;border-bottom:3px solid transparent;padding:9px 16px;cursor:pointer;font-weight:600;color:var(--grey);font-size:var(--fs-md)}
    .onglet.actif{color:var(--navy);border-bottom-color:var(--gold)}
    .onglet .nb{background:var(--light);border-radius:10px;padding:1px 8px;font-size:var(--fs-2xs);margin-left:4px}
    tr.groupe-titre td{background:var(--light);color:var(--navy);padding:7px 10px;font-size:var(--fs-base)}
    .groupe{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:10px 0;background:#fffdf5}
    .sel,.in{font-family:inherit;border:1px solid var(--line);border-radius:8px;background:#fff;color:#22303f}
    .sel{padding:8px 10px;font-size:var(--fs-base)}
    .in{display:block;width:100%;box-sizing:border-box;padding:9px 12px;margin:4px 0 0;font-size:var(--fs-base)}
    label{display:block;font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .btn{font-family:inherit;background:var(--gold);color:#1b2436;border:1px solid var(--gold);border-radius:8px;padding:9px 16px;font-size:var(--fs-base);font-weight:600;cursor:pointer;text-decoration:none}
    .btn.sm{padding:7px 13px}
    .btn.ghost{background:#fff;border-color:var(--line);color:var(--slate)}
    .btn.danger{color:var(--red);border-color:var(--red)}
    .btn:disabled{opacity:.55;cursor:not-allowed}
    .barre{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:18px 0 20px}
    .btns{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:16px}
    .kpis{margin-bottom:0}
    .kpi{padding:12px 16px}
    .kpi .n{font-size:var(--fs-2xl)}
    table{width:100%}
    td.num{text-align:right;white-space:nowrap;padding-right:18px}
    th.num{text-align:right;padding-right:18px}
    td.actions{white-space:nowrap;text-align:right;padding-right:48px}
    tr.sel td{background:rgba(176,141,87,.16)}
    tr.sel td:first-child{box-shadow:inset 3px 0 0 var(--gold);font-weight:700}
    tr.retard-ligne td{background:rgba(179,38,30,.06)}
    tr.edit > td{background:#FAFAF7;padding:18px 20px 20px;border-bottom:1px solid var(--line)}
    .tag{display:inline-block;margin-left:8px;padding:2px 9px;border-radius:12px;background:#eceff3;color:#5a6675;font-size:var(--fs-xs);font-weight:600}
    .tag.report{background:#fbf1dc;color:#9a6c12}
    .obs{font-size:var(--fs-sm);color:var(--grey);margin-top:3px}
    .ok{color:var(--green);font-weight:700}.ko{color:var(--red);font-weight:700}.rep{color:#9a6c12;font-weight:700}.att{color:var(--grey)}
    .retard{display:inline-block;min-width:22px;text-align:center;padding:1px 7px;border-radius:12px;background:var(--red);color:#fff;font-weight:700;font-size:var(--fs-xs)}
    .alerte{background:rgba(179,38,30,.08);border:1px solid rgba(179,38,30,.35);color:var(--red);padding:10px 14px;border-radius:8px;font-weight:600;font-size:var(--fs-base);margin:0 0 16px}
    .champs{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px 18px;margin-bottom:14px}
    .champs .large{grid-column:1 / -1}
    .champs .etroit{max-width:260px}
    .champs .cases label{display:flex;align-items:center;gap:8px;font-weight:400;font-size:var(--fs-base)}
    .reglement-bloc{margin:2px 0 4px}
    .sous-titre{margin:26px 0 14px;padding-top:18px;border-top:1px solid var(--line);color:var(--navy);font-size:var(--fs-md);font-weight:700}
    .intro{margin:0 0 16px;color:var(--grey);font-size:var(--fs-base)}
    .hint{color:var(--grey);font-size:var(--fs-base);margin:12px 0 0}
    .panel h3 .lien{margin-left:12px;font-size:var(--fs-sm)}
  `],
})
export class EtatChargesComponent implements OnInit {
  readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly preview = inject(DocumentPreviewService);

  readonly seuil = 2;
  readonly categoriesCabinet = CATEGORIES_CABINET;
  readonly categoriesDebours = CATEGORIES_DEBOURS;
  readonly mois12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  readonly etats = signal<any[]>([]);
  readonly detail = signal<any | null>(null);
  readonly modeles = signal<any[]>([]);
  readonly catalogue = signal<MoyenPaiement[]>([]);
  readonly erreur = signal('');
  readonly enCours = signal(false);
  readonly moisChoisi = signal(new Date().getMonth() + 1);
  readonly anneeChoisie = signal(new Date().getFullYear());
  readonly annees = [0, 1, 2].map((i) => new Date().getFullYear() - 1 + i);
  readonly edition = signal<any | null>(null);
  readonly onglet = signal<'etats' | 'catalogue'>('etats');
  readonly detailReplie = signal(false);
  readonly ajoutModeleOuvert = signal(false);
  private premierChargement = true;
  readonly modeleEnEdition = signal<string | null>(null);

  form: any = {};
  ajout: any = this.ligneVide();
  modele: any = this.modeleVide();

  ngOnInit(): void {
    this.api.moyensDecaissement().subscribe({ next: (m) => this.catalogue.set(m), error: () => {} });
    this.charger();
    this.chargerModeles();
  }

  private ligneVide(): any { return { libelle: '', categorie: 'autre', precision_autre: '', nature: 'cabinet', dossier_id: null, refacturable_client: false, beneficiaire: '', arriere: 0, periode_debut: '', periode_fin: '', montant: null, observation: '', mode_paiement: '', compte_id: '', references: {} }; }
  private modeleVide(): any {
    return { libelle: '', categorie: 'autre', precision_autre: '', beneficiaire: '', arriere_mois: 0, type: 'fixe', montant_habituel: null, montant_variable: false, periodicite: 'mensuelle', mois_echeance: 1, mode_paiement: '', compte_id: '', references: {} };
  }

  libelleMois(m: string): string { const [a, n] = (m || '').split('-'); return `${MOIS[+n - 1] ?? ''} ${a}`; }
  moisNom(n: number): string { return MOIS[n - 1]; }
  libelleStatut(s: string): string { return s === 'en_preparation' ? 'en préparation' : s === 'soumis' ? 'soumis aux associés' : 'clos'; }
  libelleDepense(s: string): string { return ({ soumise: 'soumise', validee: 'à décaisser', rejetee: 'rejetée', decaissee: 'décaissée' } as any)[s] ?? s; }
  libellePeriodicite(m: any): string {
    return m.periodicite === 'mensuelle' ? 'Mensuelle'
      : m.periodicite === 'annuelle' ? `Annuelle (${MOIS[m.mois_echeance - 1]})` : `Trimestrielle (dès ${MOIS[m.mois_echeance - 1]})`;
  }
  periode(l: any): string {
    if (!l.periode_debut) return '';
    const deb = this.libelleMois(l.periode_debut.slice(0, 7));
    const fin = l.periode_fin ? this.libelleMois(l.periode_fin.slice(0, 7)) : deb;
    return deb === fin ? deb : `${deb} → ${fin}`;
  }
  moyen(l: any): string {
    const m = this.catalogue().find((x) => x.code === l.mode_paiement)?.libelle ?? l.mode_paiement ?? '';
    return [m, l.compte_intitule].filter(Boolean).join(' — ') || '—';
  }
  // Plus-value d'une ligne par rapport au mois précédent (même charge) — repère pour les montants variables.
  ecart(l: any): string {
    const avant = Number(l.montant_precedent); const maintenant = Number(l.montant);
    if (!avant) return '';
    const pct = Math.round(((maintenant - avant) / avant) * 100);
    return pct === 0 ? ' (stable)' : ` (${pct > 0 ? '+' : ''}${pct} %)`;
  }
  readonly estDebours = estDebours;

  // « Moyen / compte » : les associés (ceux qui décident) le voient et le modifient dès la préparation (orientation à
  // l'avance) et jusqu'à la décision. L'administration ne le voit pas pendant la préparation, mais le retrouve dès que
  // l'état est soumis / clos : c'est elle qui engage et décaisse les paiements selon ce que les associés ont retenu.
  afficherMoyen(d: any): boolean { return this.auth.peut('depenses.decision') || d.statut !== 'en_preparation'; }
  get peutOrienter(): boolean { return this.auth.peut('depenses.decision'); }
  nbColonnes(d: any): number { return this.afficherMoyen(d) ? 6 : 5; }

  // Menu « ⋮ » (même présentation que Dépenses & caisse) ; « Décider… » reste un bouton visible.
  actionsPourLigne(d: any, l: any): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];
    if (d.statut !== 'clos' || l.nb_pieces) {
      items.push({ label: l.nb_pieces ? `Pièces (${l.nb_pieces})` : 'Pièces / justificatifs', action: () => this.ouvrirPieces(d, l) });
    }
    if (d.statut === 'en_preparation' && this.auth.peut('depenses.creer')) {
      items.push({ label: 'Modifier', action: () => this.editer(l) });
      if (!l.report_de) items.push({ label: 'Retirer', danger: true, action: () => this.supprimer(d.id, l.id) });
    }
    return items;
  }

  // Arriéré (28/10/2026) : nombre de mois impayés avant le mois de l'état ; la période couverte va alors du
  // premier jour du plus ancien mois impayé à la fin du mois de l'état (le montant saisi est le total dû).
  private iso(d: Date): string { return d.toISOString().slice(0, 10); }
  appliquerArriere(f: any, n: any, mois: string): void {
    const k = Math.max(0, Math.min(36, Math.floor(Number(n) || 0)));
    const [a, m] = (mois || '').slice(0, 7).split('-').map(Number);
    f.arriere = k;
    f.periode_debut = this.iso(new Date(Date.UTC(a, m - 1 - k, 1)));
    f.periode_fin = this.iso(new Date(Date.UTC(a, m, 0)));
  }
  arriereDe(l: any, mois?: string): number {
    if (!l.periode_debut || !mois) return 0;
    const [a, m] = mois.slice(0, 7).split('-').map(Number);
    const [b, n] = l.periode_debut.slice(0, 7).split('-').map(Number);
    return Math.max(0, (a * 12 + m) - (b * 12 + n));
  }
  estArriere(l: any, mois: string): boolean { return !l.report_de && this.arriereDe(l, mois) > 0; }

  // Justificatifs d'une ligne (28/10/2026).
  readonly piecesLigneId = signal<string | null>(null);
  readonly listePieces = signal<any[]>([]);
  pieceType = 'facture';
  pieceFichier: File | null = null;
  readonly pieceEnCours = signal(false);
  libellePiece(t: string): string { return ({ devis: 'Devis', facture: 'Facture', preuve_paiement: 'Preuve de paiement', autre: 'Autre' } as any)[t] ?? t; }
  peutAjouterPiece(d: any, l: any): boolean { return this.auth.peut('depenses.creer') && d.statut !== 'clos' && l.decision === 'en_attente'; }
  ouvrirPieces(d: any, l: any): void {
    if (this.piecesLigneId() === l.id) { this.piecesLigneId.set(null); return; }
    this.erreur.set(''); this.pieceFichier = null; this.pieceType = 'facture';
    this.piecesLigneId.set(l.id);
    this.chargerPieces(d.id, l.id);
    this.defiler('pieces-ligne-' + l.id);
  }
  private chargerPieces(etatId: string, ligneId: string): void {
    this.api.piecesLigneCharge(etatId, ligneId).subscribe({ next: (p) => this.listePieces.set(p), error: () => this.listePieces.set([]) });
  }
  choisirPiece(ev: Event): void { this.pieceFichier = (ev.target as HTMLInputElement).files?.[0] ?? null; }
  ajouterPiece(d: any, l: any): void {
    if (!this.pieceFichier || this.pieceEnCours()) return;
    this.erreur.set(''); this.pieceEnCours.set(true);
    this.api.ajouterPieceLigneCharge(d.id, l.id, this.pieceType, this.pieceFichier).subscribe({
      next: () => { this.pieceEnCours.set(false); this.pieceFichier = null; this.chargerPieces(d.id, l.id); this.fini(); this.piecesLigneId.set(l.id); },
      error: (e) => { this.pieceEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Ajout impossible.'); },
    });
  }
  apercuPiece(d: any, l: any, p: any): void { this.preview.ouvrir(p.nom, this.api.telechargerPieceLigneCharge(d.id, l.id, p.id)); }
  retirerPiece(d: any, l: any, p: any): void {
    if (!confirm(`Retirer le justificatif « ${p.nom} » ?`)) return;
    this.api.retirerPieceLigneCharge(d.id, l.id, p.id).subscribe({
      next: () => { this.chargerPieces(d.id, l.id); this.fini(); this.piecesLigneId.set(l.id); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Retrait impossible.'),
    });
  }

  // Décision groupée (facultative).
  readonly groupeOuvert = signal(false);
  groupe: any = { mode_paiement: '', compte_id: '', references: {} };
  aApprouver(d: any): any[] { return d.lignes.filter((l: any) => l.decision === 'en_attente' && Number(l.montant) > 0); }
  totalAApprouver(d: any): number { return this.aApprouver(d).reduce((s: number, l: any) => s + Number(l.montant), 0); }
  approuverTout(d: any): void {
    const n = this.aApprouver(d).length;
    if (!confirm(`Approuver ${n} ligne(s) pour ${this.totalAApprouver(d).toLocaleString('fr-FR')} FCFA ? Les dépenses correspondantes passeront « à décaisser ».`)) return;
    this.enCours.set(true);
    this.api.approuverToutEtatCharges(d.id, { mode_paiement: this.groupe.mode_paiement || null, compte_id: this.groupe.compte_id || null }).subscribe({
      next: () => { this.groupeOuvert.set(false); this.groupe = { mode_paiement: '', compte_id: '', references: {} }; this.fini(); },
      error: (e) => this.echec(e),
    });
  }

  decisionsPrises(d: any): boolean { return d.lignes.some((l: any) => l.decision !== 'en_attente'); }
  aDecider(d: any): boolean { return d.lignes.some((l: any) => l.decision === 'en_attente'); }

  charger(): void {
    this.api.etatsCharges().subscribe({
      next: (l) => {
        this.etats.set(l);
        if (this.premierChargement) { this.premierChargement = false; this.ouvrirParDefaut(l); }
      },
      error: () => this.erreur.set('Impossible de charger les états.'),
    });
  }
  // À l'arrivée, l'état utile s'ouvre tout seul : celui du mois en cours, sinon le plus récent encore ouvert, sinon le plus récent.
  private ouvrirParDefaut(l: any[]): void {
    if (this.detail() || !l.length) return;
    const courant = new Date().toISOString().slice(0, 7);
    const choix = l.find((e) => String(e.mois).slice(0, 7) === courant) ?? l.find((e) => e.statut !== 'clos') ?? l[0];
    this.ouvrir(choix.id);
  }
  private defiler(id: string): void {
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }
  // Lignes de l'état regroupées pour la lecture : reportées, charges habituelles du mois, charges ponctuelles ajoutées.
  groupes(d: any): { cle: string; titre: string; lignes: any[]; total: number }[] {
    const def = [
      { cle: 'reportees', titre: 'Charges reportées des mois précédents', test: (l: any) => !!l.report_de },
      { cle: 'habituelles', titre: 'Charges habituelles du mois', test: (l: any) => !l.report_de && !!l.modele_id },
      { cle: 'ponctuelles', titre: 'Charges ponctuelles ajoutées', test: (l: any) => !l.report_de && !l.modele_id },
    ];
    return def
      .map((g) => {
        const lignes = d.lignes.filter(g.test);
        return { cle: g.cle, titre: g.titre, lignes, total: lignes.filter((l: any) => l.decision !== 'rejetee').reduce((s: number, l: any) => s + Number(l.montant), 0) };
      })
      .filter((g) => g.lignes.length);
  }
  chargerModeles(): void { this.api.modelesCharges().subscribe({ next: (l) => this.modeles.set(l), error: () => {} }); }

  ouvrir(id: string, defiler = false): void {
    this.edition.set(null);
    this.detailReplie.set(false);
    this.api.etatCharges(id).subscribe({
      next: (e) => { this.detail.set(e); if (defiler) this.defiler('detail-etat'); },
      error: () => this.erreur.set('Impossible d’ouvrir cet état.'),
    });
  }
  private rafraichir(): void { const id = this.detail()?.id; this.charger(); if (id) this.ouvrir(id); }
  private echec(e: any): void { this.erreur.set(e?.error?.error ?? 'Opération impossible.'); this.enCours.set(false); }
  private fini(): void { this.erreur.set(''); this.enCours.set(false); this.rafraichir(); }

  creerEtat(): void {
    this.enCours.set(true);
    this.api.creerEtatCharges(`${this.anneeChoisie()}-${String(this.moisChoisi()).padStart(2, '0')}`).subscribe({
      next: (e) => { this.erreur.set(''); this.enCours.set(false); this.charger(); this.detail.set(e); this.edition.set(null); this.onglet.set('etats'); this.defiler('detail-etat'); },
      error: (e) => this.echec(e),
    });
  }

  apercu(d: any): void { this.preview.ouvrir(`Etat des charges ${d.mois.slice(0, 7)}.pdf`, this.api.telechargerEtatChargesPdf(d.id)); }

  readonly messageCompletion = signal('');
  completer(id: string): void {
    this.enCours.set(true);
    this.messageCompletion.set('');
    this.api.completerEtatCharges(id).subscribe({
      next: (r) => {
        this.messageCompletion.set(r.ajoutees ? `${r.ajoutees} charge(s) habituelle(s) ajoutée(s) à l’état.` : 'Aucune charge habituelle manquante : l’état est complet.');
        this.fini();
      },
      error: (e) => this.echec(e),
    });
  }

  action(id: string, a: 'soumettre' | 'rouvrir' | 'cloturer'): void {
    this.enCours.set(true);
    this.api.actionEtatCharges(id, a).subscribe({ next: () => this.fini(), error: (e) => this.echec(e) });
  }

  editer(l: any): void {
    this.form = { libelle: l.libelle, categorie: l.categorie, precision_autre: l.precision_autre ?? '', nature: l.nature ?? 'cabinet', dossier_id: l.dossier_id ?? null, dossier_numero: l.dossier_numero ?? null, refacturable_client: !!l.refacturable_client, beneficiaire: l.beneficiaire ?? '', arriere: this.arriereDe(l, this.detail()?.mois), type: l.type, montant: Number(l.montant), observation: l.observation ?? '',
      periode_debut: l.periode_debut ?? '', periode_fin: l.periode_fin ?? '', mode_paiement: l.mode_paiement ?? '', compte_id: l.compte_id ?? '', references: {}, motif: '' };
    this.edition.set(l);
    this.defiler('edit-ligne-' + l.id);
  }
  private charge(): any {
    const f = this.form;
    return { libelle: f.libelle, categorie: f.categorie, precision_autre: f.categorie === 'autre' ? f.precision_autre : null, nature: f.nature, dossier_id: f.nature === 'dossier' ? f.dossier_id : null, refacturable_client: f.nature === 'dossier' && !!f.refacturable_client, beneficiaire: f.beneficiaire || null, type: f.type, montant: Number(f.montant), observation: f.observation || null,
      periode_debut: f.periode_debut || null, periode_fin: f.periode_fin || null, mode_paiement: f.mode_paiement || null, compte_id: f.compte_id || null };
  }
  enregistrerLigne(etatId: string, ligneId: string): void {
    this.enCours.set(true);
    this.api.modifierLigneCharge(etatId, ligneId, this.charge()).subscribe({ next: () => { this.edition.set(null); this.fini(); }, error: (e) => this.echec(e) });
  }
  decider(etatId: string, ligneId: string, decision: string): void {
    this.enCours.set(true);
    const f = this.form;
    this.api.decisionLigneCharge(etatId, ligneId, { decision, motif: f.motif || null, montant: Number(f.montant),
      mode_paiement: f.mode_paiement || null, compte_id: f.compte_id || null }).subscribe({
      next: () => { this.edition.set(null); this.fini(); }, error: (e) => this.echec(e) });
  }
  supprimer(etatId: string, ligneId: string): void {
    if (!confirm('Retirer cette charge de l’état ?')) return;
    this.api.supprimerLigneCharge(etatId, ligneId).subscribe({ next: () => this.fini(), error: (e) => this.echec(e) });
  }
  ajouterLigne(etatId: string): void {
    const a = this.ajout;
    this.enCours.set(true);
    this.api.ajouterLigneCharge(etatId, { libelle: a.libelle, categorie: a.categorie, precision_autre: a.categorie === 'autre' ? a.precision_autre : null, nature: a.nature, dossier_id: a.nature === 'dossier' ? a.dossier_id : null, refacturable_client: a.nature === 'dossier' && !!a.refacturable_client, beneficiaire: a.beneficiaire || null, periode_debut: a.arriere > 0 ? a.periode_debut : null, periode_fin: a.arriere > 0 ? a.periode_fin : null, type: 'ponctuelle', montant: Number(a.montant || 0),
      observation: a.observation || null, mode_paiement: a.mode_paiement || null, compte_id: a.compte_id || null }).subscribe({
      next: () => { this.ajout = this.ligneVide(); this.fini(); }, error: (e) => this.echec(e) });
  }

  nouveauModele(): void { this.modele = this.modeleVide(); this.modeleEnEdition.set(null); this.ajoutModeleOuvert.set(false); }
  ouvrirAjoutModele(): void {
    this.modele = this.modeleVide(); this.modeleEnEdition.set(null);
    this.ajoutModeleOuvert.set(true);
    this.defiler('form-ajout-modele');
  }
  editerModele(m: any): void {
    this.modele = { libelle: m.libelle, categorie: m.categorie, precision_autre: m.precision_autre ?? '', beneficiaire: m.beneficiaire ?? '', arriere_mois: m.arriere_mois ?? 0, type: m.type, montant_habituel: Number(m.montant_habituel), montant_variable: m.montant_variable,
      periodicite: m.periodicite, mois_echeance: m.mois_echeance ?? 1, mode_paiement: m.mode_paiement ?? '', compte_id: m.compte_id ?? '', references: {} };
    this.ajoutModeleOuvert.set(false);
    this.modeleEnEdition.set(m.id);
    this.defiler('edit-modele-' + m.id);
  }
  enregistrerModele(): void {
    const m = this.modele;
    this.enCours.set(true);
    this.api.enregistrerModeleCharge({ libelle: m.libelle, categorie: m.categorie, precision_autre: m.categorie === 'autre' ? m.precision_autre : null, beneficiaire: m.beneficiaire || null, arriere_mois: m.periodicite === 'mensuelle' ? Number(m.arriere_mois || 0) : 0, type: m.type, montant_habituel: Number(m.montant_habituel || 0),
      montant_variable: !!m.montant_variable, periodicite: m.periodicite, mois_echeance: m.periodicite === 'mensuelle' ? null : Number(m.mois_echeance),
      mode_paiement: m.mode_paiement || null, compte_id: m.compte_id || null }, this.modeleEnEdition() ?? undefined).subscribe({
      next: () => { this.nouveauModele(); this.erreur.set(''); this.enCours.set(false); this.chargerModeles(); }, error: (e) => this.echec(e) });
  }
  retirerModele(id: string): void {
    if (!confirm('Retirer cette charge du catalogue ? Les états déjà préparés ne changent pas.')) return;
    this.api.retirerModeleCharge(id).subscribe({ next: () => this.chargerModeles(), error: (e) => this.echec(e) });
  }
}
