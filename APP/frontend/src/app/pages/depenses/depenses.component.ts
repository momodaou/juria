import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, MoyenPaiement } from '../../core/api.service';
import { ReglementFormComponent } from '../../core/reglement-form.component';
import { AuthService } from '../../core/auth.service';
import { RaccourcisClavierDirective } from '../../core/raccourcis-clavier.directive';
import { MenuActionsComponent, ActionMenuItem } from '../../core/menu-actions.component';
import { CATEGORIES_CABINET, CATEGORIES_DEBOURS, CATEGORIES_DEPENSE, CategorieDepense, libelleCategorieDepense, PRECISIONS_GREFFE, libellePrecisionGreffe } from '../../core/categories-depense';
import { DossierPickerComponent } from '../../core/dossier-picker.component';
import { viserElement } from '../../core/cible-notification';
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

    <div class="onglets" role="tablist">
      <button type="button" class="onglet" role="tab" [class.actif]="onglet() === 'cabinet'" (click)="changerOnglet('cabinet')">
        Dépenses du cabinet @if (aTraiter('cabinet')) { <span class="pastille">{{ aTraiter('cabinet') }}</span> }
      </button>
      <button type="button" class="onglet" role="tab" [class.actif]="onglet() === 'caisse'" (click)="changerOnglet('caisse')">
        Petite caisse @if (aTraiter('petite_caisse')) { <span class="pastille">{{ aTraiter('petite_caisse') }}</span> }
      </button>
      <button type="button" class="onglet" role="tab" [class.actif]="onglet() === 'procedure'" (click)="changerOnglet('procedure')">
        Frais de justice &amp; débours @if (aTraiter('procedure')) { <span class="pastille">{{ aTraiter('procedure') }}</span> }
      </button>
      <button type="button" class="onglet" role="tab" [class.actif]="onglet() === 'tout'" (click)="changerOnglet('tout')">Tout</button>
    </div>

    <div class="kpis">
      @if (onglet() === 'caisse' || onglet() === 'procedure') {
        <div class="kpi">
          <div class="n">{{ caisseActive()?.dotation ?? 0 | number }}</div>
          <div class="l">Dotation {{ nomCaisseMin() }} ({{ moisCourant.slice(0,7) }})</div>
        </div>
        <div class="kpi amber">
          <div class="n">{{ caisseActive()?.depense ?? 0 | number }}</div>
          <div class="l">{{ nomCaisse() }} : dépensé ce mois</div>
        </div>
        <div class="kpi" [class.red]="(caisseActive()?.solde ?? 0) < 0" [class.green]="(caisseActive()?.solde ?? 0) >= 0">
          <div class="n">{{ caisseActive()?.solde ?? 0 | number }}</div>
          <div class="l">Solde {{ nomCaisseMin() }}</div>
        </div>
        @if (auth.peut('depenses.decision')) {
          <div class="kpi amber cliquable" (click)="voir({ apres_coup: 'a_valider' })" title="Afficher les dépenses engagées à valider après coup">
            <div class="n">{{ sy(groupeCaisse(), 'apres_coup').nb }}</div>
            <div class="l">À valider après coup — {{ sy(groupeCaisse(), 'apres_coup').total | number }} FCFA</div>
          </div>
        }
        <div class="kpi cliquable" (click)="voir({ statut: 'validee', ordre: 'donne' })" title="Afficher les dépenses validées à décaisser">
          <div class="n">{{ sy(groupeCaisse(), 'decaisser').nb }}</div>
          <div class="l">À décaisser (circuit normal) — {{ sy(groupeCaisse(), 'decaisser').total | number }} FCFA</div>
        </div>
        @if (onglet() === 'procedure') {
          <div class="kpi" [class.red]="stockVignettes() <= seuilVignettes()" [class.amber]="stockVignettes() > seuilVignettes() && nbAAffecter() > 0" [class.blue]="stockVignettes() > seuilVignettes() && nbAAffecter() === 0">
            <div class="n">{{ nbAAffecter() }}</div>
            <div class="l">Vignettes à affecter — stock : {{ stockVignettes() }} {{ stockVignettes() <= seuilVignettes() ? '(stock bas, seuil ' + seuilVignettes() + ')' : '' }}</div>
          </div>
        }
      } @else {
        @if (auth.peut('depenses.decision')) {
          <div class="kpi amber cliquable" (click)="voir({ statut: 'soumise' })" title="Afficher les dépenses soumises, à décider">
            <div class="n">{{ somme('decider').nb }}</div>
            <div class="l">À décider — {{ somme('decider').total | number }} FCFA</div>
          </div>
          <div class="kpi amber cliquable" (click)="voir({ statut: 'validee', ordre: 'sans_ordre' })" title="Afficher les dépenses validées sans ordre de paiement">
            <div class="n">{{ somme('ordonner').nb }}</div>
            <div class="l">Ordre de paiement à donner — {{ somme('ordonner').total | number }} FCFA</div>
          </div>
        }
        <div class="kpi amber cliquable" (click)="voir({ statut: 'validee', ordre: 'donne' })" title="Afficher les dépenses validées en attente de décaissement">
          <div class="n">{{ somme('decaisser').total | number }}</div>
          <div class="l">À décaisser — {{ somme('decaisser').nb }} dépense(s)</div>
        </div>
        <div class="kpi green cliquable" (click)="voir({ statut: 'decaissee' })" title="Afficher les dépenses décaissées">
          <div class="n">{{ somme('decaisse_mois').total | number }}</div>
          <div class="l">Décaissé ce mois — {{ somme('decaisse_mois').nb }} dépense(s)</div>
        </div>
        @if (onglet() === 'tout') {
          <div class="kpi" [class.red]="(caisse()?.solde ?? 0) < 0">
            <div class="n">{{ caisse()?.solde ?? 0 | number }}</div>
            <div class="l">Solde petite caisse</div>
          </div>
        }
      }
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
              <optgroup label="Débours et frais de procédure">@for (c of categoriesDeboursSaisie; track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }</optgroup>
            </select>
          </div>
          @if (form.categorie === 'frais_greffe') {
            <div>
              <label>Frais de greffe concerné <span style="color:#b13a36">*</span></label>
              <select class="in" [(ngModel)]="form.precision_nature" name="precisionNature">
                <option [ngValue]="undefined">— À choisir —</option>
                @for (p of precisionsGreffe; track p.code) { <option [value]="p.code">{{ p.libelle }}</option> }
              </select>
            </div>
          }
          <div class="col2"><label>Libellé</label><input class="in" [(ngModel)]="form.libelle" name="libelle" /></div>
          <div><label>Bénéficiaire (facultatif)</label><input class="in" maxlength="160" [(ngModel)]="form.beneficiaire" name="beneficiaire" placeholder="Fournisseur ou personne payée" /></div>
          <div><label>Montant (FCFA)</label><input class="in" type="number" [(ngModel)]="form.montant" name="montant" /></div>
          <div><label>Date</label><input class="in" type="date" [(ngModel)]="form.date_depense" name="date" /></div>
          @if (auth.peut('depenses.decision')) {
            <app-reglement-form sens="decaissement" cleMode="mode_paiement" [exigerReferences]="false" [masquerReferences]="true" [exigerMoyen]="false"
                                [modele]="form" [catalogue]="catalogue()"></app-reglement-form>
          }
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
            <label><input type="checkbox" [(ngModel)]="form.petite_caisse" name="pc" /> Sur petite caisse@if (form.petite_caisse) { <span class="muted"> — natures limitées (voir Seuils)</span> }</label>
            @if (form.nature === 'dossier') { <label><input type="checkbox" [(ngModel)]="form.refacturable_client" name="refact" /> À refacturer au client en plus des honoraires</label> }
          </div>
        </div>
        <button class="btn" (click)="creer()" [disabled]="!form.libelle || !form.montant || (form.nature === 'dossier' && !form.dossier_id) || (form.categorie === 'frais_greffe' && !form.precision_nature) || creationEnCours()">{{ creationEnCours() ? 'Soumission…' : 'Soumettre' }}</button>
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
        @if (onglet() === 'tout') {
        <select class="in filtre" [(ngModel)]="filtreCaisse" (ngModelChange)="charger()">
          <option value="">Toutes sources</option>
          <option value="cabinet">Dépenses du cabinet</option>
          <option value="petite_caisse">Petite caisse</option>
          <option value="procedure">Frais de justice &amp; débours</option>
        </select>
        }
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
        @if (messageCible()) { <p class="bandeau-filtre">{{ messageCible() }}</p> }
        <table>
          <tr><th>Date</th><th>Libellé</th><th>Catégorie</th><th>Montant</th><th>Nature / dossier</th><th>Pièces</th><th>Statut</th><th></th></tr>
          @for (d of depenses(); track d.id) {
            <tr [id]="'depense-' + d.id" [class.annulee]="!!d.annulee_le">
              <td>{{ d.date_depense | date:'dd/MM/yyyy' }}</td>
              <td>{{ d.libelle }}@if (d.beneficiaire) { <span class="muted"> — {{ d.beneficiaire }}</span> } @if (d.petite_caisse) { <span class="tag">petite caisse</span> }@if (d.caisse_procedure) { <span class="tag">frais de justice</span> }@if (d.mode_paiement) { <br /><span class="muted">{{ libelleMoyen(d.mode_paiement) }}@if (d.compte) { · {{ d.compte }} }</span> }
                @if (d.etat_mois) { <span class="tag">État {{ d.etat_mois | date:'MM/yyyy' }}</span> }
                @if (d.annulee_le) { <div class="obs">Annulée le {{ d.annulee_le | date:'dd/MM/yyyy' }}@if (d.annulee_par_nom) { par {{ d.annulee_par_nom }} }@if (d.annulation_motif) { — {{ d.annulation_motif }} }</div> }
                @else if (d.statut === 'rejetee' && d.motif_rejet) { <div class="obs">Rejetée : {{ d.motif_rejet }}</div> }
              </td>
              <td>{{ libelleCategorie(d.categorie) }}@if (d.precision_nature) { <span class="muted"> — {{ libellePrecision(d.precision_nature) }}</span> }</td>
              <td>{{ d.montant | number }} FCFA</td>
              <td>@if (d.dossier_id) { <a class="lien" [routerLink]="['/dossiers', d.dossier_id]">{{ d.dossier_numero }}</a> } @else { <span class="tag">Cabinet</span> }</td>
              <td>@if (d.nb_pieces) { 📎 {{ d.nb_pieces }} @if (d.nb_devis) { <span class="tag" [class.ok]="d.devis_retenu">{{ d.nb_devis }} devis{{ d.devis_retenu ? ' — 1 retenu' : '' }}</span> } } @else { <span class="muted">—</span> }</td>
              <td>@if (d.annulee_le) { <span class="tag haute" [title]="'Annulée : ' + (d.annulation_motif || '')">Annulée</span> } @else { <span class="tag" [class.ok]="d.statut==='decaissee'" [class.haute]="d.statut==='rejetee'">{{ libelleStatutDepense(d) }}</span> }
                @if (!d.annulee_le && d.statut === 'validee' && d.blocage_le) { {{ ' ' }}<span class="tag haute" [title]="d.blocage_motif || ''">Bloquée</span> }
                @if (!d.annulee_le && d.apres_coup_statut === 'a_valider') { {{ ' ' }}<span class="tag attente" title="Dépense engagée sur la petite caisse, en attente de validation par un associé">À valider après coup</span> }
                @if (d.apres_coup_statut === 'validee') { {{ ' ' }}<span class="tag ok">Validée après coup</span> }
                @if (d.apres_coup_statut === 'contestee') { {{ ' ' }}<span class="tag haute" [title]="d.apres_coup_motif || ''">Contestée</span> }
              </td>
              <td><app-menu-actions [actions]="actionsPour(d)" /></td>
            </tr>
            @if (panneauId() === d.id) {
              <tr class="edition">
                <td colspan="8">
                  @if (panneauMode() === 'apres_valider' || panneauMode() === 'apres_contester') {
                    <b>{{ panneauMode() === 'apres_valider' ? 'Valider après coup' : 'Contester' }} — {{ d.libelle }} ({{ d.montant | number }} FCFA)</b>
                    @if (voisines(); as v) {
                      @if (v.voisines.length) {
                        <p class="muted">Dépenses rapprochées sur la caisse (autour du {{ d.date_depense | date:'dd/MM/yyyy' }}, {{ v.fenetre_jours }} jours) : même bénéficiaire, même dossier, ou même engageur et même nature.</p>
                        <table>
                          <tr><th>Date</th><th>Libellé</th><th>Montant</th><th>Engagée par</th><th></th></tr>
                          @for (x of v.voisines; track x.id) {
                            <tr>
                              <td>{{ x.date_depense | date:'dd/MM/yyyy' }}</td><td>{{ x.libelle }}</td><td>{{ x.montant | number }} FCFA</td><td>{{ x.engageur || '—' }}</td>
                              <td>@if (x.meme_beneficiaire) { <span class="tag attente">même bénéficiaire</span> } @if (x.meme_dossier) { <span class="tag attente">même dossier</span> }</td>
                            </tr>
                          }
                        </table>
                        <p [class.err]="v.plafond != null && v.cumul_meme_nature_beneficiaire > v.plafond">Cumul même nature et même bénéficiaire : <b>{{ v.cumul_meme_nature_beneficiaire | number }} FCFA</b>@if (v.plafond != null) { (plafond par dépense : {{ v.plafond | number }} FCFA) }@if (v.plafond != null && v.cumul_meme_nature_beneficiaire > v.plafond) { — fractionnement possible }</p>
                      } @else { <p class="muted">Aucune dépense rapprochée sur la caisse.</p> }
                    }
                    @if (panneauMode() === 'apres_contester') {
                      <p class="muted">Le motif est obligatoire : il est communiqué à la personne qui a engagé la dépense.</p>
                      <textarea class="in" rows="2" maxlength="300" [(ngModel)]="panneauMotif" name="panMotifApres"></textarea>
                    }
                  } @else if (panneauMode() === 'rejeter') {
                    <b>Rejeter — {{ d.libelle }} ({{ d.montant | number }} FCFA)</b>
                    <p class="muted">Le motif est obligatoire : il est communiqué à la personne qui a déposé la dépense.</p>
                    <textarea class="in" rows="2" maxlength="300" [(ngModel)]="panneauMotif" name="panMotif"></textarea>
                  } @else {
                    <b>{{ panneauMode() === 'ordre' ? 'Ordre de paiement' : 'Valider' }} — {{ d.libelle }} ({{ d.montant | number }} FCFA)</b>
                    <p class="muted">{{ panneauAide() }}</p>
                    <div class="grid2">
                      <app-reglement-form sens="decaissement" cleMode="mode_paiement" [exigerReferences]="false" [masquerReferences]="true" [exigerMoyen]="false"
                                          [modele]="panModele" [catalogue]="catalogue()" (validite)="panValide.set($event)"></app-reglement-form>
                    </div>
                  }
                  <div class="btns-ligne">
                    <button class="btn" (click)="confirmerPanneau(d)" [disabled]="!panneauPret() || panneauEnCours()">{{ panneauEnCours() ? 'Enregistrement…' : libelleBoutonPanneau() }}</button>
                    <button class="lien" (click)="panneauId.set(null)">Annuler</button>
                  </div>
                  @if (erreur()) { <p class="err">{{ erreur() }}</p> }
                </td>
              </tr>
            }
            @if (decaissementId() === d.id) {
              <tr class="edition">
                <td colspan="8">
                  <b>Décaisser — {{ d.libelle }} ({{ d.montant | number }} FCFA)</b>
                  @if (decSimple(d)) {
                    <p class="muted">Paiement ordonné par les associés. Effectuez-le, puis renseignez ici les références de l'opération.</p>
                    <p><b>Moyen :</b> {{ libelleMoyen(d.mode_paiement) }}@if (d.compte) { · <b>Compte :</b> {{ d.compte }} }</p>
                    <div class="grid2">
                      @for (c of champsMoyen(d.mode_paiement); track c.cle) {
                        <div><label>{{ c.libelle }}@if (c.requis) { <span> *</span> }</label>
                          <input class="in" [type]="c.type === 'date' ? 'date' : 'text'" [(ngModel)]="decModele.references[c.cle]" [name]="'decref_' + c.cle" /></div>
                      }
                    </div>
                  } @else {
                    <p class="muted">Précisez le moyen de paiement et ses références : l'argent sort maintenant.</p>
                    <div class="grid2">
                      <app-reglement-form sens="decaissement" cleMode="mode_paiement" [modele]="decModele" [catalogue]="catalogue()" (validite)="decValide.set($event)"></app-reglement-form>
                    </div>
                  }
                  <div class="btns-ligne">
                    <button class="btn" (click)="confirmerDecaissement(d)" [disabled]="(decSimple(d) ? !refsExecutantOk(d) : !decValide()) || decEnCours()">{{ decEnCours() ? 'Décaissement…' : 'Confirmer le décaissement' }}</button>
                    <button class="lien" (click)="decaissementId.set(null)">Annuler</button>
                  </div>
                  @if (erreur()) { <p class="err">{{ erreur() }}</p> }
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
              <optgroup label="Débours et frais de procédure">@for (c of categoriesDeboursSaisie; track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }</optgroup>
                      </select>
                    </div>
                    @if (editForm.categorie === 'frais_greffe') {
                      <div>
                        <label>Frais de greffe concerné <span style="color:#b13a36">*</span></label>
                        <select class="in" [(ngModel)]="editForm.precision_nature" name="edPrecisionNature">
                          <option [ngValue]="null">— À choisir —</option>
                          @for (p of precisionsGreffe; track p.code) { <option [value]="p.code">{{ p.libelle }}</option> }
                        </select>
                      </div>
                    }
                    <div class="col2"><label>Libellé</label><input class="in" [(ngModel)]="editForm.libelle" name="edLibelle" /></div>
                    <div><label>Bénéficiaire (facultatif)</label><input class="in" maxlength="160" [(ngModel)]="editForm.beneficiaire" name="edBeneficiaire" /></div>
                    <div><label>Montant (FCFA)</label><input class="in" type="number" [(ngModel)]="editForm.montant" name="edMontant" /></div>
                    <div><label>Date</label><input class="in" type="date" [(ngModel)]="editForm.date_depense" name="edDate" /></div>
                    @if (auth.peut('depenses.decision') || editionEngagee()) {
                      <app-reglement-form sens="decaissement" cleMode="mode_paiement" [exigerReferences]="false" [masquerReferences]="true" [exigerMoyen]="false"
                                          [modele]="editForm" [catalogue]="catalogue()"></app-reglement-form>
                    }
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
                      <label><input type="checkbox" [(ngModel)]="editForm.refacturable_client" name="edRefact" /> À refacturer au client en plus des honoraires</label>
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
                  @if (peutPieces(d)) {
                  <div class="grid2" style="margin-top:8px">
                    <div>
                      <label>Type de pièce</label>
                      <select class="in" [(ngModel)]="pieceType" name="pieceType">
                        <option value="devis">Devis</option>
                        <option value="facture">Facture</option>
                        <option value="preuve_paiement">Preuve de paiement</option>
                        <option value="autre">Autre</option>
                      </select>
                    </div>
                    <div><label>Fichier (PDF, image, Word, Excel)</label><input class="in" type="file" (change)="choisirPiece($event)" /></div>
                  </div>
                  <button class="btn" (click)="ajouterPiece(d)" [disabled]="!pieceFichier || pieceEnCours()">{{ pieceEnCours() ? 'Envoi…' : 'Ajouter la pièce' }}</button>
                  } @else { <p class="muted">Seuls le déposant, les associés et les personnes chargées du décaissement peuvent ajouter des pièces.</p> }
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

    @if ((onglet() === 'caisse' || onglet() === 'procedure') && auth.peut('depenses.petite_caisse.doter')) {
      <section class="panel">
        <h3>{{ nomCaisse() }} — dotation mensuelle</h3>
        <p class="muted">Mois en cours ({{ moisCourant.slice(0, 7) }}) : dotation <b>{{ caisseActive()?.dotation ?? 0 | number }}</b> FCFA · dépensé <b>{{ caisseActive()?.depense ?? 0 | number }}</b> FCFA · solde <b>{{ caisseActive()?.solde ?? 0 | number }}</b> FCFA.
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

    @if ((onglet() === 'caisse' || onglet() === 'procedure') && auth.peut('depenses.engager')) {
      <section class="panel">
        <h3>{{ nomCaisse() }} — engager une dépense</h3>
        <p class="muted">Dépense réglée tout de suite, <b>validée après coup par un associé autre que vous</b>.
          Plafond par dépense : <b>{{ caisseActive()?.plafond_depense != null ? (caisseActive()?.plafond_depense | number) + ' FCFA' : 'non défini (engagement impossible)' }}</b> ·
          solde du mois : <b>{{ caisseActive()?.solde ?? 0 | number }} FCFA</b>. Au-delà du plafond : « + Nouvelle dépense » (validation avant paiement).
          Natures acceptées : {{ libellesPC() }}. Le plafond s'applique au cumul sur {{ caisseActive()?.fenetre_jours ?? 7 }} jours (même bénéficiaire, même nature, même dossier).</p>
        <div class="grid2" appRaccourcis (entree)="engager()"
             [entreeActive]="!!engagement.libelle && !!engagement.montant && !!engagement.categorie && !!(engagement.beneficiaire || '').trim() && !(engagement.nature === 'dossier' && !engagement.dossier_id) && !engagementEnCours() && engagementValide()">
          <div class="col2"><label>Libellé</label><input class="in" [(ngModel)]="engagement.libelle" name="engLibelle" /></div>
          <div><label>Montant (FCFA)</label><input class="in" type="number" [(ngModel)]="engagement.montant" name="engMontant" /></div>
          <div>
            <label>Catégorie</label>
            <select class="in" [(ngModel)]="engagement.categorie" name="engCategorie">
              <option value="">— À choisir —</option>
              @for (c of categoriesPC(); track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }
            </select>
          </div>
          @if (engagement.categorie === 'frais_greffe') {
            <div>
              <label>Frais de greffe concerné <span style="color:#b13a36">*</span></label>
              <select class="in" [(ngModel)]="engagement.precision_nature" name="engPrecisionNature">
                <option [ngValue]="undefined">— À choisir —</option>
                @for (p of precisionsGreffe; track p.code) { <option [value]="p.code">{{ p.libelle }}</option> }
              </select>
            </div>
          }
          <div><label>Bénéficiaire <span style="color:#b13a36">*</span></label><input class="in" maxlength="160" [(ngModel)]="engagement.beneficiaire" name="engBeneficiaire" placeholder="Fournisseur ou personne payée" /></div>
          <app-reglement-form sens="decaissement" cleMode="mode_paiement" [modele]="engagement" [catalogue]="catalogue()" (validite)="engagementValide.set($event)"></app-reglement-form>
          @if (onglet() !== 'procedure') {
          <div>
            <label>Nature</label>
            <select class="in" [(ngModel)]="engagement.nature" name="engNature">
              <option value="cabinet">Charge propre au cabinet</option>
              <option value="dossier">Charge liée à un dossier</option>
            </select>
          </div>
          }
          @if (engagement.nature === 'dossier') {
            <div><label>Dossier concerné</label>
              <app-dossier-picker [valeur]="engagement.dossier_id" (valeurChange)="engagement.dossier_id = $event"></app-dossier-picker></div>
            <div class="cases"><label><input type="checkbox" [(ngModel)]="engagement.refacturable_client" name="engRefact" /> À refacturer au client en plus des honoraires</label></div>
          }
        </div>
        <button class="btn" (click)="engager()" [disabled]="!engagement.libelle || !engagement.montant || !engagement.categorie || (engagement.categorie === 'frais_greffe' && !engagement.precision_nature) || !(engagement.beneficiaire || '').trim() || (engagement.nature === 'dossier' && !engagement.dossier_id) || engagementEnCours() || !engagementValide()">{{ engagementEnCours() ? 'Enregistrement…' : 'Engager la dépense' }}</button>
        @if (engagementMessage()) { <p class="ok-msg">{{ engagementMessage() }}</p> }
        @if (erreur() && !afficherForm() && !editionId()) { <p class="err">{{ erreur() }}</p> }
      </section>
    }

    @if ((onglet() === 'caisse' || onglet() === 'procedure') && auth.peut('depenses.petite_caisse.doter')) {
      <section class="panel">
        <h3>{{ nomCaisse() }} — rapprochement mensuel</h3>
        <p class="muted">Comparez le solde calculé par JURIA (<b>{{ caisseActive()?.solde ?? 0 | number }} FCFA</b>) au solde réel du porte-monnaie mobile money (relevé de l'opérateur) ou au comptage des espèces.</p>
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

    @if (onglet() === 'procedure' && auth.peut('depenses.vignettes.mouvement')) {
    <section class="panel">
      <h3>Vignettes à affecter</h3>
      <p class="muted">Chaque procédure contentieuse ouverte attend sa vignette de plaidoirie. JURIA propose le prochain numéro du stock
        ({{ vignettesAAffecter()?.prochain_numero != null ? pad7(vignettesAAffecter()?.prochain_numero) : 'aucun numéro connu : saisissez-le depuis la fiche du dossier' }}) ;
        vous le confirmez selon la vignette physique que vous collez.</p>
      @if (vignettesAAffecter()?.instances?.length) {
        <table>
          <tr><th>Dossier</th><th>Procédure</th><th>Ouverte le</th><th></th></tr>
          @for (v of vignettesAAffecter()?.instances; track v.instance_id) {
            <tr>
              <td><a class="lien" [routerLink]="['/dossiers', v.dossier_id]">{{ v.dossier_numero }}</a><span class="muted"> — {{ v.intitule }}</span></td>
              <td>{{ libelleDegreVignette(v.degre) }}{{ v.juridiction ? ' · ' + v.juridiction : '' }}</td>
              <td>{{ v.cree_le | date:'dd/MM/yyyy' }}</td>
              <td>
                @if (!v.mode_honoraires_renseigne) { <span class="muted">Renseignez d'abord le mode d'honoraires du dossier</span> }
                @else if (vignettesAAffecter()?.prochain_numero != null) { <button class="lien" (click)="affecterVignette(v)">Affecter la n° {{ pad7(vignettesAAffecter()?.prochain_numero) }}</button> }
                @else { <a class="lien" [routerLink]="['/dossiers', v.dossier_id]">Saisir le n° depuis le dossier</a> }
              </td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucune procédure n'attend de vignette.</p> }
      @if (erreur() && !afficherForm() && !editionId()) { <p class="err">{{ erreur() }}</p> }
    </section>
    }

    @if (onglet() === 'procedure') {
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
    }
  `,
  styles: [`
    .onglets{display:flex;gap:6px;margin:4px 0 14px;border-bottom:1px solid var(--line);flex-wrap:wrap}
    .onglet{background:none;border:none;border-bottom:3px solid transparent;padding:10px 16px;font-size:var(--fs-base);font-weight:600;color:var(--slate);cursor:pointer;display:inline-flex;gap:8px;align-items:center;margin-bottom:-1px}
    .onglet.actif{color:var(--ink,#1a2740);border-bottom-color:var(--gold,#b08a4b)}
    .onglet:hover{color:var(--ink,#1a2740)}
    .pastille{background:#c0392b;color:#fff;border-radius:999px;font-size:var(--fs-2xs);padding:1px 7px;font-weight:700}
    .kpi.cliquable{cursor:pointer}
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
  readonly synthese = signal<any | null>(null);
  readonly onglet = signal<'cabinet' | 'caisse' | 'procedure' | 'tout'>('cabinet');
  readonly caisseProc = signal<any | null>(null);
  private minuteurRecherche: any = null;
  form: any = { type: 'ponctuelle', categorie: 'autre', nature: 'cabinet' };
  moisCourant = new Date().toISOString().slice(0, 8) + '01';
  dotationMois = this.moisCourant.slice(0, 7);
  dotationMontant: number | null = null;
  vignetteQuantite: number | null = null;
  // Numéros à 7 chiffres : plages et/ou numéros isolés (16/10/2026) — un lot
  // acheté n'est pas forcément une suite continue.
  vignetteNumeros = '';

  // Arrivée depuis une notification (?depense=<id>) : la ligne visée défile au centre et se surligne.
  private depenseCible: string | null = null;
  readonly messageCible = signal('');
  private viserDepense(): void {
    const id = this.depenseCible;
    if (!id) return;
    this.depenseCible = null;
    setTimeout(() => {
      if (!viserElement('depense-' + id)) this.messageCible.set('Cette dépense n’apparaît pas dans la liste : elle a été retirée, ou un filtre la masque (« Réinitialiser les filtres »).');
    }, 200);
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.filtreDossierId.set(params.get('dossier'));
    this.filtreDossierNumero.set(params.get('dossierLabel'));
    // 24/10/2026 — lien « À décaisser » de l'état mensuel des charges.
    this.filtreStatut = params.get('statut') ?? '';
    this.depenseCible = params.get('depense');
    // Onglet de départ : « tout » quand on arrive par un lien précis (dépense, statut, dossier) pour retrouver l'élément quelle que soit sa caisse ;
    // sinon l'onglet demandé, le dernier utilisé, ou « cabinet ».
    let memo: string | null = null;
    try { memo = localStorage.getItem('juria.depenses.onglet'); } catch { /* sans effet */ }
    const demande = params.get('onglet') ?? (params.get('depense') || params.get('statut') || params.get('dossier') ? 'tout' : memo);
    this.onglet.set(demande === 'caisse' || demande === 'procedure' || demande === 'tout' ? demande : 'cabinet');
    this.engagement = this.engagementVide();
    this.filtreCaisse = this.caisseDeOnglet();
    this.charger();
    this.api.moyensDecaissement().subscribe({ next: (m) => this.catalogue.set(m), error: () => {} });
    this.chargerCaisse();
    if (this.auth.peut('depenses.petite_caisse.doter')) { this.chargerRapprochements(); this.chargerDotations(); }
    this.chargerAchatsVignettes();
    this.chargerUtilisationsVignettes();
    this.chargerStockVignettes();
    this.chargerVignettesAAffecter();
  }

  // Vignettes à affecter (lot F, 11/11/2026) : proposition, jamais de décompte automatique.
  readonly vignettesAAffecter = signal<any | null>(null);
  nbAAffecter(): number { return this.vignettesAAffecter()?.instances?.length ?? 0; }
  libelleDegreVignette(d: string): string { return ({ premiere_instance: '1re instance', appel: 'Appel', cassation: 'Cassation / CCJA' } as Record<string, string>)[d] ?? d; }
  chargerVignettesAAffecter(): void {
    if (!this.auth.peut('depenses.vignettes.mouvement')) return;
    this.api.vignettesAAffecter().subscribe({ next: (r) => this.vignettesAAffecter.set(r), error: () => {} });
  }
  affecterVignette(v: any): void {
    const n = this.vignettesAAffecter()?.prochain_numero;
    if (n == null) return;
    if (!window.confirm('Affecter la vignette n° ' + this.pad7(n) + ' au dossier ' + v.dossier_numero + ' ?\n(Vérifiez que c\'est bien le numéro de la vignette que vous collez.)')) return;
    this.erreur.set('');
    this.api.enregistrerVignetteInstance(v.dossier_id, v.instance_id, n).subscribe({
      next: () => { this.chargerVignettesAAffecter(); this.chargerStockVignettes(); this.chargerAchatsVignettes(); this.chargerUtilisationsVignettes(); this.charger(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Affectation impossible.'),
    });
  }
  chargerStockVignettes(): void {
    this.api.stockVignettes().subscribe({ next: (v) => { this.stockVignettes.set(v.stock); this.seuilVignettes.set(v.seuil); } });
  }

  charger(): void {
    const dossierId = this.filtreDossierId();
    this.api.depenses({
      statut: this.filtreStatut, type: this.filtreType, categorie: this.filtreCategorie, nature: this.filtreNature,
      caisse: this.filtreCaisse, ordre: this.filtreOrdre, apres_coup: this.filtreApresCoup, du: this.filtreDu, au: this.filtreAu, q: this.filtreRecherche.trim(),
      masquer_annulees: this.masquerAnnulees, ...(dossierId ? { dossier_id: dossierId } : {}),
    }).subscribe({ next: (d) => { this.depenses.set(d); this.viserDepense(); } });
    this.chargerSynthese();
  }
  // Recherche texte : on attend la fin de la frappe avant d'interroger le serveur.
  chargerRecherche(): void {
    clearTimeout(this.minuteurRecherche);
    this.minuteurRecherche = setTimeout(() => this.charger(), 300);
  }
  rechercherMaintenant(): void { clearTimeout(this.minuteurRecherche); this.charger(); }
  filtresActifs(): boolean {
    return !!(this.filtreStatut || this.filtreOrdre || this.filtreApresCoup || this.filtreType || this.filtreCategorie || this.filtreNature || (this.filtreCaisse !== this.caisseDeOnglet()) || this.filtreDu || this.filtreAu || this.filtreRecherche.trim() || this.masquerAnnulees);
  }
  reinitialiserFiltres(): void {
    this.filtreStatut = this.filtreType = this.filtreCategorie = this.filtreNature = this.filtreDu = this.filtreAu = this.filtreRecherche = this.filtreOrdre = this.filtreApresCoup = '';
    this.filtreCaisse = this.caisseDeOnglet();
    this.masquerAnnulees = false;
    this.charger();
  }
  // Total de la liste affichée : les dépenses annulées ou rejetées ne comptent pas.
  private comptees(): any[] { return this.depenses().filter((d) => !d.annulee_le && d.statut !== 'rejetee'); }
  totalAffiche(): number { return this.comptees().reduce((s, d) => s + Number(d.montant), 0); }
  nbCompte(): number { return this.comptees().length; }
  // Onglets (lot E, 11/11/2026) : « cabinet » = hors petite caisse, « caisse » = petite caisse, « tout » = vue consolidée.
  // La comptabilité reste unique : seul l'affichage est séparé.
  chargerSynthese(): void {
    this.api.syntheseDepenses().subscribe({ next: (r) => this.synthese.set(r), error: () => {} });
  }
  sy(groupe: 'cabinet' | 'petite_caisse' | 'procedure', cle: string): { nb: number; total: number } {
    return this.synthese()?.[groupe]?.[cle] ?? { nb: 0, total: 0 };
  }
  /** Compteur de l'onglet courant : cabinet seul, petite caisse seule, ou les deux (« tout »). */
  somme(cle: string): { nb: number; total: number } {
    const a = this.sy('cabinet', cle);
    if (this.onglet() === 'cabinet') return a;
    const b = this.sy('petite_caisse', cle);
    const c = this.sy('procedure', cle);
    return { nb: a.nb + b.nb + c.nb, total: a.total + b.total + c.total };
  }
  /** Pastille de l'onglet : ce qui attend une action de la personne connectée. */
  aTraiter(groupe: 'cabinet' | 'petite_caisse' | 'procedure'): number {
    if (groupe !== 'cabinet') return this.sy(groupe, 'apres_coup').nb + this.sy(groupe, 'decider').nb;
    return this.auth.peut('depenses.decision')
      ? this.sy('cabinet', 'decider').nb + this.sy('cabinet', 'ordonner').nb
      : this.sy('cabinet', 'decaisser').nb;
  }
  private caisseDeOnglet(): string { return this.onglet() === 'cabinet' ? 'cabinet' : this.onglet() === 'caisse' ? 'petite_caisse' : this.onglet() === 'procedure' ? 'procedure' : ''; }
  // Caisse affichée dans l'onglet courant (lot D) : « petite_caisse » ou « procedure » (frais de justice & débours).
  caisseCode(): string { return this.onglet() === 'procedure' ? 'procedure' : 'petite_caisse'; }
  groupeCaisse(): 'petite_caisse' | 'procedure' { return this.onglet() === 'procedure' ? 'procedure' : 'petite_caisse'; }
  caisseActive(): any | null { return this.onglet() === 'procedure' ? this.caisseProc() : this.caisse(); }
  nomCaisse(): string { return this.onglet() === 'procedure' ? 'Frais de justice & débours' : 'Petite caisse'; }
  nomCaisseMin(): string { return this.onglet() === 'procedure' ? 'frais de justice & débours' : 'petite caisse'; }
  private engagementVide(): any {
    return this.onglet() === 'procedure'
      ? { nature: 'dossier', mode_paiement: 'especes', refacturable_client: false }
      : { nature: 'cabinet', mode_paiement: 'orange_money' };
  }
  changerOnglet(o: 'cabinet' | 'caisse' | 'procedure' | 'tout'): void {
    if (o === this.onglet()) return;
    this.onglet.set(o);
    try { localStorage.setItem('juria.depenses.onglet', o); } catch { /* sans effet */ }
    this.afficherForm.set(false);
    this.panneauId.set(null); this.decaissementId.set(null); this.editionId.set(null); this.piecesId.set(null);
    this.filtreCaisse = this.caisseDeOnglet();
    this.filtreStatut = ''; this.filtreOrdre = ''; this.filtreApresCoup = '';
    this.engagement = this.engagementVide();
    this.engagementMessage.set('');
    if (this.auth.peut('depenses.petite_caisse.doter')) { this.chargerRapprochements(); this.chargerDotations(); }
    this.charger();
  }
  filtreOrdre = '';
  filtreApresCoup = '';
  // Un clic sur une tuile filtre la liste de l'onglet courant.
  voir(f: { statut?: string; ordre?: string; apres_coup?: string }): void {
    this.reinitialiserFiltres();
    this.filtreStatut = f.statut ?? '';
    this.filtreOrdre = f.ordre ?? '';
    this.filtreApresCoup = f.apres_coup ?? '';
    this.charger();
  }

  chargerCaisse(): void {
    this.api.petiteCaisse(this.moisCourant).subscribe({ next: (c) => this.caisse.set(c) });
    this.api.petiteCaisse(this.moisCourant, 'procedure').subscribe({ next: (c) => this.caisseProc.set(c), error: () => {} });
  }

  // 28/09/2026 — audit menu par menu : catégorie/statut affichés en code
  // ENUM brut, motif déjà corrigé sur d'autres modules de l'appli.
  readonly categoriesCabinet = CATEGORIES_CABINET;
  readonly categoriesDebours = CATEGORIES_DEBOURS;
  // Saisie : sans la vignette (sa dépense naît à l'affectation à une instance, jamais saisie à la main).
  readonly categoriesDeboursSaisie = CATEGORIES_DEBOURS.filter((c) => c.code !== 'vignette_plaidoirie');
  readonly precisionsGreffe = PRECISIONS_GREFFE;
  libelleCategorie(c: string): string { return libelleCategorieDepense(c); }
  libellePrecision(c: string): string { return libellePrecisionGreffe(c); }
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
      items.push({ label: 'Valider après coup', action: () => this.ouvrirPanneau(d, 'apres_valider') });
      items.push({ label: 'Contester', action: () => this.ouvrirPanneau(d, 'apres_contester'), danger: true });
    }
    const decideur = this.auth.peut('depenses.decision');
    if (d.statut === 'soumise' && decideur) {
      items.push({ label: 'Valider', action: () => this.ouvrirPanneau(d, 'valider') });
      items.push({ label: 'Rejeter', action: () => this.ouvrirPanneau(d, 'rejeter'), danger: true });
    }
    if (d.statut === 'validee' && !d.annulee_le && decideur) {
      items.push({ label: d.ordre_paiement_le && d.moyen_defini ? "Modifier l'ordre de paiement" : "Donner l'ordre de paiement", action: () => this.ouvrirPanneau(d, 'ordre') });
    }
    if (d.statut === 'validee' && this.auth.peut('depenses.decaisser') && (decideur || (d.ordre_paiement_le && !d.blocage_le))) {
      items.push({ label: 'Décaisser', action: () => this.ouvrirDecaissement(d) });
    }
    if (d.statut === 'validee' && !decideur && this.auth.peut('depenses.decaisser') && d.ordre_paiement_le && !d.blocage_le) {
      items.push({ label: 'Signaler un blocage', action: () => this.signalerBlocage(d), danger: true });
    }
    if (this.auth.peut('depenses.decision') && (d.statut === 'validee' || d.statut === 'decaissee') && !d.annulee_le && !d.facture_id) {
      items.push({ label: 'Annuler (avec motif)', action: () => this.annulerDepense(d), danger: true });
    }
    // Correction d'une dépense engagée sur la petite caisse : l'engageur ou un associé ; après validation, seulement un associé (corrections de forme).
    if (d.petite_caisse && d.engagee_par_id && !d.annulee_le) {
      const engageur = d.engagee_par_id === this.auth.utilisateur()?.id && this.auth.peut('depenses.engager');
      const decideur = this.auth.peut('depenses.decision');
      const ouverte = d.apres_coup_statut === 'a_valider' || d.apres_coup_statut === 'contestee';
      if ((ouverte && (engageur || decideur)) || (d.apres_coup_statut === 'validee' && decideur)) {
        items.push({ label: d.apres_coup_statut === 'validee' ? 'Corriger la forme' : 'Corriger', action: () => this.commencerEdition(d, true) });
      }
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
  chargerDotations(): void { this.api.dotationsPetiteCaisse(this.caisseCode()).subscribe({ next: (r) => this.dotations.set(r), error: () => {} }); }
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
  pad7(n: number | null | undefined): string { return String(n ?? 0).padStart(7, '0'); }
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
    this.api.engagerDepense({ ...this.engagement, caisse: this.caisseCode() }).subscribe({
      next: (r) => {
        this.engagementEnCours.set(false);
        this.engagementMessage.set(`Dépense engagée — solde restant : ${Number(r.solde_restant).toLocaleString('fr-FR')} FCFA. Elle doit être validée par un autre associé.`);
        this.engagement = { ...this.engagementVide(), mode_paiement: this.engagement.mode_paiement };
        this.charger(); this.chargerCaisse(); this.chargerSynthese();
      },
      error: (e) => { this.engagementEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Engagement impossible.'); },
    });
  }
  // Natures acceptées sur la petite caisse (lot B, 11/11/2026) : liste réglée par les associés, servie avec la caisse.
  categoriesPC(): CategorieDepense[] {
    const ok = this.caisseActive()?.categories_autorisees as string[] | undefined;
    return ok ? CATEGORIES_DEPENSE.filter((c) => ok.includes(c.code)) : [];
  }
  libellesPC(): string { return this.categoriesPC().map((c) => c.libelle).join(', ') || 'aucune (à régler dans Accès & permissions → Seuils)'; }
  readonly rapprochements = signal<any[]>([]);
  rapSoldeReel: number | null = null;
  rapNote = '';
  readonly rapEnCours = signal(false);
  chargerRapprochements(): void {
    this.api.rapprochementsPetiteCaisse(this.caisseCode()).subscribe({ next: (r) => this.rapprochements.set(r), error: () => {} });
  }
  rapprocher(): void {
    if (this.rapSoldeReel === null || this.rapEnCours()) return;
    this.rapEnCours.set(true);
    this.api.rapprocherPetiteCaisse({ solde_reel: this.rapSoldeReel, note: this.rapNote || undefined, caisse: this.caisseCode() }).subscribe({
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
  // Pièces à toute étape (lot C) : déposant, associés, exécutants du paiement.
  peutPieces(d: any): boolean {
    return d.soumis_par_id === this.auth.utilisateur()?.id || this.auth.peut('depenses.decision') || this.auth.peut('depenses.decaisser');
  }
  actionsPourPiece(d: any, p: any): ActionMenuItem[] {
    const items: ActionMenuItem[] = [
      { label: 'Aperçu', action: () => this.preview.ouvrir(p.nom, this.api.telechargerPieceDepense(d.id, p.id)) },
    ];
    if (p.type === 'devis' && !p.retenu && d.statut === 'soumise' && this.auth.peut('depenses.decision')) {
      items.push({ label: 'Retenir ce devis', action: () => this.retenirDevis(d, p) });
    }
    if (d.statut === 'soumise' || this.auth.peut('depenses.decision') || p.ajoute_par_id === this.auth.utilisateur()?.id) {
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

  // Valider / rejeter / donner l'ordre de paiement (11/11/2026, lot A) : un panneau s'ouvre sous la ligne.
  readonly panneauId = signal<string | null>(null);
  readonly panneauMode = signal<'valider' | 'rejeter' | 'ordre' | 'apres_valider' | 'apres_contester'>('valider');
  readonly voisines = signal<any | null>(null);
  readonly panneauEnCours = signal(false);
  readonly panValide = signal(true);
  panModele: any = {};
  panneauMotif = '';
  ouvrirPanneau(d: any, mode: 'valider' | 'rejeter' | 'ordre' | 'apres_valider' | 'apres_contester'): void {
    this.erreur.set('');
    this.voisines.set(null);
    if (mode === 'apres_valider' || mode === 'apres_contester') this.api.voisinesDepense(d.id).subscribe({ next: (v) => this.voisines.set(v), error: () => this.voisines.set({ voisines: [], fenetre_jours: 7, cumul_meme_nature_beneficiaire: Number(d.montant), plafond: null }) });
    this.panneauMotif = '';
    this.panModele = { mode_paiement: d.mode_paiement ?? '', compte_id: d.compte_id ?? '', references: {} };
    this.panValide.set(true);
    this.panneauMode.set(mode);
    this.panneauId.set(d.id);
  }
  panneauAide(): string {
    return this.panneauMode() === 'ordre'
      ? "Indiquez le moyen de paiement et le compte à débiter : c'est le feu vert donné à l'administration pour exécuter le paiement."
      : "Vous pouvez donner dès maintenant l'ordre de paiement (moyen et compte à débiter). Sans cela, la dépense reste validée, en attente d'ordre de paiement.";
  }
  panneauPret(): boolean {
    if (this.panneauMode() === 'apres_valider') return true;
    if (this.panneauMode() === 'rejeter' || this.panneauMode() === 'apres_contester') return !!this.panneauMotif.trim();
    if (this.panneauMode() === 'ordre') return !!this.panModele.mode_paiement && this.panValide();
    return this.panValide();
  }
  libelleBoutonPanneau(): string {
    if (this.panneauMode() === 'apres_valider') return 'Valider après coup';
    if (this.panneauMode() === 'apres_contester') return 'Contester la dépense';
    return this.panneauMode() === 'rejeter' ? 'Rejeter la dépense' : this.panneauMode() === 'ordre' ? "Donner l'ordre de paiement"
      : (this.panModele.mode_paiement ? "Valider et donner l'ordre de paiement" : "Valider sans ordre de paiement");
  }
  confirmerPanneau(d: any): void {
    if (this.panneauEnCours() || !this.panneauPret()) return;
    this.erreur.set('');
    this.panneauEnCours.set(true);
    const m = this.panModele;
    const reglement = { mode_paiement: m.mode_paiement, compte_id: m.compte_id || null, references: m.references };
    const appel = this.panneauMode() === 'apres_valider' ? this.api.validerDepenseApresCoup(d.id, 'validee')
      : this.panneauMode() === 'apres_contester' ? this.api.validerDepenseApresCoup(d.id, 'contestee', this.panneauMotif.trim())
      : this.panneauMode() === 'rejeter' ? this.api.decisionDepense(d.id, { statut: 'rejetee', motif_rejet: this.panneauMotif.trim() })
      : this.panneauMode() === 'ordre' ? this.api.ordrePaiementDepense(d.id, reglement)
      : this.api.decisionDepense(d.id, m.mode_paiement ? { statut: 'validee', ...reglement } : { statut: 'validee' });
    appel.subscribe({
      next: () => { this.panneauEnCours.set(false); this.panneauId.set(null); this.charger(); this.chargerSynthese(); },
      error: (e) => { this.panneauEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Opération impossible (droit de décision requis).'); },
    });
  }
  libelleStatutDepense(d: any): string {
    if (d.statut === 'validee') return d.ordre_paiement_le ? 'Validée — à décaisser' : 'Validée — ordre de paiement à donner';
    return this.libelleStatut(d.statut);
  }
  signalerBlocage(d: any): void {
    const motif = window.prompt(`Signaler un blocage pour « ${d.libelle} ».\nMotif (obligatoire) : solde insuffisant, chèque indisponible…`);
    if (!motif || !motif.trim()) return;
    this.erreur.set('');
    this.api.blocageDepense(d.id, motif.trim()).subscribe({
      next: () => this.charger(),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Signalement impossible.'),
    });
  }
  // Exécutant : moyen et compte sont ceux de l'ordre, il ne saisit que les références.
  decSimple(d: any): boolean { return !this.auth.peut('depenses.decision') && !!d.mode_paiement; }
  champsMoyen(code: string): any[] { return this.catalogue().find((x) => x.code === code)?.champs ?? []; }
  refsExecutantOk(d: any): boolean {
    const refs = this.decModele?.references ?? {};
    return this.champsMoyen(d.mode_paiement).every((c: any) => !c.requis || String(refs[c.cle] ?? '').trim() !== '');
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
    this.panneauId.set(null);
    this.decaissementId.set(d.id);
  }
  confirmerDecaissement(d: any): void {
    if (this.decEnCours()) return;
    this.erreur.set('');
    this.decEnCours.set(true);
    const m = this.decModele;
    const corps = this.decSimple(d) ? { references: m.references } : { mode_paiement: m.mode_paiement, compte_id: m.compte_id || null, references: m.references };
    this.api.decaisserDepense(d.id, corps).subscribe({
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
  readonly editionEngagee = signal(false);
  commencerEdition(d: any, engagee = false): void {
    this.editionEngagee.set(engagee);
    this.erreur.set('');
    this.editForm = {
      type: d.type, categorie: d.categorie, libelle: d.libelle, montant: d.montant,
      date_depense: d.date_depense, compte_id: d.compte_id ?? '', mode_paiement: d.mode_paiement ?? '', references: { ...(d.references_paiement ?? {}) },
      petite_caisse: d.petite_caisse, justificatif: d.justificatif, refacturable_client: d.refacturable_client,
      nature: d.nature ?? (d.dossier_id ? 'dossier' : 'cabinet'), dossier_id: d.dossier_id ?? null,
      beneficiaire: d.beneficiaire ?? '', precision_nature: d.precision_nature ?? null,
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
    const appel = this.editionEngagee() ? this.api.majDepenseEngagee(id, this.editForm) : this.api.majDepense(id, this.editForm);
    appel.subscribe({
      next: () => { this.editionEnCours.set(false); this.editionId.set(null); this.editForm = {}; this.charger(); this.chargerCaisse(); },
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
    this.api.definirDotationCaisse(this.dotationMois, this.dotationMontant, this.caisseCode()).subscribe({
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
