import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, MoyenPaiement } from '../../core/api.service';
import { ReglementFormComponent } from '../../core/reglement-form.component';
import { AuthService } from '../../core/auth.service';
import { RaccourcisClavierDirective } from '../../core/raccourcis-clavier.directive';
import { MenuActionsComponent, ActionMenuItem } from '../../core/menu-actions.component';
import { CATEGORIES_CABINET, CATEGORIES_DEBOURS, libelleCategorieDepense } from '../../core/categories-depense';
import { DossierPickerComponent } from '../../core/dossier-picker.component';
import { DocumentPreviewService } from '../../core/document-preview.service';

@Component({
  selector: 'app-depenses',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, RouterLink, RaccourcisClavierDirective, MenuActionsComponent, DossierPickerComponent, ReglementFormComponent],
  template: `
    <header class="page-head" style="gap:24px">
      <div style="flex:1;min-width:0">
        <h1>Dépenses &amp; caisse</h1>
        <p>Charges du cabinet, petite caisse, vignettes de plaidoirie — circuit soumise → validée → décaissée. Une charge d'un état mensuel n'apparaît ici qu'une fois approuvée par les associés ; avant, elle se suit dans l'état.</p>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-shrink:0;white-space:nowrap">
        <a class="btn ghost" routerLink="/depenses/etat-charges">État mensuel des charges</a>
        @if (auth.peut('depenses.creer')) {
          <button class="btn" (click)="afficherForm.set(!afficherForm())">
            {{ afficherForm() ? 'Annuler' : '+ Nouvelle dépense' }}
          </button>
        }
      </div>
    </header>

    @if (filtreDossierNumero()) {
      <p class="bandeau-filtre">Filtré sur le dossier <b>{{ filtreDossierNumero() }}</b> — <a class="lien" routerLink="." [queryParams]="{}">voir toutes les dépenses</a></p>
    }

    <div class="kpis">
      <div class="kpi">
        <div class="n">{{ caisse()?.dotation ?? 0 | number }}</div>
        <div class="l">Dotation petite caisse ({{ moisCourant.slice(0,7) }})</div>
      </div>
      <div class="kpi amber">
        <div class="n">{{ caisse()?.depense ?? 0 | number }}</div>
        <div class="l">Petite caisse dépensée ce mois</div>
      </div>
      <div class="kpi" [class.red]="(caisse()?.solde ?? 0) < 0" [class.green]="(caisse()?.solde ?? 0) >= 0">
        <div class="n">{{ caisse()?.solde ?? 0 | number }}</div>
        <div class="l">Solde petite caisse</div>
      </div>
      <div class="kpi amber" style="cursor:pointer" (click)="voirADecaisser()" title="Afficher les dépenses validées en attente de décaissement">
        <div class="n">{{ aDecaisser().total | number }}</div>
        <div class="l">À décaisser — {{ aDecaisser().nb }} dépense(s)</div>
      </div>
      <div class="kpi" [class.red]="stockVignettes() <= seuilVignettes()" [class.blue]="stockVignettes() > seuilVignettes()">
        <div class="n">{{ stockVignettes() }}</div>
        <div class="l">Vignettes en stock {{ stockVignettes() <= seuilVignettes() ? '— stock bas (seuil ' + seuilVignettes() + ')' : '' }}</div>
      </div>
    </div>

    @if (afficherForm()) {
      <section class="panel">
        <h3>Nouvelle dépense</h3>
        <div class="grid2" appRaccourcis (entree)="creer()" (echap)="afficherForm.set(false)"
             [entreeActive]="!!form.libelle && !!form.montant && !(form.nature === 'dossier' && !form.dossier_id) && !creationEnCours()">
          <div>
            <label>Type</label>
            <select class="in" [(ngModel)]="form.type" name="type">
              <option value="ponctuelle">Ponctuelle</option>
              <option value="fixe">Fixe (charge récurrente)</option>
            </select>
          </div>
          <div>
            <label>Catégorie</label>
            <select class="in" [(ngModel)]="form.categorie" name="categorie">
              <optgroup label="Charges du cabinet">@for (c of categoriesCabinet; track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }</optgroup>
              <optgroup label="Débours et frais de procédure">@for (c of categoriesDebours; track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }</optgroup>
            </select>
          </div>
          <div class="col2"><label>Libellé</label><input class="in" [(ngModel)]="form.libelle" name="libelle" /></div>
          <div><label>Bénéficiaire (facultatif)</label><input class="in" maxlength="160" [(ngModel)]="form.beneficiaire" name="beneficiaire" placeholder="Fournisseur ou personne payée" /></div>
          <div><label>Montant (FCFA)</label><input class="in" type="number" [(ngModel)]="form.montant" name="montant" /></div>
          <div><label>Date</label><input class="in" type="date" [(ngModel)]="form.date_depense" name="date" /></div>
          <app-reglement-form sens="decaissement" cleMode="mode_paiement" [exigerReferences]="false" [exigerMoyen]="false"
                              [modele]="form" [catalogue]="catalogue()"></app-reglement-form>
          <div class="col2">
            <label>Nature de la charge</label>
            <select class="in" [(ngModel)]="form.nature" name="nature">
              <option value="cabinet">Charge propre au cabinet (fonctionnement, gestion)</option>
              <option value="dossier">Charge liée à un dossier / une procédure</option>
            </select>
          </div>
          @if (form.nature === 'dossier') {
            <div class="col2">
              <label>Dossier concerné</label>
              <app-dossier-picker [valeur]="form.dossier_id" (valeurChange)="form.dossier_id = $event"></app-dossier-picker>
            </div>
          }
          <div class="col2 checks">
            <label><input type="checkbox" [(ngModel)]="form.petite_caisse" name="pc" /> Sur petite caisse</label>
            @if (form.nature === 'dossier') { <label><input type="checkbox" [(ngModel)]="form.refacturable_client" name="refact" /> Débours refacturable au client</label> }
          </div>
        </div>
        <button class="btn" (click)="creer()" [disabled]="!form.libelle || !form.montant || (form.nature === 'dossier' && !form.dossier_id) || creationEnCours()">{{ creationEnCours() ? 'Soumission…' : 'Soumettre' }}</button>
        @if (doublonsDepense().length) {
          <div class="doublon">
            <b>⚠ Une dépense très proche existe déjà :</b>
            @for (d of doublonsDepense(); track d.id) { <p>{{ d.libelle }} — {{ d.montant | number }} FCFA — {{ d.date_depense | date:'dd/MM/yyyy' }} ({{ d.statut }})</p> }
            <div class="btns">
              <button class="btn ghost" (click)="doublonsDepense.set([])">Annuler, je vérifie</button>
              <button class="btn" (click)="creerQuandMeme()" [disabled]="creationEnCours()">Soumettre quand même</button>
            </div>
          </div>
        }
        @if (erreur()) { <p class="err">{{ erreur() }}</p> }
      </section>
    }

    <section class="panel">
      <div class="filtres">
        <select class="in filtre" [(ngModel)]="filtreStatut" (ngModelChange)="charger()">
          <option value="">Tous statuts</option>
          <option value="soumise">Soumise</option>
          <option value="validee">Validée — à décaisser</option>
          <option value="decaissee">Décaissée</option>
          <option value="rejetee">Rejetée</option>
          <option value="annulee">Annulée</option>
        </select>
        <select class="in filtre" [(ngModel)]="filtreType" (ngModelChange)="charger()">
          <option value="">Tous types</option>
          <option value="fixe">Fixe</option>
          <option value="ponctuelle">Ponctuelle</option>
        </select>
        <select class="in filtre" [(ngModel)]="filtreCategorie" (ngModelChange)="charger()">
          <option value="">Toutes catégories</option>
          <optgroup label="Charges du cabinet">@for (c of categoriesCabinet; track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }</optgroup>
          <optgroup label="Débours et frais de procédure">@for (c of categoriesDebours; track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }</optgroup>
        </select>
        <select class="in filtre" [(ngModel)]="filtreNature" (ngModelChange)="charger()">
          <option value="">Cabinet et dossiers</option>
          <option value="cabinet">Charges du cabinet</option>
          <option value="dossier">Liées à un dossier</option>
        </select>
        <select class="in filtre" [(ngModel)]="filtreCaisse" (ngModelChange)="charger()">
          <option value="">Toutes sources</option>
          <option value="true">Petite caisse</option>
          <option value="false">Hors petite caisse</option>
        </select>
        <label class="filtre-date">Du <input class="in" type="date" [(ngModel)]="filtreDu" (ngModelChange)="charger()" /></label>
        <label class="filtre-date">au <input class="in" type="date" [(ngModel)]="filtreAu" (ngModelChange)="charger()" /></label>
        <input class="in filtre" style="min-width:210px" placeholder="Rechercher (libellé, bénéficiaire)…" [(ngModel)]="filtreRecherche" (ngModelChange)="chargerRecherche()" (keydown.enter)="rechercherMaintenant()" />
        <label class="filtre-cases"><input type="checkbox" [(ngModel)]="masquerAnnulees" (ngModelChange)="charger()" /> Masquer les annulées</label>
        @if (filtresActifs()) { <button class="lien" (click)="reinitialiserFiltres()">Effacer les filtres</button> }
      </div>
      <!-- Erreurs des actions de la liste (décision, décaissement, retrait) :
           jusqu'ici affichées seulement dans le formulaire de création,
           souvent fermé — donc invisibles (25/09/2026). -->
      @if (erreur() && !editionId() && !afficherForm()) { <p class="err">{{ erreur() }}</p> }
      @if (depenses().length) {
        <table>
          <tr><th>Date</th><th>Libellé</th><th>Catégorie</th><th>Montant</th><th>Nature / dossier</th><th>Pièces</th><th>Statut</th><th></th></tr>
          @for (d of depenses(); track d.id) {
            <tr [class.annulee]="!!d.annulee_le">
              <td>{{ d.date_depense | date:'dd/MM/yyyy' }}</td>
              <td>{{ d.libelle }}@if (d.beneficiaire) { <span class="muted"> — {{ d.beneficiaire }}</span> } @if (d.petite_caisse) { <span class="tag">petite caisse</span> }@if (d.mode_paiement) { <br /><span class="muted">{{ libelleMoyen(d.mode_paiement) }}@if (d.compte) { · {{ d.compte }} }</span> }
                @if (d.etat_mois) { <span class="tag">État {{ d.etat_mois | date:'MM/yyyy' }}</span> }
                @if (d.annulee_le) { <div class="obs">Annulée le {{ d.annulee_le | date:'dd/MM/yyyy' }}@if (d.annulee_par_nom) { par {{ d.annulee_par_nom }} }@if (d.annulation_motif) { — {{ d.annulation_motif }} }</div> }
                @else if (d.statut === 'rejetee' && d.motif_rejet) { <div class="obs">Rejetée : {{ d.motif_rejet }}</div> }
              </td>
              <td>{{ libelleCategorie(d.categorie) }}</td>
              <td>{{ d.montant | number }} FCFA</td>
              <td>@if (d.dossier_id) { <a class="lien" [routerLink]="['/dossiers', d.dossier_id]">{{ d.dossier_numero }}</a> } @else { <span class="tag">Cabinet</span> }</td>
              <td>@if (d.nb_pieces) { 📎 {{ d.nb_pieces }} @if (d.nb_devis) { <span class="tag" [class.ok]="d.devis_retenu">{{ d.nb_devis }} devis{{ d.devis_retenu ? ' — 1 retenu' : '' }}</span> } } @else { <span class="muted">—</span> }</td>
              <td>@if (d.annulee_le) { <span class="tag haute" [title]="'Annulée : ' + (d.annulation_motif || '')">Annulée</span> } @else { <span class="tag" [class.ok]="d.statut==='decaissee'" [class.haute]="d.statut==='rejetee'">{{ libelleStatut(d.statut) }}</span> }
                @if (!d.annulee_le && d.apres_coup_statut === 'a_valider') { {{ ' ' }}<span class="tag attente" title="Dépense engagée sur la petite caisse, en attente de validation par un associé">À valider après coup</span> }
                @if (d.apres_coup_statut === 'validee') { {{ ' ' }}<span class="tag ok">Validée après coup</span> }
                @if (d.apres_coup_statut === 'contestee') { {{ ' ' }}<span class="tag haute" [title]="d.apres_coup_motif || ''">Contestée</span> }
              </td>
              <td><app-menu-actions [actions]="actionsPour(d)" /></td>
            </tr>
            @if (decaissementId() === d.id) {
              <tr class="edition">
                <td colspan="8">
                  <b>Décaisser — {{ d.libelle }} ({{ d.montant | number }} FCFA)</b>
                  <p class="muted">Précisez le moyen de paiement et ses références : l'argent sort maintenant.</p>
                  <div class="grid2">
                    <app-reglement-form sens="decaissement" cleMode="mode_paiement" [modele]="decModele" [catalogue]="catalogue()" (validite)="decValide.set($event)"></app-reglement-form>
                  </div>
                  <div class="btns-ligne">
                    <button class="btn" (click)="confirmerDecaissement(d)" [disabled]="!decValide() || decEnCours()">{{ decEnCours() ? 'Décaissement…' : 'Confirmer le décaissement' }}</button>
                    <button class="lien" (click)="decaissementId.set(null)">Annuler</button>
                  </div>
                </td>
              </tr>
            }
            @if (editionId() === d.id) {
              <tr class="edition">
                <td colspan="8">
                  <div class="grid2">
                    <div>
                      <label>Type</label>
                      <select class="in" [(ngModel)]="editForm.type" name="edType">
                        <option value="ponctuelle">Ponctuelle</option>
                        <option value="fixe">Fixe (charge récurrente)</option>
                      </select>
                    </div>
                    <div>
                      <label>Catégorie</label>
                      <select class="in" [(ngModel)]="editForm.categorie" name="edCategorie">
                        <optgroup label="Charges du cabinet">@for (c of categoriesCabinet; track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }</optgroup>
              <optgroup label="Débours et frais de procédure">@for (c of categoriesDebours; track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }</optgroup>
                      </select>
                    </div>
                    <div class="col2"><label>Libellé</label><input class="in" [(ngModel)]="editForm.libelle" name="edLibelle" /></div>
                    <div><label>Bénéficiaire (facultatif)</label><input class="in" maxlength="160" [(ngModel)]="editForm.beneficiaire" name="edBeneficiaire" /></div>
                    <div><label>Montant (FCFA)</label><input class="in" type="number" [(ngModel)]="editForm.montant" name="edMontant" /></div>
                    <div><label>Date</label><input class="in" type="date" [(ngModel)]="editForm.date_depense" name="edDate" /></div>
                    <app-reglement-form sens="decaissement" cleMode="mode_paiement" [exigerReferences]="false" [exigerMoyen]="false"
                                        [modele]="editForm" [catalogue]="catalogue()"></app-reglement-form>
                    <div class="col2">
                      <label>Nature de la charge</label>
                      <select class="in" [(ngModel)]="editForm.nature" name="edNature">
                        <option value="cabinet">Charge propre au cabinet</option>
                        <option value="dossier">Charge liée à un dossier / une procédure</option>
                      </select>
                    </div>
                    @if (editForm.nature === 'dossier') {
                      <div class="col2"><label>Dossier concerné</label>
                        <app-dossier-picker [valeur]="editForm.dossier_id" (valeurChange)="editForm.dossier_id = $event"></app-dossier-picker></div>
                    }
                    <div class="col2 checks">
                      <label><input type="checkbox" [(ngModel)]="editForm.petite_caisse" name="edPc" /> Sur petite caisse</label>
                      <label><input type="checkbox" [(ngModel)]="editForm.refacturable_client" name="edRefact" /> Débours refacturable au client</label>
                    </div>
                  </div>
                  <button class="lien" (click)="enregistrerEdition()" [disabled]="editionEnCours()">{{ editionEnCours() ? 'Enregistrement…' : 'Enregistrer' }}</button>
                  <button class="lien" (click)="annulerEdition()">Annuler</button>
                  @if (erreur()) { <p class="err">{{ erreur() }}</p> }
                </td>
              </tr>
            }
            @if (piecesId() === d.id) {
              <tr class="edition">
                <td colspan="8">
                  <b>Pièces de la dépense</b> — devis (plusieurs possibles, facultatifs), facture, preuve de paiement.
                  @if (pieces().length) {
                    <table>
                      <tr><th>Type</th><th>Fichier</th><th>Ajouté par</th><th></th></tr>
                      @for (p of pieces(); track p.id) {
                        <tr>
                          <td>{{ libellePiece(p.type) }} @if (p.retenu) { <span class="tag ok">Retenu</span> }</td>
                          <td>{{ p.nom }}</td>
                          <td>{{ p.ajoute_par || '—' }}</td>
                          <td><app-menu-actions [actions]="actionsPourPiece(d, p)" /></td>
                        </tr>
                      }
                    </table>
                  } @else { <p class="muted">Aucune pièce.</p> }
                  <div class="grid2" style="margin-top:8px">
                    <div>
                      <label>Type de pièce</label>
                      <select class="in" [(ngModel)]="pieceType" name="pieceType">
                        @if (d.statut === 'soumise') { <option value="devis">Devis</option> }
                        <option value="facture">Facture</option>
                        <option value="preuve_paiement">Preuve de paiement</option>
                        <option value="autre">Autre</option>
                      </select>
                    </div>
                    <div><label>Fichier (PDF, image, Word, Excel)</label><input class="in" type="file" (change)="choisirPiece($event)" /></div>
                  </div>
                  <button class="btn" (click)="ajouterPiece(d)" [disabled]="!pieceFichier || pieceEnCours()">{{ pieceEnCours() ? 'Envoi…' : 'Ajouter la pièce' }}</button>
                  <button class="lien" (click)="piecesId.set(null)">Fermer</button>
                  @if (erreur()) { <p class="err">{{ erreur() }}</p> }
                </td>
              </tr>
            }
          }
        </table>
        <p class="total-liste">
          <b>{{ totalAffiche() | number }} FCFA</b> · {{ nbCompte() }} dépense(s) comptée(s) <span class="muted">(annulées et rejetées exclues)</span>@if (depenses().length >= 300) { <span class="muted"> — 300 plus récentes affichées : affinez les filtres</span> }
        </p>
      } @else { <p class="muted">Aucune dépense.</p> }
    </section>

    @if (auth.peut('depenses.petite_caisse.doter')) {
      <section class="panel">
        <h3>Petite caisse — dotation mensuelle</h3>
        <p class="muted">Mois en cours ({{ moisCourant.slice(0, 7) }}) : dotation <b>{{ caisse()?.dotation ?? 0 | number }}</b> FCFA · dépensé <b>{{ caisse()?.depense ?? 0 | number }}</b> FCFA · solde <b>{{ caisse()?.solde ?? 0 | number }}</b> FCFA.
          Chaque mois est indépendant : le solde non dépensé n'est pas reporté sur le mois suivant.</p>
        <div class="upload" id="formDotation" appRaccourcis (entree)="definirDotation()"
             [entreeActive]="dotationMontant !== null && dotationMontant !== undefined && !dotationEnCours()">
          <input class="sel" type="month" [(ngModel)]="dotationMois" name="dotationMois" />
          <input class="sel" id="champDotation" type="number" min="0" [(ngModel)]="dotationMontant" name="dotationMontant" placeholder="Montant (FCFA) — 0 pour remettre à zéro" style="min-width:270px" />
          <button class="btn sm" (click)="definirDotation()" [disabled]="dotationMontant === null || dotationMontant === undefined || dotationEnCours()">{{ dotationEnCours() ? 'Enregistrement…' : 'Enregistrer' }}</button>
        </div>
        @if (dotationCorrection()) { <p class="ok-msg">{{ dotationCorrection() }}</p> }
        <p class="muted" style="margin-top:6px">Réenregistrer un mois déjà doté remplace son montant (correction).</p>
        @if (dotations().length) {
          <table>
            <tr><th>Mois</th><th>Dotation (FCFA)</th><th>Enregistrée par</th><th></th></tr>
            @for (dt of dotations(); track dt.mois) {
              <tr>
                <td>{{ dt.mois | date:'MM/yyyy' }}</td><td>{{ dt.montant_alloue | number }}</td><td>{{ dt.par || '—' }}</td>
                <td><button class="lien" (click)="corrigerDotation(dt)">Corriger</button></td>
              </tr>
            }
          </table>
        }
      </section>
    }

    @if (auth.peut('depenses.engager')) {
      <section class="panel">
        <h3>Petite caisse — engager une petite dépense</h3>
        <p class="muted">Dépense réglée tout de suite, <b>validée après coup par un associé autre que vous</b>.
          Plafond par dépense : <b>{{ caisse()?.plafond_depense != null ? (caisse()?.plafond_depense | number) + ' FCFA' : 'non défini (engagement impossible)' }}</b> ·
          solde du mois : <b>{{ caisse()?.solde ?? 0 | number }} FCFA</b>. Au-delà du plafond : « + Nouvelle dépense » (validation avant paiement).</p>
        <div class="grid2" appRaccourcis (entree)="engager()"
             [entreeActive]="!!engagement.libelle && !!engagement.montant && !(engagement.nature === 'dossier' && !engagement.dossier_id) && !engagementEnCours() && engagementValide()">
          <div class="col2"><label>Libellé</label><input class="in" [(ngModel)]="engagement.libelle" name="engLibelle" /></div>
          <div><label>Montant (FCFA)</label><input class="in" type="number" [(ngModel)]="engagement.montant" name="engMontant" /></div>
          <div>
            <label>Catégorie</label>
            <select class="in" [(ngModel)]="engagement.categorie" name="engCategorie">
              <option value="">— À choisir —</option>
              <optgroup label="Charges du cabinet">@for (c of categoriesCabinet; track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }</optgroup>
              <optgroup label="Débours et frais de procédure">@for (c of categoriesDebours; track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }</optgroup>
            </select>
          </div>
          <div><label>Bénéficiaire (facultatif)</label><input class="in" maxlength="160" [(ngModel)]="engagement.beneficiaire" name="engBeneficiaire" placeholder="Fournisseur ou personne payée" /></div>
          <app-reglement-form sens="decaissement" cleMode="mode_paiement" [modele]="engagement" [catalogue]="catalogue()" (validite)="engagementValide.set($event)"></app-reglement-form>
          <div>
            <label>Nature</label>
            <select class="in" [(ngModel)]="engagement.nature" name="engNature">
              <option value="cabinet">Charge propre au cabinet</option>
              <option value="dossier">Charge liée à un dossier</option>
            </select>
          </div>
          @if (engagement.nature === 'dossier') {
            <div><label>Dossier concerné</label>
              <app-dossier-picker [valeur]="engagement.dossier_id" (valeurChange)="engagement.dossier_id = $event"></app-dossier-picker></div>
            <div class="cases"><label><input type="checkbox" [(ngModel)]="engagement.refacturable_client" name="engRefact" /> Débours refacturable au client</label></div>
          }
        </div>
        <button class="btn" (click)="engager()" [disabled]="!engagement.libelle || !engagement.montant || (engagement.nature === 'dossier' && !engagement.dossier_id) || engagementEnCours() || !engagementValide()">{{ engagementEnCours() ? 'Enregistrement…' : 'Engager la dépense' }}</button>
        @if (engagementMessage()) { <p class="ok-msg">{{ engagementMessage() }}</p> }
        @if (erreur() && !afficherForm() && !editionId()) { <p class="err">{{ erreur() }}</p> }
      </section>
    }

    @if (auth.peut('depenses.petite_caisse.doter')) {
      <section class="panel">
        <h3>Petite caisse — rapprochement mensuel</h3>
        <p class="muted">Comparez le solde calculé par JURIA (<b>{{ caisse()?.solde ?? 0 | number }} FCFA</b>) au solde réel du porte-monnaie mobile money (relevé de l'opérateur) ou au comptage des espèces.</p>
        <div class="upload" appRaccourcis (entree)="rapprocher()" [entreeActive]="rapSoldeReel !== null && !rapEnCours()">
          <input class="sel" type="number" [(ngModel)]="rapSoldeReel" name="rapSoldeReel" placeholder="Solde réel constaté (FCFA)" style="min-width:220px" />
          <input class="sel" [(ngModel)]="rapNote" name="rapNote" placeholder="Note (facultatif)" style="min-width:240px" />
          <button class="btn sm" (click)="rapprocher()" [disabled]="rapSoldeReel === null || rapEnCours()">{{ rapEnCours() ? 'Enregistrement…' : 'Enregistrer le rapprochement' }}</button>
        </div>
        @if (rapprochements().length) {
          <table>
            <tr><th>Fait le</th><th>Mois</th><th>Solde JURIA</th><th>Solde réel</th><th>Écart</th><th>Par</th><th>Note</th></tr>
            @for (r of rapprochements(); track r.id) {
              <tr>
                <td>{{ r.fait_le | date:'dd/MM/yyyy' }}</td><td>{{ r.mois | date:'MM/yyyy' }}</td>
                <td>{{ r.solde_calcule | number }}</td><td>{{ r.solde_reel | number }}</td>
                <td><span class="tag" [class.ok]="+r.ecart === 0" [class.haute]="+r.ecart !== 0">{{ +r.ecart | number }}</span></td>
                <td>{{ r.fait_par || '—' }}</td><td>{{ r.note || '—' }}</td>
              </tr>
            }
          </table>
        }
      </section>
    }

    <section class="panel">
      <h3>Vignettes de plaidoirie</h3>
      <p class="muted">Approvisionnement du stock uniquement — la consommation d'une vignette se fait désormais depuis l'instance concernée (fiche dossier → Instances), avec traçabilité (numéro, mode d'honoraires renseigné).</p>
      @if (auth.peut('depenses.vignettes.mouvement')) {
        <div class="upload" appRaccourcis (entree)="approvisionnerVignette()"
             [entreeActive]="(!!vignetteQuantite || !!vignetteNumeros.trim()) && !vignetteEnCours()">
          <input class="sel" type="number" [(ngModel)]="vignetteQuantite" name="vqte" placeholder="Quantité" style="max-width:120px" />
          <input class="sel" [(ngModel)]="vignetteNumeros" name="vnums" placeholder="N° à 7 chiffres : 1000200-1000204, 1000300 (facultatif)" style="min-width:380px" />
          <button class="btn sm" (click)="approvisionnerVignette()" [disabled]="(!vignetteQuantite && !vignetteNumeros.trim()) || vignetteEnCours()">{{ vignetteEnCours() ? 'Enregistrement…' : "Enregistrer l'achat" }}</button>
        </div>
        <p class="muted" style="margin-top:6px">Saisissez les plages et/ou numéros isolés du lot (7 chiffres chacun) : la quantité se déduit du nombre réel de numéros. Sans numéros, indiquez seulement la quantité.</p>
        @if (achatsVignettes().length) {
          <table style="margin-top:10px">
            <tr><th>Date</th><th>Quantité</th><th>Numéros</th><th>Par</th><th></th></tr>
            @for (a of achatsVignettes(); track a.id) {
              <tr>
                <td>{{ a.date_mouvement | date:'dd/MM/yyyy' }}</td><td>{{ a.quantite }}</td>
                <td>{{ a.nb_numeros ? a.nb_numeros + ' numéros' + (a.nb_utilises ? ' (' + a.nb_utilises + ' utilisés)' : '') : 'quantité seule' }}</td>
                <td>{{ a.par || '—' }}</td>
                <td><button class="lien" (click)="supprimerAchat(a)">Supprimer</button></td>
              </tr>
            }
          </table>
        }
        @if (utilisationsVignettes().length) {
          <h4 class="sous-titre" style="margin-top:14px">Vignettes utilisées</h4>
          <table>
            <tr><th>Date</th><th>N°</th><th>Dossier</th><th>Par</th><th></th></tr>
            @for (u of utilisationsVignettes(); track u.id) {
              <tr>
                <td>{{ u.date_mouvement | date:'dd/MM/yyyy' }}</td>
                <td>{{ u.numero_vignette ? pad7(u.numero_vignette) : '—' }}</td>
                <td>{{ u.dossier_numero ? u.dossier_numero + ' — ' + u.dossier_intitule : '—' }}@if (!u.instance_id) { <span class="tag">sans instance</span> }</td>
                <td>{{ u.par || '—' }}</td>
                <td><button class="lien" (click)="annulerUtilisation(u)">Annuler</button></td>
              </tr>
            }
          </table>
          <p class="muted" style="margin-top:6px">Annuler une utilisation remet le numéro en stock et supprime la dépense « Vignette de plaidoirie » correspondante. À réserver aux saisies de test ou d’erreur.</p>
        }
      }
    </section>
  `,
  styles: [`
    .btns-ligne{display:flex;gap:12px;align-items:center;margin-top:12px}
    .ok-msg{color:var(--green);font-size:var(--fs-base);margin:8px 0 0}
    tr.annulee td{color:var(--grey);opacity:.62} tr.annulee td:last-child{opacity:1}
    .obs{font-size:var(--fs-2xs);color:var(--grey);font-style:italic;margin-top:2px}
    .filtre-date{display:inline-flex;align-items:center;gap:5px;font-size:var(--fs-base);color:var(--grey)}
    .filtre-cases{display:inline-flex;align-items:center;gap:5px;font-size:var(--fs-base)}
    .total-liste{margin:10px 2px 0;text-align:right;font-size:var(--fs-md)}
    /* 26/09/2026 — audit doublons, même style que clients.component.ts. */
    .doublon{background:#fffaf0;border:1px solid #f0dcae;border-radius:10px;padding:14px 16px;margin-top:10px;max-width:680px}
    .doublon p{margin:4px 0;font-size:var(--fs-base)}
    .doublon .btns{display:flex;gap:8px;margin-top:10px}
    .edition td{background:var(--light);padding:12px 14px}
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md)}
    .sel{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:var(--fs-base)}
    label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:680px}
    .col2{grid-column:1 / -1}
    .checks{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
    .checks label{font-weight:400}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-size:var(--fs-base);font-family:inherit;line-height:1.2;font-weight:600;cursor:pointer}
    .btn.sm{padding:8px 12px;font-size:var(--fs-base)}
    .btn.ghost{background:#fff;border:1px solid var(--line);color:var(--slate)}
    a.btn{display:inline-block;text-decoration:none;box-sizing:border-box}
    a.btn.ghost{padding:9px 15px}
    .btn:disabled{opacity:.6}
    .filtres{display:flex;gap:10px;margin-bottom:14px}
    .filtre{width:auto;margin:0;max-width:180px}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    .tag.haute{background:#fbe6e5;color:#b13a36}
    .upload{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    .bandeau-filtre{background:var(--light);border-radius:8px;padding:9px 14px;font-size:var(--fs-base);color:var(--slate);margin-bottom:14px}
  `],
})
export class DepensesComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly preview = inject(DocumentPreviewService);
  private readonly route = inject(ActivatedRoute);
  readonly depenses = signal<any[]>([]);
  readonly comptes = signal<any[]>([]);
  // Moyens de décaissement (20/10/2026) : liste unique servie par le serveur.
  readonly catalogue = signal<MoyenPaiement[]>([]);
  readonly engagementValide = signal(true);
  libelleMoyen(code: string | null): string { return this.catalogue().find((m) => m.code === code)?.libelle ?? (code ?? '—'); }
  readonly caisse = signal<any | null>(null);
  readonly stockVignettes = signal(0);
  readonly seuilVignettes = signal(10);
  readonly afficherForm = signal(false);
  readonly erreur = signal('');
  // 26/09/2026 — audit doublons : garde anti-double-clic + avertissement de
  // ressaisie, même patron que clients.component.ts.
  readonly creationEnCours = signal(false);
  readonly doublonsDepense = signal<any[]>([]);

  // Navigation inter-modules (06/09/2026) — voir facturation.component.ts.
  readonly filtreDossierId = signal<string | null>(null);
  readonly filtreDossierNumero = signal<string | null>(null);

  filtreStatut = '';
  filtreType = '';
  filtreCategorie = '';
  filtreNature = '';
  filtreCaisse = '';
  filtreDu = '';
  filtreAu = '';
  filtreRecherche = '';
  masquerAnnulees = false;
  readonly aDecaisser = signal<{ nb: number; total: number }>({ nb: 0, total: 0 });
  private minuteurRecherche: any = null;
  form: any = { type: 'ponctuelle', categorie: 'autre', nature: 'cabinet' };
  moisCourant = new Date().toISOString().slice(0, 8) + '01';
  dotationMois = this.moisCourant.slice(0, 7);
  dotationMontant: number | null = null;
  vignetteQuantite: number | null = null;
  // Numéros à 7 chiffres : plages et/ou numéros isolés (16/10/2026) — un lot
  // acheté n'est pas forcément une suite continue.
  vignetteNumeros = '';

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.filtreDossierId.set(params.get('dossier'));
    this.filtreDossierNumero.set(params.get('dossierLabel'));
    // 24/10/2026 — lien « À décaisser » de l'état mensuel des charges.
    this.filtreStatut = params.get('statut') ?? '';
    this.charger();
    this.api.comptesBancaires().subscribe({ next: (c) => this.comptes.set(c) });
    this.api.moyensDecaissement().subscribe({ next: (m) => this.catalogue.set(m), error: () => {} });
    this.chargerCaisse();
    if (this.auth.peut('depenses.petite_caisse.doter')) { this.chargerRapprochements(); this.chargerDotations(); }
    this.chargerAchatsVignettes();
    this.chargerUtilisationsVignettes();
    this.chargerStockVignettes();
  }

  chargerStockVignettes(): void {
    this.api.stockVignettes().subscribe({ next: (v) => { this.stockVignettes.set(v.stock); this.seuilVignettes.set(v.seuil); } });
  }

  charger(): void {
    const dossierId = this.filtreDossierId();
    this.api.depenses({
      statut: this.filtreStatut, type: this.filtreType, categorie: this.filtreCategorie, nature: this.filtreNature,
      petite_caisse: this.filtreCaisse, du: this.filtreDu, au: this.filtreAu, q: this.filtreRecherche.trim(),
      masquer_annulees: this.masquerAnnulees, ...(dossierId ? { dossier_id: dossierId } : {}),
    }).subscribe({ next: (d) => this.depenses.set(d) });
    this.chargerADecaisser();
  }
  // Recherche texte : on attend la fin de la frappe avant d'interroger le serveur.
  chargerRecherche(): void {
    clearTimeout(this.minuteurRecherche);
    this.minuteurRecherche = setTimeout(() => this.charger(), 300);
  }
  rechercherMaintenant(): void { clearTimeout(this.minuteurRecherche); this.charger(); }
  filtresActifs(): boolean {
    return !!(this.filtreStatut || this.filtreType || this.filtreCategorie || this.filtreNature || this.filtreCaisse || this.filtreDu || this.filtreAu || this.filtreRecherche.trim() || this.masquerAnnulees);
  }
  reinitialiserFiltres(): void {
    this.filtreStatut = this.filtreType = this.filtreCategorie = this.filtreNature = this.filtreCaisse = this.filtreDu = this.filtreAu = this.filtreRecherche = '';
    this.masquerAnnulees = false;
    this.charger();
  }
  // Total de la liste affichée : les dépenses annulées ou rejetées ne comptent pas.
  private comptees(): any[] { return this.depenses().filter((d) => !d.annulee_le && d.statut !== 'rejetee'); }
  totalAffiche(): number { return this.comptees().reduce((s, d) => s + Number(d.montant), 0); }
  nbCompte(): number { return this.comptees().length; }
  // Tuile « à décaisser » : dépenses validées (états approuvés compris) qui attendent leur paiement.
  chargerADecaisser(): void {
    this.api.depenses({ statut: 'validee' }).subscribe({
      next: (l) => this.aDecaisser.set({ nb: l.length, total: l.reduce((s, d) => s + Number(d.montant), 0) }),
      error: () => {},
    });
  }
  voirADecaisser(): void { this.reinitialiserFiltres(); this.filtreStatut = 'validee'; this.charger(); }

  chargerCaisse(): void {
    this.api.petiteCaisse(this.moisCourant).subscribe({ next: (c) => this.caisse.set(c) });
  }

  // 28/09/2026 — audit menu par menu : catégorie/statut affichés en code
  // ENUM brut, motif déjà corrigé sur d'autres modules de l'appli.
  readonly categoriesCabinet = CATEGORIES_CABINET;
  readonly categoriesDebours = CATEGORIES_DEBOURS;
  libelleCategorie(c: string): string { return libelleCategorieDepense(c); }
  private readonly libellesStatut: Record<string, string> = {
    soumise: 'Soumise', validee: 'Validée — à décaisser', rejetee: 'Rejetée', decaissee: 'Décaissée',
  };
  libelleStatut(s: string): string { return this.libellesStatut[s] ?? s; }

  creer(): void {
    this.erreur.set('');
    this.doublonsDepense.set([]);
    this.api.verifierDoublonDepense(this.form).subscribe({
      next: (d) => { if (d.length) this.doublonsDepense.set(d); else this.creerReellement(); },
      error: () => this.creerReellement(),
    });
  }

  creerQuandMeme(): void {
    this.doublonsDepense.set([]);
    this.creerReellement();
  }

  private creerReellement(): void {
    this.creationEnCours.set(true);
    this.api.creerDepense(this.form).subscribe({
      next: () => {
        this.creationEnCours.set(false);
        this.afficherForm.set(false);
        this.form = { type: 'ponctuelle', categorie: 'autre', nature: 'cabinet' };
        this.doublonsDepense.set([]);
        this.charger();
        this.chargerCaisse();
      },
      error: (e) => { this.creationEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Soumission impossible.'); },
    });
  }

  // Menu "⋮" (19/09/2026).
  actionsPour(d: any): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];
    items.push({ label: d.nb_pieces ? `Pièces (${d.nb_pieces})` : 'Pièces / devis', action: () => this.ouvrirPieces(d) });
    if (d.apres_coup_statut === 'a_valider' && this.auth.peut('depenses.decision') && d.engagee_par_id !== this.auth.utilisateur()?.id) {
      items.push({ label: 'Valider après coup', action: () => this.validerApresCoup(d, 'validee') });
      items.push({ label: 'Contester', action: () => this.validerApresCoup(d, 'contestee'), danger: true });
    }
    if (d.statut === 'soumise' && this.auth.peut('depenses.decision')) {
      items.push({ label: 'Valider', action: () => this.decision(d, 'validee') });
      items.push({ label: 'Rejeter', action: () => this.decision(d, 'rejetee'), danger: true });
    }
    if (d.statut === 'validee' && this.auth.peut('depenses.decaisser')) {
      items.push({ label: 'Décaisser', action: () => this.ouvrirDecaissement(d) });
    }
    if (this.auth.peut('depenses.decision') && (d.statut === 'validee' || d.statut === 'decaissee') && !d.annulee_le && !d.facture_id) {
      items.push({ label: 'Annuler (avec motif)', action: () => this.annulerDepense(d), danger: true });
    }
    if (d.statut === 'soumise' && (d.soumis_par_id === this.auth.utilisateur()?.id || this.auth.peut('depenses.decision'))) {
      items.push({ label: 'Modifier', action: () => this.commencerEdition(d) });
      items.push({ label: 'Retirer', action: () => this.retirer(d), danger: true });
    }
    return items;
  }

  // Annulation, dotations, achats de vignettes (17/10/2026).
  annulerDepense(d: any): void {
    const motif = window.prompt(`Annuler la dépense « ${d.libelle} » (${Number(d.montant).toLocaleString('fr-FR')} FCFA).\nMotif de l'annulation (obligatoire) :`);
    if (!motif || !motif.trim()) return;
    this.erreur.set('');
    this.api.annulerDepense(d.id, motif.trim()).subscribe({
      next: () => { this.charger(); this.chargerCaisse(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Annulation impossible.'),
    });
  }
  readonly dotations = signal<any[]>([]);
  chargerDotations(): void { this.api.dotationsPetiteCaisse().subscribe({ next: (r) => this.dotations.set(r), error: () => {} }); }
  readonly dotationCorrection = signal('');
  corrigerDotation(dt: any): void {
    this.dotationMois = String(dt.mois).slice(0, 7);
    this.dotationMontant = Number(dt.montant_alloue);
    this.dotationCorrection.set(`Correction de la dotation ${String(dt.mois).slice(5, 7)}/${String(dt.mois).slice(0, 4)} : modifiez le montant ci-dessus puis cliquez sur « Enregistrer ».`);
    // Amène le formulaire (et non le haut de la page) à l'écran et place le curseur dans le montant.
    setTimeout(() => {
      document.getElementById('formDotation')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (document.getElementById('champDotation') as HTMLInputElement | null)?.focus();
    }, 50);
  }
  readonly achatsVignettes = signal<any[]>([]);
  chargerAchatsVignettes(): void {
    if (this.auth.peut('depenses.vignettes.mouvement')) this.api.achatsVignettes().subscribe({ next: (r) => this.achatsVignettes.set(r), error: () => {} });
  }
  readonly utilisationsVignettes = signal<any[]>([]);
  chargerUtilisationsVignettes(): void {
    if (this.auth.peut('depenses.vignettes.mouvement')) this.api.utilisationsVignettes().subscribe({ next: (r) => this.utilisationsVignettes.set(r), error: () => {} });
  }
  pad7(n: number): string { return String(n).padStart(7, '0'); }
  annulerUtilisation(u: any): void {
    const num = u.numero_vignette ? ' n°' + this.pad7(u.numero_vignette) : '';
    if (!confirm(`Annuler l’utilisation de la vignette${num} ? Elle sera remise en stock et la dépense correspondante supprimée.`)) return;
    this.erreur.set('');
    this.api.annulerUtilisationVignette(u.id).subscribe({
      next: () => { this.chargerUtilisationsVignettes(); this.chargerAchatsVignettes(); this.chargerStockVignettes(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Annulation impossible.'),
    });
  }
  supprimerAchat(a: any): void {
    if (!confirm(`Supprimer cet achat de ${a.quantite} vignette(s) ?`)) return;
    this.erreur.set('');
    this.api.supprimerAchatVignettes(a.id).subscribe({
      next: () => { this.chargerAchatsVignettes(); this.chargerStockVignettes(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Suppression impossible.'),
    });
  }

  // Petite caisse renforcée (17/10/2026).
  engagement: any = { nature: 'cabinet', mode_paiement: 'orange_money' };
  readonly engagementEnCours = signal(false);
  readonly engagementMessage = signal('');
  engager(): void {
    if (this.engagementEnCours()) return;
    this.erreur.set(''); this.engagementMessage.set('');
    this.engagementEnCours.set(true);
    this.api.engagerDepense(this.engagement).subscribe({
      next: (r) => {
        this.engagementEnCours.set(false);
        this.engagementMessage.set(`Dépense engagée — solde restant : ${Number(r.solde_restant).toLocaleString('fr-FR')} FCFA. Elle doit être validée par un autre associé.`);
        this.engagement = { nature: 'cabinet', mode_paiement: this.engagement.mode_paiement };
        this.charger(); this.chargerCaisse();
      },
      error: (e) => { this.engagementEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Engagement impossible.'); },
    });
  }
  validerApresCoup(d: any, decision: 'validee' | 'contestee'): void {
    let motif: string | undefined;
    if (decision === 'contestee') {
      motif = window.prompt('Motif de la contestation (obligatoire) :') || undefined;
      if (!motif) return;
    }
    this.erreur.set('');
    this.api.validerDepenseApresCoup(d.id, decision, motif).subscribe({
      next: () => this.charger(),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Action impossible.'),
    });
  }
  readonly rapprochements = signal<any[]>([]);
  rapSoldeReel: number | null = null;
  rapNote = '';
  readonly rapEnCours = signal(false);
  chargerRapprochements(): void {
    this.api.rapprochementsPetiteCaisse().subscribe({ next: (r) => this.rapprochements.set(r), error: () => {} });
  }
  rapprocher(): void {
    if (this.rapSoldeReel === null || this.rapEnCours()) return;
    this.rapEnCours.set(true);
    this.api.rapprocherPetiteCaisse({ solde_reel: this.rapSoldeReel, note: this.rapNote || undefined }).subscribe({
      next: () => { this.rapEnCours.set(false); this.rapSoldeReel = null; this.rapNote = ''; this.chargerRapprochements(); },
      error: (e) => { this.rapEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Enregistrement impossible.'); },
    });
  }

  // Pièces d'une dépense (16/10/2026).
  readonly piecesId = signal<string | null>(null);
  readonly pieces = signal<any[]>([]);
  readonly pieceEnCours = signal(false);
  pieceType = 'facture';
  pieceFichier: File | null = null;
  libellePiece(t: string): string {
    return ({ devis: 'Devis', facture: 'Facture', preuve_paiement: 'Preuve de paiement', autre: 'Autre' } as any)[t] ?? t;
  }
  ouvrirPieces(d: any): void {
    this.erreur.set('');
    this.pieceFichier = null;
    this.pieceType = d.statut === 'soumise' ? 'devis' : 'facture';
    this.piecesId.set(d.id);
    this.chargerPieces(d.id);
  }
  chargerPieces(id: string): void {
    this.api.piecesDepense(id).subscribe({ next: (p) => this.pieces.set(p), error: () => this.pieces.set([]) });
  }
  choisirPiece(ev: Event): void { this.pieceFichier = (ev.target as HTMLInputElement).files?.[0] ?? null; }
  ajouterPiece(d: any): void {
    if (!this.pieceFichier || this.pieceEnCours()) return;
    this.erreur.set('');
    this.pieceEnCours.set(true);
    this.api.ajouterPieceDepense(d.id, this.pieceType, this.pieceFichier).subscribe({
      next: () => { this.pieceEnCours.set(false); this.pieceFichier = null; this.chargerPieces(d.id); this.charger(); },
      error: (e) => { this.pieceEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Ajout impossible.'); },
    });
  }
  actionsPourPiece(d: any, p: any): ActionMenuItem[] {
    const items: ActionMenuItem[] = [
      { label: 'Aperçu', action: () => this.preview.ouvrir(p.nom, this.api.telechargerPieceDepense(d.id, p.id)) },
    ];
    if (p.type === 'devis' && !p.retenu && d.statut === 'soumise' && this.auth.peut('depenses.decision')) {
      items.push({ label: 'Retenir ce devis', action: () => this.retenirDevis(d, p) });
    }
    if (d.statut === 'soumise' || this.auth.peut('depenses.decision')) {
      items.push({ label: 'Retirer', danger: true, action: () => this.retirerPiece(d, p) });
    }
    return items;
  }
  retenirDevis(d: any, p: any): void {
    this.erreur.set('');
    this.api.retenirDevisDepense(d.id, p.id).subscribe({
      next: () => { this.chargerPieces(d.id); this.charger(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Choix impossible.'),
    });
  }
  retirerPiece(d: any, p: any): void {
    if (!confirm(`Retirer la pièce « ${p.nom} » ?`)) return;
    this.erreur.set('');
    this.api.retirerPieceDepense(d.id, p.id).subscribe({
      next: () => { this.chargerPieces(d.id); this.charger(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Retrait impossible.'),
    });
  }

  // Retirer une dépense soumise par erreur, avant décision (25/09/2026).
  retirer(d: any): void {
    if (!confirm(`Retirer la dépense « ${d.libelle} » ?`)) return;
    this.erreur.set('');
    this.api.retirerDepense(d.id).subscribe({
      next: () => this.charger(),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Retrait impossible.'),
    });
  }

  decision(d: any, statut: 'validee' | 'rejetee'): void {
    this.api.decisionDepense(d.id, { statut }).subscribe({
      next: () => this.charger(),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Décision impossible (rôle gérant requis).'),
    });
  }

  // Décaissement (20/10/2026) : le moyen, le compte et les références sont précisés
  // au moment où l'argent sort (préremplis depuis la dépense).
  readonly decaissementId = signal<string | null>(null);
  readonly decEnCours = signal(false);
  readonly decValide = signal(false);
  decModele: any = {};
  ouvrirDecaissement(d: any): void {
    this.erreur.set('');
    this.decModele = { mode_paiement: d.mode_paiement ?? '', compte_id: d.compte_id ?? '', references: { ...(d.beneficiaire ? { beneficiaire: d.beneficiaire } : {}), ...(d.references_paiement ?? {}) } };
    this.decaissementId.set(d.id);
  }
  confirmerDecaissement(d: any): void {
    if (this.decEnCours()) return;
    this.erreur.set('');
    this.decEnCours.set(true);
    const m = this.decModele;
    this.api.decaisserDepense(d.id, { mode_paiement: m.mode_paiement, compte_id: m.compte_id || null, references: m.references }).subscribe({
      next: () => { this.decEnCours.set(false); this.decaissementId.set(null); this.charger(); this.chargerCaisse(); },
      error: (e) => { this.decEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Décaissement impossible.'); },
    });
  }

  readonly editionId = signal<string | null>(null);
  readonly editionEnCours = signal(false);
  editForm: any = {};
  // 28/09/2026 — audit menu par menu : le formulaire d'édition n'exposait
  // que 4 des 11 champs pourtant acceptés par PUT /api/depenses/:id —
  // corriger un mauvais compte/mode de paiement, ou une case petite
  // caisse/justificatif/refacturable cochée par erreur, exigeait jusqu'ici
  // de retirer la dépense et de la ressaisir entièrement.
  commencerEdition(d: any): void {
    this.erreur.set('');
    this.editForm = {
      type: d.type, categorie: d.categorie, libelle: d.libelle, montant: d.montant,
      date_depense: d.date_depense, compte_id: d.compte_id ?? '', mode_paiement: d.mode_paiement ?? '', references: { ...(d.references_paiement ?? {}) },
      petite_caisse: d.petite_caisse, justificatif: d.justificatif, refacturable_client: d.refacturable_client,
      nature: d.nature ?? (d.dossier_id ? 'dossier' : 'cabinet'), dossier_id: d.dossier_id ?? null,
      beneficiaire: d.beneficiaire ?? '',
    };
    this.editionId.set(d.id);
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
    this.api.majDepense(id, this.editForm).subscribe({
      next: () => { this.editionEnCours.set(false); this.editionId.set(null); this.editForm = {}; this.charger(); },
      error: (e) => { this.editionEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Modification impossible.'); },
    });
  }

  // 28/09/2026 — audit menu par menu : aucune gestion d'erreur ni garde
  // anti-double-clic sur ces 2 formulaires, contrairement à creer() qui
  // les a reçues le 26/09/2026 dans ce même fichier.
  readonly dotationEnCours = signal(false);
  definirDotation(): void {
    if (this.dotationMontant === null || this.dotationMontant === undefined || (this.dotationMontant as any) === '' || this.dotationEnCours()) return;
    this.erreur.set('');
    this.dotationEnCours.set(true);
    this.api.definirDotationCaisse(this.dotationMois, this.dotationMontant).subscribe({
      next: () => { this.dotationEnCours.set(false); this.dotationMontant = null; this.dotationCorrection.set(''); this.chargerCaisse(); this.chargerDotations(); },
      error: (e) => { this.dotationEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Dotation impossible.'); },
    });
  }

  readonly vignetteEnCours = signal(false);
  approvisionnerVignette(): void {
    if (this.vignetteEnCours()) return;
    if (!this.vignetteQuantite && !this.vignetteNumeros.trim()) return;
    this.erreur.set('');
    this.vignetteEnCours.set(true);
    this.api.approvisionnerVignettes({
      quantite: this.vignetteNumeros.trim() ? undefined : (this.vignetteQuantite ?? undefined),
      numeros: this.vignetteNumeros.trim() || undefined,
    }).subscribe({
      next: () => {
        this.vignetteEnCours.set(false);
        this.vignetteQuantite = null;
        this.vignetteNumeros = '';
        this.chargerStockVignettes();
        this.chargerAchatsVignettes();
      },
      error: (e) => { this.vignetteEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Approvisionnement impossible.'); },
    });
  }
}
