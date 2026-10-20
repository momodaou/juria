import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, Dossier, MoyenPaiement } from '../../core/api.service';
import { ReglementFormComponent } from '../../core/reglement-form.component';
import { AuthService } from '../../core/auth.service';
import { DocumentPreviewService } from '../../core/document-preview.service';
import { ClientPickerComponent } from '../../core/client-picker.component';
import { MenuActionsComponent, ActionMenuItem } from '../../core/menu-actions.component';

@Component({
  selector: 'app-facturation',
  standalone: true,
  imports: [DecimalPipe, DatePipe, FormsModule, ClientPickerComponent, RouterLink, MenuActionsComponent, ReglementFormComponent],
  template: `
    <header class="page-head"><h1>Facturation</h1></header>

    @if (filtreDossierNumero()) {
      <p class="filtre">Filtré sur le dossier <b>{{ filtreDossierNumero() }}</b> — <a class="lien" routerLink="." [queryParams]="{}">voir toutes les factures</a></p>
    }

    <section class="panel">
      <h3>Nouvelle facture</h3>
      <div class="form">
        <label>Dossier
          <select [(ngModel)]="dossierId" name="dossier" (ngModelChange)="onDossierChange()">
            <option value="">— choisir —</option>
            <option value="__autre__">Autre (facturer un client sans dossier)</option>
            @for (d of dossiers(); track d.id) {
              <option [value]="d.id">{{ d.numero }} — {{ d.intitule }}</option>
            }
          </select>
        </label>
        @if (dossierId === '__autre__') {
          <label class="large">Client
            <app-client-picker [valeur]="factureClientId" (valeurChange)="factureClientId = $event" />
          </label>
        }
        <label>Mode
          <select [(ngModel)]="mode" name="mode">
            <option value="temps_passe">Temps passé</option>
            <option value="forfait">Forfait</option>
            <option value="success_fee">Success fee</option>
            <option value="abonnement">Abonnement</option>
            <option value="consultation">Consultation</option>
          </select>
        </label>
        <label>Montant HT
          <input type="number" [(ngModel)]="montantHt" name="ht" />
        </label>
        <label class="large">Objet (facultatif)
          <input [(ngModel)]="objet" name="objet" placeholder="Pré-rempli depuis l'objet du dossier — modifiable" />
        </label>
        <label>Devise
          <select [(ngModel)]="devise" name="devise">
            <option value="XOF">FCFA (XOF)</option>
            <option value="EUR">Euro (EUR) — parité fixe 655,957</option>
            <option value="USD">Dollar (USD) — taux à saisir</option>
            <option value="GBP">Livre (GBP) — taux à saisir</option>
          </select>
        </label>
        @if (devise === 'USD' || devise === 'GBP') {
          <label>Taux vers XOF
            <input type="number" step="0.0001" [(ngModel)]="tauxApplique" name="taux" placeholder="ex. 610" />
          </label>
        }
        <label>TVA %
          <input type="number" [(ngModel)]="tva" name="tva" />
          <span class="hint">Par défaut : 18 % (client Mali) / 0 % (client hors Mali) — laisser vide pour appliquer ce défaut.</span>
        </label>
        <label>Compte à créditer
          <select [(ngModel)]="compteReglementId" name="compte">
            <option value="">— non précisé —</option>
            @for (c of comptes(); track c.id) {
              <option [value]="c.id">{{ c.intitule }}{{ c.banque ? ' — ' + c.banque : '' }}</option>
            }
          </select>
        </label>
        <label class="large">Mention (facultatif)
          <input [(ngModel)]="mention" name="mention" placeholder="ex. Frais de virement à la charge du client" />
        </label>
        @if (auth.peut('factures.paiement.ajouter')) {
          <label>Acompte reçu à l'émission (facultatif)
            <input type="number" [(ngModel)]="acompteMontant" name="acMnt" placeholder="Montant déjà payé" style="max-width:170px" />
          </label>
          @if (acompteMontant) {
            <app-reglement-form [modele]="acompte" [catalogue]="catalogue()" [compteParDefaut]="compteReglementId || null" (validite)="acompteValide.set($event)"></app-reglement-form>
          }
        }
      </div>
      @if (auth.peut('factures.creer')) {
        <button class="btn" style="margin-top:14px" (click)="creer()" [disabled]="(dossierId === '__autre__' ? !factureClientId : !dossierId) || !montantHt || creationFactureEnCours() || (acompteMontant && !acompteValide())">{{ creationFactureEnCours() ? 'Émission…' : 'Émettre' }}</button>
      }
      @if (message()) { <p class="ok-msg">{{ message() }}</p> }
      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
    </section>

    <section class="panel">
      <h3>Facturer un dossier (temps + débours)</h3>
      <p class="desc">Sélectionne un dossier pour lister les temps facturables et les débours décaissés/refacturables pas encore rattachés à une facture, puis coche ce qui doit y figurer. Le montant est calculé automatiquement — uniquement en FCFA (temps et débours sont toujours enregistrés en XOF).</p>
      <div class="form">
        <label>Dossier
          <select [(ngModel)]="dossierTempsId" name="dossierTemps" (ngModelChange)="chargerTempsNonFactures()">
            <option value="">— choisir —</option>
            @for (d of dossiers(); track d.id) {
              <option [value]="d.id">{{ d.numero }} — {{ d.intitule }}</option>
            }
          </select>
        </label>
        <label>Mode
          <select [(ngModel)]="modeTemps" name="modeTemps">
            <option value="temps_passe">Temps passé</option>
            <option value="forfait">Forfait</option>
          </select>
        </label>
        <label>Compte à créditer
          <select [(ngModel)]="compteReglementId" name="compteTemps">
            <option value="">— non précisé —</option>
            @for (c of comptes(); track c.id) {
              <option [value]="c.id">{{ c.intitule }}{{ c.banque ? ' — ' + c.banque : '' }}</option>
            }
          </select>
        </label>
        <label class="large">Mention (facultatif)
          <input [(ngModel)]="mention" name="mentionTemps" placeholder="ex. Frais de virement à la charge du client" />
        </label>
        @if (auth.peut('factures.paiement.ajouter')) {
          <label>Acompte reçu à l'émission (facultatif)
            <input type="number" [(ngModel)]="acompteMontant" name="acMntT" placeholder="Montant déjà payé" style="max-width:170px" />
          </label>
          @if (acompteMontant) {
            <app-reglement-form [modele]="acompte" [catalogue]="catalogue()" [compteParDefaut]="compteReglementId || null" (validite)="acompteValide.set($event)"></app-reglement-form>
          }
        }
      </div>
      @if (tempsNonFactures().length) {
        <h4>Temps facturables</h4>
        <table>
          <tr><th></th><th>Date</th><th>Auteur</th><th>Durée</th><th>Taux horaire</th><th>Montant HT</th><th>Description</th></tr>
          @for (t of tempsNonFactures(); track t.id) {
            <tr>
              <td><input type="checkbox" [checked]="tempsSelectionnes().has(t.id)" (change)="basculerTemps(t.id)" /></td>
              <td>{{ t.date_saisie | date:'dd/MM/yyyy' }}</td>
              <td>{{ t.auteur }}</td>
              <td>{{ t.duree_minutes }} min</td>
              <td>{{ t.taux_horaire | number }} FCFA/h</td>
              <td>{{ montantTemps(t) | number }} FCFA</td>
              <td>{{ t.description || '—' }}</td>
            </tr>
          }
        </table>
      }
      @if (deboursARefacturer().length) {
        <h4>Débours décaissés à refacturer</h4>
        <table>
          <tr><th></th><th>Date</th><th>Libellé</th><th>Montant</th></tr>
          @for (d of deboursARefacturer(); track d.id) {
            <tr>
              <td><input type="checkbox" [checked]="deboursSelectionnes().has(d.id)" (change)="basculerDebours(d.id)" /></td>
              <td>{{ d.date_depense | date:'dd/MM/yyyy' }}</td>
              <td>{{ d.libelle }}</td>
              <td>{{ d.montant | number }} FCFA</td>
            </tr>
          }
        </table>
      }
      @if (tempsNonFactures().length || deboursARefacturer().length) {
        <p>
          <strong>Honoraires sélectionnés : {{ totalTempsSelectionnes() | number }} FCFA</strong>
          @if (deboursARefacturer().length) { <strong> — Débours sélectionnés : {{ totalDeboursSelectionnes() | number }} FCFA</strong> }
        </p>
        @if (auth.peut('factures.creer')) {
          <button class="btn" (click)="facturerTemps()" [disabled]="(!tempsSelectionnes().size && !deboursSelectionnes().size) || creationFactureEnCours() || (acompteMontant && !acompteValide())">{{ creationFactureEnCours() ? 'Émission…' : 'Émettre la facture' }}</button>
        }
      } @else if (dossierTempsId) {
        <p class="muted">Rien en attente de facturation pour ce dossier (ni temps facturable, ni débours décaissé refacturable).</p>
      }
    </section>

    <section class="panel">
      <h3>Factures impayées</h3>
      @if (impayees().length) {
        <table>
          <tr><th>N°</th><th>Client</th><th>Reste dû</th><th>Échéance</th><th>Encaisser</th></tr>
          @for (f of impayees(); track f.id) {
            <tr>
              <td>{{ f.numero }}</td><td><a class="lien" [routerLink]="['/clients', f.client_id]">{{ f.client }}</a></td>
              <td>{{ f.reste | number }} {{ dev(f.devise) }}</td>
              <td>{{ f.date_echeance ? (f.date_echeance | date:'dd/MM/yyyy') : '—' }}</td>
              <td>
                @if (auth.peut('factures.paiement.ajouter')) {
                  <button class="lien" (click)="encaisser(f)">Encaisser un paiement…</button>
                }
              </td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucun impayé.</p> }
    </section>

    <section class="panel">
      <h3>Clients sous convention (abonnement)</h3>
      <p class="desc">Registre des clients facturés de façon périodique (mensuelle/trimestrielle/semestrielle/annuelle) — une seule facture couvre tous les dossiers du client (contentieux, conseil, diligences…), pas de convention distincte par dossier. Statut dérivé automatiquement de la dernière facture réellement émise pour ce client (liée ou non à l'un de ses dossiers), jamais une case à cocher.</p>
      @if (abonnements().length) {
        <table>
          <tr><th>Client</th><th>Périodicité</th><th>Montant convenu</th><th>Dernière facture</th><th>Prochaine échéance</th><th>Statut</th><th></th></tr>
          @for (a of abonnements(); track a.client_id) {
            <tr>
              <td><a class="lien" [routerLink]="['/clients', a.client_id]">{{ a.client }}</a></td>
              <td>{{ a.abonnement_periodicite ? libellePeriodicite(a.abonnement_periodicite) : 'à configurer' }}</td>
              <td>{{ a.montant_convenu_xof ? (a.montant_convenu_xof | number) + ' FCFA' : '—' }}</td>
              <td>{{ a.abonnement_derniere_facture_le ? (a.abonnement_derniere_facture_le | date:'dd/MM/yyyy') : '—' }}</td>
              <td>{{ a.abonnement_prochaine_echeance ? (a.abonnement_prochaine_echeance | date:'dd/MM/yyyy') : '—' }}</td>
              <td>
                @if (a.abonnement_statut) {
                  <span class="tag" [class.haute]="a.abonnement_statut === 'en_retard'">{{ a.abonnement_statut === 'en_retard' ? 'En retard' : 'À jour' }}</span>
                } @else { — }
              </td>
              <td><app-menu-actions [actions]="actionsPourAbonnement(a)" /></td>
            </tr>
            @if (editionAbonnementId() === a.client_id) {
              <tr class="edition">
                <td colspan="7">
                  <div class="form">
                    <label>Périodicité
                      <select class="in" [(ngModel)]="editAbonnement.abonnement_periodicite" [name]="'edPeriod' + a.client_id">
                        <option value="">— non configurée —</option>
                        @for (p of periodicitesAbonnement(); track p.code) {
                          <option [value]="p.code">{{ p.libelle }}</option>
                        }
                      </select>
                    </label>
                    @if (editAbonnement.abonnement_periodicite && editAbonnement.abonnement_periodicite !== 'mensuelle') {
                      <label>Mois d'ancrage
                        <select class="in" [(ngModel)]="editAbonnement.mois_ancrage" [name]="'edMois' + a.client_id" (ngModelChange)="onMoisAncrageChange()">
                          <option [value]="null">—</option>
                          @for (m of MOIS_NOMS; track m; let i = $index) { <option [value]="i + 1">{{ m }}</option> }
                        </select>
                      </label>
                    }
                    <label>Jour de facturation
                      <select class="in" [(ngModel)]="editAbonnement.jour_ancrage" [name]="'edJour' + a.client_id">
                        <option [value]="null">—</option>
                        @for (j of joursDisponibles(editAbonnement.abonnement_periodicite === 'mensuelle' ? null : editAbonnement.mois_ancrage); track j) { <option [value]="j">{{ j }}</option> }
                      </select>
                    </label>
                    <label>Montant convenu (FCFA, facultatif)
                      <input class="in" type="number" min="0" [(ngModel)]="editAbonnement.montant_convenu" [name]="'edMontant' + a.client_id" />
                    </label>
                  </div>
                  <p class="hint">Ce repère se répète indéfiniment (pas d'année à choisir). Périodicité et jour de facturation doivent être renseignés ensemble (ou tous les deux laissés vides pour retirer la convention).</p>
                  @if (erreur()) { <p class="err">{{ erreur() }}</p> }
                  <button class="lien" (click)="enregistrerEditionAbonnement(a)">Enregistrer</button>
                  <button class="lien" (click)="annulerEditionAbonnement()">Annuler</button>
                </td>
              </tr>
            }
          }
        </table>
      } @else { <p class="muted">Aucun client sous convention-cadre pour l'instant.</p> }
    </section>

    <section class="panel">
      <h3>Encaissements — moyens de paiement</h3>
      @if (especesADeposer().length) {
        <div class="alerte-especes">
          <b>Espèces à déposer en banque ({{ especesADeposer().length }})</b>
          @for (p of especesADeposer(); track p.id) {
            <div class="ligne-depot">
              <span>{{ p.date_paiement | date:'dd/MM/yyyy' }} — {{ p.client }} — facture {{ p.facture_numero }} — <b>{{ p.montant | number }} {{ dev(p.devise) }}</b>@if (p.numero_recu) { — reçu {{ p.numero_recu }} }</span>
              @if (auth.peut('factures.paiement.ajouter')) {
                <select [(ngModel)]="depotChoix[p.id]" [name]="'depE' + p.id"><option value="">— compte de dépôt —</option>@for (c of comptesDepot(); track c.id) { <option [value]="c.id">{{ c.intitule }}</option> }</select>
                <button class="btn" (click)="deposer(p)">Enregistrer le dépôt</button>
              }
            </div>
          }
          @if (erreurDepot()) { <p class="err">{{ erreurDepot() }}</p> }
        </div>
      }
      <div class="form" style="margin-bottom:8px">
        <label>Moyen
          <select [ngModel]="encMode" (ngModelChange)="encMode = $event; chargerEncaissements()" name="encMode">
            <option value="">Tous les moyens</option>
            @for (m of moyensFiltre(); track m.code) { <option [value]="m.code">{{ m.libelle }}</option> }
          </select>
        </label>
        <label>Du <input type="date" [ngModel]="encDebut" (ngModelChange)="encDebut = $event; chargerEncaissements()" name="encDebut" /></label>
        <label>Au <input type="date" [ngModel]="encFin" (ngModelChange)="encFin = $event; chargerEncaissements()" name="encFin" /></label>
      </div>
      @if (encaissements(); as e) {
        @if (e.lignes.length) {
          <p><strong>Total encaissé : {{ e.total_xof | number }} FCFA</strong>
            @for (t of e.totaux; track t.mode) { · {{ libelleMoyen(t.mode) }} : {{ t.montant_xof | number }} ({{ t.nb }}) }
          </p>
          <div class="table-scroll">
          <table>
            <tr><th class="nowrap">Date</th><th>Client</th><th class="nowrap">Facture</th><th class="nowrap">Dossier</th><th>Moyen</th><th>Compte</th><th>Montant</th><th>Référence</th></tr>
            @for (p of e.lignes; track p.id) {
              <tr>
                <td class="nowrap">{{ p.date_paiement | date:'dd/MM/yyyy' }}</td>
                <td><a class="lien" [routerLink]="['/clients', p.client_id]">{{ p.client }}</a></td>
                <td class="nowrap">{{ p.facture_numero }}</td>
                <td class="nowrap">@if (p.dossier_id) { <a class="lien" [routerLink]="['/dossiers', p.dossier_id]">{{ p.dossier_numero }}</a> } @else { — }</td>
                <td>{{ libelleMoyen(p.mode) }}</td>
                <td>{{ p.compte_intitule || (p.depot_statut === 'en_attente' ? 'à déposer' : '—') }}</td>
                <td>{{ p.montant | number }} {{ dev(p.devise) }}@if (p.frais_retenus > 0) { <br /><span class="muted">frais {{ p.frais_retenus | number }}</span> }</td>
                <td>{{ p.reference || '—' }}</td>
              </tr>
            }
          </table>
          </div>
          @if (e.tronque) { <p class="hint">Liste limitée aux 500 derniers paiements — affinez par période.</p> }
        } @else { <p class="hint">Aucun encaissement pour ces critères.</p> }
      }
    </section>

    <section class="panel">
      <h3>Toutes les factures</h3>
      <div class="form" style="margin-bottom:8px">
        <label>Afficher
          <select [ngModel]="etatFiltre()" (ngModelChange)="changerEtat($event)" name="etatFiltre">
            <option value="">Toutes</option>
            <option value="payee">Payées (soldées)</option>
            <option value="non_soldee">Non soldées (reste à payer)</option>
            <option value="partielle">Partiellement payées</option>
            <option value="en_retard">En retard (échéance dépassée)</option>
            <option value="annulee">Annulées</option>
          </select>
        </label>
      </div>
      @if (factures().length) {
        <div class="table-scroll">
        <table>
          <tr><th class="nowrap">N°</th><th>Client</th><th class="nowrap">Dossier</th><th>Mode</th><th>HT</th><th>TTC</th><th>Encaissé</th><th>Reliquat</th>@if (afficherContreValeur()) { <th>Contre-valeur FCFA</th> }<th>Statut</th><th></th></tr>
          @for (f of factures(); track f.id) {
            <tr>
              <td class="nowrap">{{ f.numero }}</td><td><a class="lien" [routerLink]="['/clients', f.client_id]">{{ f.client }}</a></td>
              <td class="nowrap">@if (f.dossier_id) { <a class="lien" [routerLink]="['/dossiers', f.dossier_id]">{{ f.dossier_numero }}</a> } @else { — }</td>
              <td class="nowrap-n">{{ libelleMode(f.mode) }}</td>
              <td class="nowrap-n">{{ f.montant_ht | number }} {{ dev(f.devise) }}</td>
              <td class="nowrap-n">{{ f.montant_ttc | number }} {{ dev(f.devise) }}</td>
              <td class="nowrap-n">{{ f.encaisse | number }} {{ dev(f.devise) }}</td>
              <td class="nowrap-n" [style.fontWeight]="f.reliquat > 0 ? '700' : '400'">{{ f.reliquat | number }} {{ dev(f.devise) }}</td>
              @if (afficherContreValeur()) { <td class="nowrap-n">{{ f.devise !== 'XOF' ? (f.montant_ttc_xof | number) + ' FCFA' : '—' }}</td> }
              <td class="nowrap-n"><span class="tag" [class.ok]="f.statut === 'payee'" [class.attente]="f.statut === 'emise' || f.statut === 'partielle'">{{ libelleStatut(f.statut) }}</span>@if (enRetard(f)) { {{ ' ' }}<span class="tag haute" style="margin-left:4px">En retard</span> }</td>
              <td><app-menu-actions [actions]="actionsPourFacture(f)" /></td>
            </tr>
            @if (editionId() === f.id) {
              <tr class="edition">
                <td [attr.colspan]="nbColonnes()">
                  <div class="form">
                    <label>Objet
                      <input [(ngModel)]="edit.objet" [name]="'edObjet' + f.id" />
                    </label>
                    <label>Montant HT
                      <input type="number" [(ngModel)]="edit.montant_ht" [name]="'edHt' + f.id" [disabled]="f.statut !== 'emise'" />
                    </label>
                    <label>TVA %
                      <input type="number" [(ngModel)]="edit.taux_tva" [name]="'edTva' + f.id" [disabled]="f.statut !== 'emise'" />
                    </label>
                    <label>Frais
                      <input type="number" [(ngModel)]="edit.montant_frais" [name]="'edFrais' + f.id" [disabled]="f.statut !== 'emise'" />
                    </label>
                    <label>Échéance
                      <input type="date" [(ngModel)]="edit.date_echeance" [name]="'edEch' + f.id" />
                    </label>
                    <label>Compte à créditer
                      <select [(ngModel)]="edit.compte_reglement_id" [name]="'edCompte' + f.id">
                        <option value="">— non précisé —</option>
                        @for (c of comptes(); track c.id) {
                          <option [value]="c.id">{{ c.intitule }}{{ c.banque ? ' — ' + c.banque : '' }}</option>
                        }
                      </select>
                    </label>
                    <label class="large">Mention
                      <input [(ngModel)]="edit.mention" [name]="'edMention' + f.id" />
                    </label>
                  </div>
                  @if (f.statut !== 'emise') {
                    <p class="hint">Le montant (HT/TVA/frais) est verrouillé — un paiement est déjà enregistré sur cette facture. <button type="button" class="lien" (click)="ouvrirPaiements(f)">Voir/retirer le paiement</button> pour pouvoir le corriger.</p>
                  }
                  @if (erreur()) { <p class="err">{{ erreur() }}</p> }
                  <button class="lien" (click)="enregistrerEdition(f)">Enregistrer</button>
                  <button class="lien" (click)="annulerEdition()">Annuler</button>
                </td>
              </tr>
            }
            @if (paiementsOuvertsId() === f.id) {
              <tr class="edition">
                <td [attr.colspan]="nbColonnes()">
                  <b>Paiements enregistrés</b>
                  @if (paiements().length) {
                    <table class="paiements">
                      @for (p of paiements(); track p.id) {
                        <tr>
                          <td>{{ p.date_paiement | date:'dd/MM/yyyy' }}</td>
                          <td>{{ p.montant | number }} {{ dev(p.devise) }}</td>
                          <td>{{ libelleMoyen(p.mode) }}@if (p.compte_intitule) { <br /><span class="muted">{{ p.compte_intitule }}</span> }</td>
                          <td class="muted">reste {{ p.reste_apres | number }} {{ dev(p.devise) }}</td>
                          <td>{{ resumeReferences(p) }}
                            @if (p.frais_retenus > 0) { <br /><span class="muted">frais retenus {{ p.frais_retenus | number }} · reçu net {{ p.montant_recu_net | number }} {{ dev(p.devise) }}</span> }
                            @if (p.depot_statut === 'en_attente') {
                              <br /><span class="tag">à déposer</span>
                              @if (auth.peut('factures.paiement.ajouter')) {
                                <select [(ngModel)]="depotChoix[p.id]" [name]="'dep' + p.id"><option value="">— compte de dépôt —</option>@for (c of comptesDepot(); track c.id) { <option [value]="c.id">{{ c.intitule }}</option> }</select>
                                <button class="lien" (click)="deposer(p)">Déposer</button>
                              }
                            } @else if (p.depot_statut === 'depose') { <br /><span class="muted">déposé le {{ p.date_depot | date:'dd/MM/yyyy' }}</span> }
                          </td>
                          <td>@if (auth.peut('factures.annuler')) { <button class="lien" (click)="supprimerPaiement(f, p)">Supprimer</button> }</td>
                        </tr>
                      }
                    </table>
                    <p class="hint">Supprimer un paiement saisi par erreur recalcule le statut de la facture. Action tracée dans le journal d'audit.</p>
                  } @else { <p class="muted">Aucun paiement.</p> }
                  <p class="recap"><b>Reste à payer : {{ f.reliquat | number }} {{ dev(f.devise) }}</b> sur {{ f.montant_ttc | number }} {{ dev(f.devise) }}</p>
                  @if (auth.peut('factures.paiement.ajouter') && f.statut !== 'annulee' && f.reliquat > 0) {
                    <div class="form">
                      <label>Montant reçu <input type="number" [(ngModel)]="pMontant" [name]="'pMnt' + f.id" style="max-width:150px" /></label>
                      <label>Date <input type="date" [(ngModel)]="pDate" [name]="'pDate' + f.id" /></label>
                      <app-reglement-form [modele]="pModele" [catalogue]="catalogue()" [compteParDefaut]="f.compte_reglement_id || null" (validite)="pValide.set($event)"></app-reglement-form>
                    </div>
                    <p class="hint">Le montant est prérempli au reste dû : modifiez-le pour enregistrer un paiement partiel.</p>
                    <div class="btns-ligne">
                      <button class="btn" (click)="enregistrerPaiement(f)" [disabled]="!pMontant || paiementEnCours() || !pValide()">{{ paiementEnCours() ? 'Enregistrement…' : 'Enregistrer le paiement' }}</button>
                      <button class="btn" (click)="encaisserTotalite(f)" [disabled]="paiementEnCours() || !pValide()">Encaisser la totalité ({{ f.reliquat | number }} {{ dev(f.devise) }})</button>
                      <button class="lien" (click)="paiementsOuvertsId.set(null)">Fermer</button>
                    </div>
                  } @else {
                    <div class="btns-ligne"><button class="lien" (click)="paiementsOuvertsId.set(null)">Fermer</button></div>
                  }
                  @if (erreur()) { <p class="err">{{ erreur() }}</p> }
                </td>
              </tr>
            }
          }
        </table>
        </div>
      } @else { <p class="muted">Aucune facture.</p> }
    </section>
  `,
  styles: [`
    .alerte-especes{background:#fffaf0;border:1px solid #f0dcae;border-radius:10px;padding:12px 16px;margin-bottom:14px}
    .ligne-depot{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:6px 0;border-top:1px solid #f0dcae;font-size:var(--fs-base)}
    .filtre{background:var(--light);border-radius:8px;padding:9px 14px;font-size:var(--fs-base);color:var(--slate);margin-bottom:14px}
    .form{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px 16px;align-items:start}
    .form .large{grid-column:span 2}
    @media (max-width:760px){.form .large{grid-column:span 1}}
    .form label{display:flex;flex-direction:column;font-size:var(--fs-sm);color:var(--slate);font-weight:600;gap:4px}
    .form input,.form select{border:1px solid var(--line);border-radius:8px;padding:0 10px;height:36px;box-sizing:border-box;width:100%;min-width:0;font-size:var(--fs-base);font-family:inherit}
    .nowrap-n{white-space:nowrap}
    .btns-ligne{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}
    .recap{font-size:var(--fs-base);margin:10px 0}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .paiements{margin:8px 0;width:auto}
    .paiements td{padding:4px 18px 4px 0;white-space:nowrap}
    .ok-msg{color:var(--green);font-size:var(--fs-base);margin-top:10px}
    .hint{font-weight:400;color:var(--slate);font-size:var(--fs-xs);white-space:normal;max-width:none;line-height:1.35}
    .desc{font-size:var(--fs-sm);color:var(--slate);max-width:640px;margin:0 0 10px}
    h4{margin:14px 0 6px;font-size:var(--fs-base)}
    .actions{display:flex;gap:10px;flex-wrap:nowrap;white-space:nowrap}
    .edition td{background:var(--light);padding:12px 14px}
  `],
})
export class FacturationComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly preview = inject(DocumentPreviewService);
  private readonly route = inject(ActivatedRoute);

  // Navigation inter-modules (06/09/2026) : arrivée depuis "Voir les
  // factures" sur la fiche dossier (?dossier=<id>&dossierLabel=<numero>) —
  // filtre la liste "Toutes les factures" sur ce dossier. Les 2 paramètres
  // sont fournis ensemble par le lien d'origine pour éviter un aller-retour
  // réseau supplémentaire juste pour résoudre le numéro à afficher.
  readonly filtreDossierId = signal<string | null>(null);
  readonly filtreDossierNumero = signal<string | null>(null);

  readonly dossiers = signal<Dossier[]>([]);
  readonly factures = signal<any[]>([]);
  readonly impayees = signal<any[]>([]);
  readonly comptes = signal<{ id: string; intitule: string; type: string; banque?: string }[]>([]);
  // Clients contractuels / abonnement (05/10/2026) — voir CLAUDE.md/HISTORY.md.
  readonly abonnements = signal<any[]>([]);
  readonly periodicitesAbonnement = signal<{ code: string; libelle: string }[]>([]);
  libellePeriodicite(code: string): string {
    return this.periodicitesAbonnement().find((p) => p.code === code)?.libelle ?? code;
  }
  // Modification de la périodicité/échéance directement depuis le registre
  // (07/10/2026) — jusqu'ici seule la fiche dossier le permettait.
  readonly editionAbonnementId = signal<string | null>(null);
  editAbonnement: any = {};
  readonly message = signal('');
  readonly erreur = signal('');
  // 26/09/2026 — audit doublons : "Émettre" restait cliquable pendant
  // l'envoi, un double-clic (ou un réseau lent) pouvait émettre deux
  // factures identiques avec deux numéros différents. Même patron déjà
  // utilisé ailleurs dans l'appli (ex. creationClientEnCours). Un seul
  // signal partagé par les 2 formulaires de création de facture (`creer()`
  // et `facturerTemps()`, jamais actifs en même temps).
  readonly creationFactureEnCours = signal(false);

  dossierId = '';
  // Choisi quand dossierId === '__autre__' (facturer un client sans dossier,
  // 05/09/2026 — POST /api/factures acceptait déjà client_id seul, cette
  // option manquait côté écran).
  factureClientId: string | null = null;
  mode = 'temps_passe';
  montantHt: number | null = null;
  // Objet propre à la facture (05/09/2026, diagnostic Facturation) — distinct
  // de l'objet du dossier lié, pré-rempli à sa sélection mais éditable.
  objet = '';
  devise = 'XOF';
  tauxApplique: number | null = null;
  // Laissé vide par défaut : le backend applique alors 18% (client Mali) ou
  // 0% (client hors Mali) selon la localisation — voir factures.js.
  tva: number | null = null;
  // Réglage/informations de paiement (28/08/2026, facture PDF enrichie) —
  // mode_reglement/compte_reglement_id/mention existaient déjà au schéma
  // depuis le 17/08/2026 mais n'étaient acceptés par aucune route avant ce
  // jour ; partagés entre les deux formulaires d'émission ci-dessous.
  compteReglementId = '';
  // Acompte / provision reçu à l'émission (16/10/2026) — premier paiement partiel
  // enregistré avec la facture ; les suivants via le panneau « Paiements ».
  acompteMontant: number | null = null;
  acompte: any = this.modeleReglement();
  readonly acompteValide = signal(true);
  // Catalogue des moyens d'encaissement (20/10/2026) : une seule liste, servie par le serveur.
  readonly catalogue = signal<MoyenPaiement[]>([]);
  modeleReglement(): any { return { mode: 'virement', references: {}, compte_id: '', frais_retenus: null }; }
  private reglementPourEnvoi(m: any): any {
    return { mode: m.mode, references: m.references, compte_id: m.compte_id || undefined, frais_retenus: m.frais_retenus || undefined };
  }
  // Panneau « Paiements » : saisie d'un paiement partiel après l'émission.
  pMontant: number | null = null;
  pModele: any = this.modeleReglement();
  readonly pValide = signal(true);
  pDate = '';
  readonly paiementEnCours = signal(false);
  mention = '';

  // Facturer un dossier (temps + débours)
  readonly tempsNonFactures = signal<any[]>([]);
  readonly tempsSelectionnes = signal<Set<string>>(new Set());
  readonly deboursARefacturer = signal<any[]>([]);
  readonly deboursSelectionnes = signal<Set<string>>(new Set());
  dossierTempsId = '';
  modeTemps = 'temps_passe';

  // Correction d'une facture émise avant tout règlement (05/09/2026).
  readonly editionId = signal<string | null>(null);
  // Historique / suppression des paiements (25/09/2026).
  readonly paiementsOuvertsId = signal<string | null>(null);
  readonly paiements = signal<any[]>([]);
  edit: any = {};

  ngOnInit(): void {
    this.api.dossiers().subscribe({ next: (d) => this.dossiers.set(d), error: () => {} });
    // Comptes qui reçoivent un règlement : banque et mobile money (ni caisse ni anciens types).
    this.api.comptesBancaires().subscribe({ next: (c) => this.comptes.set(c.filter((x) => ['fonctionnement', 'carpa', 'mobile_money'].includes(x.type))), error: () => {} });
    this.api.moyensPaiement().subscribe({ next: (m) => this.catalogue.set(m), error: () => {} });
    this.api.comptesPourMoyen('especes').subscribe({ next: (c) => this.comptesDepot.set(c), error: () => {} });
    this.chargerEspeces();
    this.api.clientsAbonnements().subscribe({ next: (a) => this.abonnements.set(a), error: () => {} });
    this.api.listesValeurs('periodicite').subscribe({ next: (l) => this.periodicitesAbonnement.set(l) });
    const params = this.route.snapshot.queryParamMap;
    this.filtreDossierId.set(params.get('dossier'));
    this.filtreDossierNumero.set(params.get('dossierLabel'));
    this.rafraichir();
  }

  // Vue Encaissements (16/10/2026) : une ligne par paiement + total par moyen.
  readonly encaissements = signal<any | null>(null);
  encMode = ''; encDebut = ''; encFin = '';
  // Filtre des encaissements : le catalogue, plus les anciens moyens encore présents dans l'historique.
  moyensFiltre(): { code: string; libelle: string }[] {
    return [...this.catalogue(), { code: 'mobile_money', libelle: 'Mobile money (ancien)' }, { code: 'autre', libelle: 'Autre (ancien)' }];
  }
  libelleMoyen(code: string): string { return this.moyensFiltre().find((m) => m.code === code)?.libelle ?? code; }
  // « Libellé : valeur · … » d'après les champs du catalogue pour ce moyen.
  resumeReferences(p: any): string {
    const champs = this.catalogue().find((m) => m.code === p.mode)?.champs ?? [];
    const refs = p.references_paiement ?? {};
    const lignes = champs.filter((c) => refs[c.cle]).map((c) => c.libelle + ' : ' + refs[c.cle]);
    return lignes.length ? lignes.join(' · ') : (p.reference || '—');
  }
  // Espèces encaissées, pas encore déposées en banque.
  readonly especesADeposer = signal<any[]>([]);
  readonly comptesDepot = signal<{ id: string; intitule: string }[]>([]);
  depotChoix: Record<string, string> = {};
  readonly erreurDepot = signal('');
  chargerEspeces(): void {
    this.api.especesADeposer().subscribe({ next: (l) => this.especesADeposer.set(l), error: () => {} });
  }
  deposer(p: any): void {
    const compte = this.depotChoix[p.id];
    if (!compte) { this.erreurDepot.set('Choisissez le compte de dépôt.'); return; }
    this.erreurDepot.set('');
    this.api.deposerEspeces(p.id, { compte_id: compte }).subscribe({
      next: () => { this.chargerEspeces(); this.chargerEncaissements(); const ouvert = this.paiementsOuvertsId(); if (ouvert) this.api.paiementsFacture(ouvert).subscribe({ next: (l) => this.paiements.set(l), error: () => {} }); },
      error: (e) => this.erreurDepot.set(e?.error?.error ?? 'Dépôt impossible.'),
    });
  }
  chargerEncaissements(): void {
    this.api.encaissements({ mode: this.encMode, debut: this.encDebut, fin: this.encFin })
      .subscribe({ next: (e) => this.encaissements.set(e), error: () => this.encaissements.set(null) });
  }

  readonly etatFiltre = signal('');
  changerEtat(v: string): void { this.etatFiltre.set(v); this.rafraichir(); }

  rafraichir(): void {
    const dossierId = this.filtreDossierId();
    this.api.factures('', { ...(dossierId ? { dossier_id: dossierId } : {}), ...(this.etatFiltre() ? { etat: this.etatFiltre() } : {}) }).subscribe({ next: (f) => this.factures.set(f), error: () => {} });
    this.api.facturesImpayees().subscribe({ next: (f) => this.impayees.set(f), error: () => {} });
    this.chargerEncaissements();
    // 🐛 Trouvé en vérifiant visuellement le cycle complet (09/10/2026) :
    // émettre une facture (ex. depuis "Facturer" sur le registre
    // abonnement) ne rafraîchissait que les factures/impayées — le statut
    // "à jour/en retard" du registre restait affiché tel qu'avant
    // l'émission jusqu'à un rechargement manuel de la page.
    this.api.clientsAbonnements().subscribe({ next: (a) => this.abonnements.set(a), error: () => {} });
    if (this.dossierTempsId) this.chargerTempsNonFactures();
  }

  chargerTempsNonFactures(): void {
    this.tempsSelectionnes.set(new Set());
    this.deboursSelectionnes.set(new Set());
    if (!this.dossierTempsId) { this.tempsNonFactures.set([]); this.deboursARefacturer.set([]); return; }
    this.api.tempsNonFactures(this.dossierTempsId).subscribe({
      next: (t) => this.tempsNonFactures.set(t),
      error: () => this.tempsNonFactures.set([]),
    });
    this.api.depensesARefacturer(this.dossierTempsId).subscribe({
      next: (d) => this.deboursARefacturer.set(d),
      error: () => this.deboursARefacturer.set([]),
    });
  }

  montantTemps(t: any): number {
    return Math.round((Number(t.duree_minutes) / 60) * Number(t.taux_horaire));
  }

  basculerTemps(id: string): void {
    const s = new Set(this.tempsSelectionnes());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.tempsSelectionnes.set(s);
  }

  basculerDebours(id: string): void {
    const s = new Set(this.deboursSelectionnes());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.deboursSelectionnes.set(s);
  }

  totalTempsSelectionnes(): number {
    return this.tempsNonFactures()
      .filter((t) => this.tempsSelectionnes().has(t.id))
      .reduce((somme, t) => somme + this.montantTemps(t), 0);
  }

  totalDeboursSelectionnes(): number {
    return this.deboursARefacturer()
      .filter((d) => this.deboursSelectionnes().has(d.id))
      .reduce((somme, d) => somme + Number(d.montant), 0);
  }

  // Injecte compte à créditer / mode de règlement / mention dans un payload
  // de création de facture — partagé par les deux formulaires d'émission.
  private ajouterInfosReglement(payload: any): void {
    if (this.compteReglementId) { payload.compte_reglement_id = this.compteReglementId; payload.mode_reglement = 'virement'; }
    if (this.mention) payload.mention = this.mention;
    if (this.acompteMontant && this.acompteMontant > 0) {
      payload.acompte = { montant: this.acompteMontant, ...this.reglementPourEnvoi(this.acompte) };
    }
  }
  private reinitialiserAcompte(): void { this.acompteMontant = null; this.acompte = this.modeleReglement(); }

  facturerTemps(): void {
    this.message.set(''); this.erreur.set('');
    const payload: any = { dossier_id: this.dossierTempsId, mode: this.modeTemps };
    if (this.tempsSelectionnes().size) payload.temps_ids = Array.from(this.tempsSelectionnes());
    if (this.deboursSelectionnes().size) payload.depense_ids = Array.from(this.deboursSelectionnes());
    this.ajouterInfosReglement(payload);
    this.creationFactureEnCours.set(true);
    this.api.creerFacture(payload).subscribe({
      next: (f) => { this.creationFactureEnCours.set(false); this.message.set(`Facture ${f.numero} émise (TTC ${f.montant_ttc} ${f.devise}).`); this.reinitialiserAcompte(); this.rafraichir(); },
      error: (e) => { this.creationFactureEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Émission impossible'); },
    });
  }

  // Menu "⋮" (19/09/2026).
  dev(code: string): string { return code === 'XOF' ? 'FCFA' : code; }
  libelleMode(m: string): string {
    return ({ temps_passe: 'Temps passé', forfait: 'Forfait', success_fee: 'Success fee', abonnement: 'Abonnement', consultation: 'Consultation', autre: 'Autre' } as any)[m] ?? m;
  }
  libelleStatut(st: string): string {
    return ({ emise: 'Émise', partielle: 'Partielle', payee: 'Payée', annulee: 'Annulée', brouillon: 'Brouillon', impayee: 'Impayée' } as any)[st] ?? st;
  }
  // « En retard » : dérivé (échéance dépassée avec un reliquat), jamais stocké.
  enRetard(f: any): boolean {
    return (f.statut === 'emise' || f.statut === 'partielle') && !!f.date_echeance && new Date(f.date_echeance) < new Date(new Date().toDateString()) && f.reliquat > 0;
  }
  readonly afficherContreValeur = computed(() => this.factures().some((f) => f.devise !== 'XOF'));
  nbColonnes(): number { return this.afficherContreValeur() ? 11 : 10; }

  // Paiement du reste dû en une fois (avec le moyen choisi dans le panneau).
  encaisserTotalite(f: any): void {
    this.pMontant = Number(f.reliquat);
    this.enregistrerPaiement(f);
  }


  // Paiement partiel (ou solde) après l'émission — avec le reste à chaque fois.
  enregistrerPaiement(f: any): void {
    if (!this.pMontant || this.paiementEnCours()) return;
    this.erreur.set('');
    this.paiementEnCours.set(true);
    this.api.ajouterPaiement(f.id, { montant: this.pMontant, date_paiement: this.pDate || undefined, ...this.reglementPourEnvoi(this.pModele) }).subscribe({
      next: (r) => {
        this.paiementEnCours.set(false);
        this.pMontant = null; this.pDate = ''; this.pModele = this.modeleReglement(); this.chargerEspeces();
        this.message.set(r.reliquat > 0 ? `Paiement enregistré — reste ${Number(r.reliquat).toLocaleString('fr-FR')} ${f.devise}.` : 'Paiement enregistré — facture soldée.');
        this.api.paiementsFacture(f.id).subscribe({ next: (p) => this.paiements.set(p), error: () => {} });
        this.rafraichir();
      },
      error: (e) => { this.paiementEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Paiement impossible'); },
    });
  }

  ouvrirPaiements(f: any): void {
    this.pMontant = f.reliquat > 0 ? Number(f.reliquat) : null; this.pDate = ''; this.pModele = this.modeleReglement();
    this.erreur.set('');
    this.paiements.set([]);
    this.paiementsOuvertsId.set(f.id);
    this.api.paiementsFacture(f.id).subscribe({ next: (p) => this.paiements.set(p), error: () => {} });
  }

  supprimerPaiement(f: any, p: any): void {
    if (!confirm(`Supprimer le paiement de ${Number(p.montant).toLocaleString('fr-FR')} ${p.devise} sur la facture ${f.numero} ?`)) return;
    this.erreur.set('');
    this.api.supprimerPaiement(f.id, p.id).subscribe({
      next: () => { this.ouvrirPaiements(f); this.rafraichir(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Suppression impossible'),
    });
  }

  actionsPourFacture(f: any): ActionMenuItem[] {
    const items: ActionMenuItem[] = [
      { label: 'Aperçu', action: () => this.apercuPdf(f) },
      { label: 'Télécharger', action: () => this.ouvrirPdf(f) },
    ];
    if (f.statut !== 'annulee' && (f.statut !== 'emise' || this.auth.peut('factures.paiement.ajouter'))) {
      items.push({ label: f.statut === 'emise' ? 'Encaisser un paiement' : (f.statut === 'partielle' ? `Paiements (reste ${Number(f.reliquat).toLocaleString('fr-FR')})` : 'Historique des paiements'), action: () => this.ouvrirPaiements(f) });
    }
    // 10/10/2026 — Modifier/Annuler/Supprimer restent désormais TOUJOURS
    // visibles (quand la permission factures.annuler est présente — le
    // masquage par permission, lui, reste un masquage pur), même quand la
    // facture ne s'y prête pas : grisées + expliquées via `title`, plutôt
    // que silencieusement absentes du menu. Avant ce correctif, l'absence
    // de bouton ne distinguait pas "pas le droit" de "facture déjà payée"
    // de "déjà annulée" — remonté comme confus par l'utilisateur.
    if (this.auth.peut('factures.annuler')) {
      if (f.statut === 'annulee') {
        items.push({ label: 'Modifier', action: () => {}, disabled: true, title: 'Facture annulée — plus aucune modification possible.' });
      } else {
        items.push({ label: 'Modifier', action: () => this.commencerEdition(f) });
      }

      if (f.statut === 'emise') {
        items.push({ label: 'Annuler', action: () => this.annuler(f), danger: true });
      } else if (f.statut === 'annulee') {
        items.push({ label: 'Annuler', action: () => {}, disabled: true, title: 'Déjà annulée.' });
      } else {
        items.push({
          label: 'Annuler', action: () => {}, disabled: true,
          title: 'Impossible : un ou plusieurs paiements sont déjà enregistrés sur cette facture. Retirez-les d’abord (menu « Paiements ») pour pouvoir l’annuler.',
        });
      }

      // La suppression définitive d'une facture n'existe pas dans JURIA, par
      // choix délibéré : la numérotation séquentielle (F-26-001, 002…) doit
      // rester continue pour la traçabilité fiscale — un trou dans la
      // numérotation est lui-même suspect pour un contrôle. "Annuler"
      // (ci-dessus) est la seule voie, et seulement avant tout paiement.
      items.push({
        label: 'Supprimer', action: () => {}, disabled: true,
        title: 'La suppression définitive n’existe pas dans JURIA (numérotation fiscale séquentielle, jamais trouée). Utilisez « Annuler » sur une facture non réglée.',
      });
    }
    return items;
  }

  annuler(f: any): void {
    if (!confirm(`Annuler la facture ${f.numero} ? Cette action est irréversible.`)) return;
    this.erreur.set('');
    this.api.annulerFacture(f.id).subscribe({
      next: () => this.rafraichir(),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Annulation impossible'),
    });
  }

  // Pré-remplit l'objet de la nouvelle facture depuis celui du dossier
  // choisi — reste un champ libre ensuite (jamais recalculé après ce choix).
  onDossierChange(): void {
    if (this.dossierId === '__autre__') { this.objet = ''; this.factureClientId = null; return; }
    const d = this.dossiers().find((x) => x.id === this.dossierId);
    this.objet = d?.objet || '';
  }

  // Raccourci depuis le registre "Clients sous convention" (07/10/2026,
  // bascule sur une facture CLIENT — pas dossier — le 09/10/2026 : une
  // seule facture couvre tous les dossiers du client, jamais un dossier
  // précis). Pré-remplit ce même formulaire (option "Autre", mode
  // abonnement, montant convenu s'il existe) plutôt que de dupliquer un
  // mécanisme d'émission — le registre reste un affichage dérivé,
  // l'émission reste le seul formulaire existant.
  preparerFacturationAbonnement(a: any): void {
    this.message.set('');
    this.erreur.set('');
    this.dossierId = '__autre__';
    this.factureClientId = a.client_id;
    this.mode = 'abonnement';
    this.objet = '';
    this.montantHt = a.montant_convenu_xof ?? null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  actionsPourAbonnement(a: any): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];
    if (this.auth.peut('factures.creer')) {
      items.push({ label: 'Facturer', action: () => this.preparerFacturationAbonnement(a) });
    }
    if (this.auth.peut('clients.modifier')) {
      items.push({ label: 'Modifier', action: () => this.commencerEditionAbonnement(a) });
    }
    return items;
  }

  // Repère jour/mois sans année (10/10/2026) — même correctif que
  // client-detail.component.ts : l'ancien input type="date" reconstruisait
  // systématiquement l'année courante à chaque réouverture, donnant
  // l'illusion trompeuse qu'on pouvait choisir une année alors que le
  // serveur ne retient jamais que jour/mois (periodicite.js).
  readonly MOIS_NOMS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

  joursDisponibles(mois: number | string | null): number[] {
    const m = Number(mois) || null;
    const total = m ? new Date(2024, m, 0).getDate() : 31;
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  onMoisAncrageChange(): void {
    const max = this.joursDisponibles(this.editAbonnement.mois_ancrage).length;
    if (this.editAbonnement.jour_ancrage && Number(this.editAbonnement.jour_ancrage) > max) {
      this.editAbonnement.jour_ancrage = max;
    }
  }

  commencerEditionAbonnement(a: any): void {
    this.erreur.set('');
    this.editionAbonnementId.set(a.client_id);
    this.editAbonnement = {
      abonnement_periodicite: a.abonnement_periodicite || '',
      jour_ancrage: a.abonnement_jour_facturation ?? null,
      mois_ancrage: a.abonnement_mois_facturation ?? null,
      montant_convenu: a.montant_convenu_xof ?? null,
    };
  }

  annulerEditionAbonnement(): void {
    this.editionAbonnementId.set(null);
  }

  enregistrerEditionAbonnement(a: any): void {
    this.erreur.set('');
    const periodicite = this.editAbonnement.abonnement_periodicite || '';
    const jour = this.editAbonnement.jour_ancrage;
    if (!!periodicite !== !!jour) {
      this.erreur.set('Périodicité et jour de facturation doivent être renseignés ensemble.');
      return;
    }
    if (periodicite && periodicite !== 'mensuelle' && !this.editAbonnement.mois_ancrage) {
      this.erreur.set("Le mois d'ancrage est requis pour cette périodicité (au-delà de la mensuelle).");
      return;
    }
    let prochaineFacturation: string | null = null;
    if (periodicite) {
      const mois = periodicite === 'mensuelle' ? new Date().getMonth() + 1 : Number(this.editAbonnement.mois_ancrage);
      prochaineFacturation = `2024-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
    }
    this.api.majAbonnementClient(a.client_id, {
      abonnement_periodicite: periodicite || null,
      abonnement_prochaine_facturation: prochaineFacturation,
      montant_convenu: this.editAbonnement.montant_convenu,
    }).subscribe({
      next: () => {
        this.editionAbonnementId.set(null);
        this.api.clientsAbonnements().subscribe({ next: (ab) => this.abonnements.set(ab) });
      },
      error: (e) => this.erreur.set(e?.error?.error ?? "Modification impossible."),
    });
  }

  commencerEdition(f: any): void {
    this.erreur.set('');
    this.editionId.set(f.id);
    this.edit = {
      objet: f.objet || '',
      montant_ht: f.montant_ht,
      taux_tva: f.taux_tva,
      montant_frais: f.montant_frais,
      date_echeance: f.date_echeance ? String(f.date_echeance).slice(0, 10) : '',
      compte_reglement_id: f.compte_reglement_id || '',
      mention: f.mention || '',
    };
  }

  annulerEdition(): void {
    this.editionId.set(null);
  }

  // 09/10/2026 — le montant (HT/TVA/frais) n'est envoyé QUE si la facture
  // est encore 'emise' (champs désactivés sinon côté formulaire) : sans
  // cette garde, renvoyer la valeur affichée mais inchangée aurait quand
  // même déclenché le verrou "financeTouchee" côté serveur pour une simple
  // correction de mention/échéance/compte sur une facture déjà réglée.
  enregistrerEdition(f: any): void {
    this.erreur.set('');
    const payload: any = {
      objet: this.edit.objet,
      date_echeance: this.edit.date_echeance || null,
      mention: this.edit.mention,
    };
    if (this.edit.compte_reglement_id) {
      payload.compte_reglement_id = this.edit.compte_reglement_id;
      payload.mode_reglement = 'virement';
    }
    if (f.statut === 'emise') {
      payload.montant_ht = this.edit.montant_ht;
      payload.taux_tva = this.edit.taux_tva;
      payload.montant_frais = this.edit.montant_frais;
    }
    this.api.modifierFacture(f.id, payload).subscribe({
      next: () => { this.editionId.set(null); this.rafraichir(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Modification impossible (facture annulée ?)'),
    });
  }

  // Support « papier numérique » (25/08/2026) — même patron que l'aperçu de
  // fichier du 21/08 : réutilise le même téléchargement authentifié pour
  // l'aperçu et le téléchargement direct.
  apercuPdf(f: any): void {
    this.preview.ouvrir(`${f.numero}.pdf`, this.api.telechargerFacturePdf(f.id));
  }

  ouvrirPdf(f: any): void {
    this.api.telechargerFacturePdf(f.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      error: () => this.erreur.set('Téléchargement du PDF impossible'),
    });
  }

  creer(): void {
    this.message.set(''); this.erreur.set('');
    const payload: any = {
      mode: this.mode,
      montant_ht: this.montantHt,
      devise: this.devise,
    };
    if (this.dossierId === '__autre__') payload.client_id = this.factureClientId;
    else payload.dossier_id = this.dossierId;
    if (this.objet) payload.objet = this.objet;
    if (this.tva !== null) payload.taux_tva = this.tva;
    if ((this.devise === 'USD' || this.devise === 'GBP') && this.tauxApplique) payload.taux_applique = this.tauxApplique;
    this.ajouterInfosReglement(payload);
    this.creationFactureEnCours.set(true);
    this.api.creerFacture(payload).subscribe({
      next: (f) => {
        this.creationFactureEnCours.set(false);
        this.message.set(`Facture ${f.numero} émise (TTC ${f.montant_ttc} ${f.devise})${f.acompte ? ' — acompte de ' + f.acompte + ' enregistré, statut : ' + f.statut : ''}.`);
        this.montantHt = null; this.tauxApplique = null; this.objet = ''; this.factureClientId = null; this.reinitialiserAcompte();
        this.rafraichir();
      },
      error: (e) => { this.creationFactureEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Émission impossible'); },
    });
  }

  // Ouvre le panneau « Paiements » de la facture (montant, moyen, date, référence)
  // au lieu d'un paiement intégral en virement imposé (16/10/2026).
  encaisser(f: any): void {
    const complete = this.factures().find((x) => x.id === f.id);
    if (!complete) { this.erreur.set('Facture introuvable dans la liste affichée — retirez les filtres.'); return; }
    this.ouvrirPaiements(complete);
    setTimeout(() => document.querySelector('tr.edition')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
  }
}
