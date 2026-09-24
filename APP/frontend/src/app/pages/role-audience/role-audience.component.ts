import { Component, inject, signal, OnInit, ViewChild, ElementRef } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, Dossier } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MenuActionsComponent, ActionMenuItem } from '../../core/menu-actions.component';
import { DocumentPreviewService } from '../../core/document-preview.service';

@Component({
  selector: 'app-role-audience',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, MenuActionsComponent],
  template: `
    <header class="page-head">
      <div>
        <h1>Rôle d'audience</h1>
        <p>Agenda hebdomadaire des audiences — semaine du {{ role()?.semaine_debut | date:'dd/MM/yyyy' }}
          au {{ role()?.semaine_fin | date:'dd/MM/yyyy' }}</p>
      </div>
      <div class="actions">
        <button class="btn ghost" (click)="semaineDecalage(-7)">← Semaine précédente</button>
        <!-- 24/09/2026 — gap signalé par l'utilisateur (cliquer 5-6 fois pour
             retrouver un dossier renvoyé plusieurs semaines plus loin) :
             sélecteur de date natif pour sauter directement à n'importe
             quelle semaine, en plus des boutons ← → (conservés pour parcourir
             semaine par semaine). [ngModel]/(ngModelChange) plutôt qu'un
             [(ngModel)] classique : le champ doit aussi refléter la position
             courante après un clic sur ← →, pas seulement piloter la
             navigation dans l'autre sens. -->
        <input class="in-semaine" type="date" [ngModel]="semaine" (ngModelChange)="allerASemaine($event)"
               name="semaineChoisie" title="Aller à la semaine du…" />
        <button class="btn ghost" (click)="semaineDecalage(7)">Semaine suivante →</button>
      </div>
    </header>

    @if (role(); as r) {
      <section class="panel">
        <div class="statut-bar">
          <span class="tag" [class.ok]="r.statut === 'diffuse'">
            {{ r.statut ? libelleStatut(r.statut) : 'Aucun rôle pour cette semaine' }}
          </span>
          @if (r.id && r.statut === 'brouillon' && auth.peut('audiences.role.valider')) { <button class="btn sm" (click)="valider(r.id)">Valider le rôle</button> }
          @if (r.id && r.statut === 'valide' && auth.peut('audiences.role.diffuser')) { <button class="btn sm" (click)="diffuser(r.id)">Diffuser à l'équipe</button> }
          @if (r.lignes?.length) {
            <button class="btn sm ghost" (click)="apercuRolePdf()">Aperçu (PDF)</button>
            <button class="btn sm ghost" (click)="telechargerRolePdf()">Télécharger (PDF)</button>
          }
        </div>

        @if (r.lignes?.length) {
          <div class="table-scroll">
          <table class="table-role" #tableRole>
            <!-- 23/09/2026 — 3e passe : Heure recollée à Date (retour sur la
                 2e passe, qui la collait à Juridiction — nouvelle demande
                 explicite de l'utilisateur). 4 colonnes figées désormais
                 (Date/Heure/Référence/Parties, voir "styles" plus bas). -->
            <tr><th class="col-date">Date</th><th class="col-heure">Heure</th><th class="col-ref">Référence</th><th class="col-parties">Parties</th><th>Juridiction</th><th>Procédure</th><th>Type audience</th><th>Motif dernier renvoi</th><th>Instructions</th><th>Resp dossier</th><th>Audiencier</th><th>Résultat</th><th>Suite programmée</th><th></th></tr>
            @for (l of r.lignes; track l.id) {
              <tr [class.urgent]="l.urgente" [class.facturation-alerte]="!!l.statut_facturation" [class.retour-en-retard]="estEnRetardSansRetour(l)">
                <td class="col-date">{{ l.date_prevue | date:'dd/MM/yyyy' }}</td>
                <td class="col-heure">{{ formaterHeure(l.heure) }}</td>
                <td class="col-ref"><a class="lien" [routerLink]="['/dossiers', l.dossier_id]">{{ l.dossier_numero }}</a></td>
                <td class="cell-dossier col-parties">
                  <!-- 23/09/2026 (5e passe) — retour sur le bloc "c/" centré
                       entre 2 lignes empilées (4e passe) : jugé trop large
                       une fois vu en vrai (le "c/" centré forçait chaque
                       partie sur sa propre ligne pleine largeur, gonflant
                       la colonne). Texte libre qui suit naturellement
                       (wrap normal, comme n'importe quel paragraphe) —
                       coupe où besoin, pas seulement après "c/". -->
                  <a class="lien" [routerLink]="['/dossiers', l.dossier_id]">{{ l.dossier_intitule }}</a>
                  @if (libelleStatutPartie(l.instance_statut_partie, l.instance_degre, l.instance_statut_partie_precision); as sp) {
                    <div class="muted" style="font-size:var(--fs-xs)">({{ sp }})</div>
                  }
                  @if (l.statut_facturation) {
                    <div>
                      <span class="tag" [class.attente]="l.statut_facturation === 'en_attente'" [class.haute]="l.statut_facturation === 'toujours_pas'">
                        {{ l.statut_facturation === 'toujours_pas' ? 'Toujours pas facturé' : 'En attente de facturation' }}
                      </span>
                    </div>
                  }
                </td>
                <td>{{ abregeJuridiction(l.juridiction) }}</td>
                <td>{{ libelleNatureProcedure(l.nature_procedure, l.nature_precision) }}</td>
                <td>{{ libelleTypeAudience(l.type) }}</td>
                <td>{{ libelleMotif(l.motif_dernier_renvoi, l.dernier_motif_precision) }}</td>
                <td>{{ l.instructions || '—' }}</td>
                <td>{{ l.responsable_dossier_code || '—' }}</td>
                <td>{{ l.avocat_code || '—' }}</td>
                <td>
                  @if (l.resultat) {
                    <span class="tag">{{ l.resultat }}</span>
                    @if (l.motif_renvoi) { <span class="muted"> · {{ libelleMotif(l.motif_renvoi, l.motif_renvoi_precision) }}</span> }
                  } @else { <span class="muted">à saisir</span> }
                </td>
                <td>
                  <!-- 24/09/2026 — « Suite programmée » séparée du Résultat
                       (gap signalé par l'utilisateur : information noyée,
                       invisible), avec aperçu déplié sur place plutôt qu'une
                       navigation vers une autre semaine (2e gap signalé :
                       on se perdait entre les 2 vues). Couvre aussi bien un
                       renvoi qu'une mise en délibéré avec date de prononcé
                       connue ("suite_date" vient de la même jointure côté
                       serveur, sans distinction de résultat). -->
                  @if (l.suite_date) {
                    <button class="lien" (click)="toggleApercuSuite(l)">
                      {{ apercuSuiteId() === l.audience_id ? '▾' : '▸' }} {{ l.suite_date | date:'dd/MM/yyyy' }}
                    </button>
                  } @else { <span class="muted">—</span> }
                </td>
                <td><app-menu-actions [actions]="actionsPourLigne(l)" /></td>
              </tr>
              @if (apercuSuiteId() === l.audience_id) {
                <tr class="apercu-suite">
                  <td colspan="14">
                    <strong>Prochaine audience programmée :</strong>
                    {{ l.suite_date | date:'dd/MM/yyyy' }}@if (l.suite_heure) { à {{ formaterHeure(l.suite_heure) }} }
                    — {{ abregeJuridiction(l.suite_juridiction) }} — {{ libelleTypeAudience(l.suite_type) }}
                    @if (l.suite_avocat_code) { — Audiencier : {{ l.suite_avocat_code }} }
                    @if (l.suite_instructions) { <div class="muted">Instructions : {{ l.suite_instructions }}</div> }
                    <div><button class="lien" (click)="allerASemaine(l.suite_date)">Aller à cette semaine →</button></div>
                  </td>
                </tr>
              }
              @if (editionAudienceId() === l.audience_id) {
                <tr class="edition">
                  <td colspan="14">
                    <!-- 23/09/2026 — 3e passe : ordre réaligné sur le nouvel
                         ordre des colonnes du tableau (Date, Heure,
                         [Référence/Parties], Juridiction, Procédure, Type
                         audience, Motif renvoi, Instructions, [Resp
                         dossier], Audiencier, [Résultat] — entre crochets :
                         non éditables ici). Comme avant, Instructions
                         (col2, pleine largeur) est reléguée en dernier
                         plutôt qu'à sa place stricte (avant Audiencier),
                         pour que la grille 2 colonnes se remplisse sans
                         case vide (Type d'audience/Audiencier resteraient
                         sinon seuls sur leur ligne).
                         8e passe : "Motif dernier renvoi" (gap trouvé par
                         l'utilisateur — jusqu'ici affiché en lecture seule
                         sans aucun moyen de corriger un motif recopié à
                         tort après un renvoi) devient éditable ici, placé
                         juste avant Instructions comme dans le tableau —
                         laisse une case vide sur sa ligne (7 champs fixes,
                         nombre impair), accepté comme les autres petits
                         écarts de ce même formulaire (ex. "Préciser"
                         conditionnel). -->
                    <div class="grid2">
                      <div><label>Date</label><input class="in" type="date" [(ngModel)]="editAudience.date_audience" name="eaDate" /></div>
                      <div><label>Heure</label><input class="in" type="time" [(ngModel)]="editAudience.heure" name="eaHeure" /></div>
                      <div><label>Juridiction</label><input class="in" [(ngModel)]="editAudience.juridiction" name="eaJuridiction" /></div>
                      <div>
                        <label>Procédure</label>
                        <select class="in" [(ngModel)]="editAudience.nature_procedure" name="eaNature">
                          <option value="">—</option>
                          @for (n of naturesProcedure(); track n.code) { <option [value]="n.code">{{ n.libelle }}</option> }
                        </select>
                      </div>
                      @if (editAudience.nature_procedure === 'autre') {
                        <div><label>Préciser</label><input class="in" [(ngModel)]="editAudience.nature_precision" name="eaNaturePrecision" /></div>
                      }
                      <div>
                        <label>Type d'audience</label>
                        <select class="in" [(ngModel)]="editAudience.type" name="eaType">
                          <option value="mise_en_etat">Mise en état</option>
                          <option value="plaidoirie">Plaidoirie</option>
                          <option value="conciliation">Conciliation</option>
                          <option value="refere">Référé</option>
                          <option value="prononce">Prononcé</option>
                          <option value="autre">Autre</option>
                        </select>
                      </div>
                      <div>
                        <label>Motif dernier renvoi</label>
                        <select class="in" [(ngModel)]="editAudience.dernier_motif_id" name="eaDernierMotif">
                          <option value="">—</option>
                          @for (m of motifs(); track m.id) { <option [value]="m.id">{{ m.libelle }}</option> }
                        </select>
                        <span class="hint">Recopié automatiquement depuis l'audience précédente après un renvoi — à corriger ici seulement si le motif recopié est faux.</span>
                      </div>
                      @if (motifEstAutre(editAudience.dernier_motif_id)) {
                        <div><label>Préciser</label><input class="in" [(ngModel)]="editAudience.dernier_motif_precision" name="eaDernierMotifPrecision" /></div>
                      }
                      <div>
                        <label>Audiencier</label>
                        <select class="in" [(ngModel)]="editAudience.avocat_id" name="eaAvocat">
                          <option value="">—</option>
                          @for (m of membres(); track m.id) { <option [value]="m.id">{{ m.prenom }} {{ m.nom }}</option> }
                        </select>
                      </div>
                      <div class="col2"><label>Instructions</label><input class="in" [(ngModel)]="editAudience.instructions" name="eaInstructions" /></div>
                    </div>
                    <div class="actions">
                      <button class="btn" (click)="enregistrerEditionAudience(l)">Enregistrer</button>
                      <button class="btn ghost" (click)="annulerEditionAudience()">Annuler</button>
                    </div>
                    @if (erreurEditionAudience()) { <p class="err">{{ erreurEditionAudience() }}</p> }
                  </td>
                </tr>
              }
            }
          </table>
          </div>
        } @else {
          <p class="muted">Aucune audience programmée cette semaine.</p>
        }
      </section>

      @if (ligneRetour(); as l) {
        <section class="panel" #panneauRetour>
          <!-- 24/09/2026 — guillemets doubles pour "Retour d'audience" :
               une chaîne Angular entre apostrophes contenant elle-même une
               apostrophe ('Retour d\'audience') casse le parseur
               d'expression du template (Angular affiche alors tout
               l'interpolation en texte brut au lieu de l'évaluer, sans
               erreur de build ni de runtime — bug trouvé par vérification
               visuelle réelle, pas seulement par la compilation). -->
          <h3>{{ correctionRetour() ? 'Corriger le retour' : "Retour d'audience" }} — {{ l.dossier_numero }} — {{ l.dossier_intitule }} ({{ l.date_prevue | date:'dd/MM/yyyy' }})</h3>
          <div class="grid2">
            <div>
              <label>Résultat</label>
              <select class="in" [(ngModel)]="retourForm.resultat" name="resultat">
                <option value="renvoi">Renvoi</option>
                <option value="delibere">Mise en délibéré</option>
                <option value="plaide">Plaidée</option>
                <option value="radiation">Radiation</option>
                <option value="conciliation">Conciliation</option>
                <option value="autre">Autre</option>
              </select>
            </div>
            @if (retourForm.resultat === 'renvoi') {
              <div>
                <label>Motif du renvoi</label>
                <select class="in" [(ngModel)]="retourForm.motif_renvoi_id" name="motif">
                  <option value="">—</option>
                  @for (m of motifs(); track m.id) { <option [value]="m.id">{{ m.libelle }}</option> }
                </select>
              </div>
              @if (motifEstAutre(retourForm.motif_renvoi_id)) {
                <div><label>Préciser</label><input class="in" [(ngModel)]="retourForm.motif_renvoi_precision" name="motifPrecision" /></div>
              }
            }
            @if (retourForm.resultat === 'renvoi' || retourForm.resultat === 'delibere') {
              <div>
                <!-- 24/09/2026 — obligatoire pour un renvoi (gap signalé par
                     l'utilisateur : sans elle, aucune audience future
                     n'était jamais programmée nulle part) ; étendue à
                     « Mise en délibéré » (facultative — date de prononcé
                     pas toujours connue le jour même), décision explicite
                     de l'utilisateur. Validée côté client (voir
                     enregistrerRetour()) ET côté serveur. -->
                <label>{{ retourForm.resultat === 'renvoi' ? 'Prochaine date' : 'Date de prononcé' }}
                  <span class="muted">{{ retourForm.resultat === 'renvoi' ? '(obligatoire pour un renvoi)' : '(facultatif)' }}</span></label>
                <input class="in" type="date" [(ngModel)]="retourForm.prochaine_date" name="prochaine" />
              </div>
            }
            <div class="col2">
              <label>Observations</label>
              <input class="in" [(ngModel)]="retourForm.observations" name="obs" />
            </div>
          </div>
          <div class="actions">
            <button class="btn" (click)="enregistrerRetour(l.audience_id)">{{ correctionRetour() ? 'Enregistrer la correction' : 'Enregistrer le retour' }}</button>
            <button class="btn ghost" (click)="ligneRetour.set(null)">Annuler</button>
          </div>
          @if (erreur()) { <p class="err">{{ erreur() }}</p> }
        </section>
      }
    }

    <section class="panel">
      <h3>Diligences</h3>
      <p class="muted" style="margin-bottom:12px">Rendez-vous et démarches de terrain (audition en juridiction, enquête, formalité, expertise…) — distinct du rôle hebdomadaire ci-dessus. Peut aussi être créée automatiquement par le Registre du courrier (ex. convocation reçue sur un dossier).</p>
      @if (diligences().length) {
        <table>
          <tr><th>Date</th><th>Heure</th><th>Type</th><th>Dossier</th><th>Membre</th><th>Lieu</th><th>Objet</th><th></th></tr>
          @for (dl of diligences(); track dl.id) {
            <tr [class.retour-en-retard]="estDiligenceEnRetard(dl)">
              <td>{{ dl.date_diligence | date:'dd/MM/yyyy' }}</td>
              <td>{{ dl.heure || '—' }}</td>
              <td>{{ libelleTypeDiligence(dl.type_diligence) }}@if (dl.type_diligence === 'autre' && dl.type_precision) { : {{ dl.type_precision }} }</td>
              <td>@if (dl.dossier_id) { <a class="lien" [routerLink]="['/dossiers', dl.dossier_id]">{{ dl.dossier_numero }}</a> } @else { — }</td>
              <td>{{ dl.membre_nom || '—' }}</td>
              <td>{{ dl.lieu || '—' }}</td>
              <td>{{ dl.objet || '—' }}</td>
              <td><app-menu-actions [actions]="actionsPourDiligence(dl)" /></td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucune diligence à faire.</p> }

      @if (auth.peut('audiences.diligence.gerer')) {
        <h4 style="margin:18px 0 8px">Nouvelle diligence</h4>
        <div class="grid2">
          <div>
            <label>Type</label>
            <select class="in" [(ngModel)]="nouvelleDiligence.type_diligence" name="dltype">
              @for (t of typesDiligence(); track t.code) { <option [value]="t.code">{{ t.libelle }}</option> }
            </select>
          </div>
          @if (nouvelleDiligence.type_diligence === 'autre') {
            <div><label>Préciser</label><input class="in" [(ngModel)]="nouvelleDiligence.type_precision" name="dlprecision" /></div>
          }
          <div class="col2">
            <label>Dossier (optionnel)</label>
            <input class="in" [(ngModel)]="dlDossierRecherche" name="dlDossierRecherche"
                   (ngModelChange)="rechercherDossiersDiligence()" placeholder="Rechercher un dossier par numéro ou intitulé…" />
            @if (dlDossierResultats().length) {
              <div class="suggestions">
                @for (d of dlDossierResultats(); track d.id) {
                  <button type="button" class="chip" (click)="choisirDossierDiligence(d)">{{ d.numero }} — {{ d.intitule }}</button>
                }
              </div>
            }
            @if (nouvelleDiligence.dossier_id) { <p class="muted">Sélectionné : {{ dlDossierLabel }} <button class="lien" (click)="viderDossierDiligence()">retirer</button></p> }
          </div>
          <div>
            <label>Membre assigné</label>
            <select class="in" [(ngModel)]="nouvelleDiligence.membre_id" name="dlmembre">
              <option value="">—</option>
              @for (u of membres(); track u.id) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
            </select>
          </div>
          <div><label>Date</label><input class="in" type="date" [(ngModel)]="nouvelleDiligence.date_diligence" name="dldate" /></div>
          <div><label>Heure</label><input class="in" type="time" [(ngModel)]="nouvelleDiligence.heure" name="dlheure" /></div>
          <div><label>Lieu</label><input class="in" [(ngModel)]="nouvelleDiligence.lieu" name="dllieu" /></div>
          <div class="col2"><label>Objet</label><input class="in" [(ngModel)]="nouvelleDiligence.objet" name="dlobjet" /></div>
        </div>
        <button class="btn" (click)="ajouterDiligence()" [disabled]="!nouvelleDiligence.date_diligence">Ajouter</button>
      }
    </section>

    @if (auth.peut('audiences.ligne.creer')) {
    <section class="panel">
      <h3>Programmer une audience</h3>
      <div class="grid2">
        <div class="col2">
          <label>Dossier</label>
          <input class="in" [(ngModel)]="dossierRecherche" name="dossierRecherche"
                 (ngModelChange)="rechercherDossiers()" placeholder="Rechercher un dossier par numéro ou intitulé…" />
          @if (dossierResultats().length) {
            <div class="suggestions">
              @for (d of dossierResultats(); track d.id) {
                <button type="button" class="chip" (click)="choisirDossier(d)">{{ d.numero }} — {{ d.intitule }}</button>
              }
            </div>
          }
          @if (nouvelleLigne.dossier_id) { <p class="muted">Sélectionné : {{ dossierLabel }}</p> }
        </div>
        <div><label>Date</label><input class="in" type="date" [(ngModel)]="nouvelleLigne.date_prevue" name="date" /></div>
        <div><label>Heure</label><input class="in" type="time" [(ngModel)]="nouvelleLigne.heure" name="heure" /></div>
        <div><label>Juridiction</label><input class="in" [(ngModel)]="nouvelleLigne.juridiction" name="juridiction" /></div>
        <div>
          <label>Type d'audience</label>
          <select class="in" [(ngModel)]="nouvelleLigne.type" name="type">
            <option value="mise_en_etat">Mise en état</option>
            <option value="plaidoirie">Plaidoirie</option>
            <option value="conciliation">Conciliation</option>
            <option value="refere">Référé</option>
            <option value="prononce">Prononcé</option>
            <option value="autre">Autre</option>
          </select>
        </div>
        <div>
          <label>Audiencier (facultatif)</label>
          <select class="in" [(ngModel)]="nouvelleLigne.avocat_id" name="audiencier">
            <option value="">—</option>
            @for (m of membres(); track m.id) { <option [value]="m.id">{{ m.prenom }} {{ m.nom }}</option> }
          </select>
          <span class="hint">Qui se rend effectivement à cette audience — peut différer du responsable du dossier, et changer d'une semaine à l'autre (dispatching). Modifiable ensuite via « Modifier ».</span>
        </div>
        <div>
          <label>Procédure (facultatif)</label>
          <select class="in" [(ngModel)]="nouvelleLigne.nature_procedure" name="nature">
            <option value="">—</option>
            @for (n of naturesProcedure(); track n.code) { <option [value]="n.code">{{ n.libelle }}</option> }
          </select>
        </div>
        @if (nouvelleLigne.nature_procedure === 'autre') {
          <div><label>Préciser</label><input class="in" [(ngModel)]="nouvelleLigne.nature_precision" name="naturePrecision" /></div>
        }
        <div class="col2"><label>Instructions à l'audiencier</label><input class="in" [(ngModel)]="nouvelleLigne.instructions" name="instr" /></div>
        <div><label><input type="checkbox" [(ngModel)]="nouvelleLigne.urgente" name="urgente" /> Urgente / dernière minute</label></div>
      </div>
      <button class="btn" (click)="ajouter()" [disabled]="!nouvelleLigne.dossier_id || !nouvelleLigne.date_prevue">Ajouter au rôle</button>
      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
    </section>
    }
  `,
  styles: [`
    .actions{display:flex;gap:8px}
    /* 24/09/2026 — sélecteur "Aller à la semaine du…" : dimensions alignées
       sur les boutons ghost voisins, sans reprendre .in (pensée pour un
       champ de formulaire pleine largeur avec marge basse, inadaptée dans
       une barre d'actions flex). */
    .in-semaine{border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:var(--fs-sm)}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer}
    .btn.ghost{background:#fff;border:1px solid var(--line);color:var(--slate)}
    .btn.sm{padding:6px 11px;font-size:var(--fs-sm)}
    .btn:disabled{opacity:.6}
    .statut-bar{display:flex;align-items:center;gap:12px;margin-bottom:14px}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    tr.urgent td{background:#fff5f4}
    tr.facturation-alerte td{background:#fdf6e8}
    /* 24/09/2026 — aperçu inline "Suite programmée" : texte à gauche
       (contrairement au reste du tableau, centré), fond légèrement teinté
       pour se distinguer d'une ligne normale sans reprendre le ton d'alerte
       (ambre) déjà utilisé par .facturation-alerte. */
    tr.apercu-suite td{background:#f6f8fb;text-align:left}
    /* 24/09/2026 — surlignage "retour manquant" (audience/diligence dont la
       date est passée sans résultat/statut). Rouge assez marqué (pas le
       ton ambre déjà pris par .facturation-alerte) : c'est un risque
       procédural, pas une simple vigilance financière. */
    tr.retour-en-retard td{background:#fdeceb}
    /* 23/09/2026 — 2e passe, sur nouvelle demande de l'utilisateur : Dossier
       (référence + intitulé combinés) scindé en 2 colonnes figées séparées
       — Référence (courte, nowrap, "incompressible" comme Date) et Parties
       (client/partie adverse empilés avec "c/" centré, WRAP autorisé —
       n'a plus besoin d'une seule ligne, cf. ".col-parties" plus bas).
       Corrige au passage le vrai défaut de la 1re passe : forcer Dossier en
       nowrap pour le figer pouvait rendre le bloc figé démesurément large
       sur un intitulé long.
       3e passe (23/09/2026) : Heure revient se coller à Date (2e colonne
       figée) — la 2e passe l'avait recollée à Juridiction sur demande
       explicite de l'utilisateur, qui est finalement revenu dessus. 4
       colonnes figées désormais (Date/Heure/Référence/Parties,
       position:sticky, même technique que la colonne Action de la
       Matrice le 11/09/2026), le reste (Juridiction→Résultat, 8
       colonnes) défile horizontalement dans ".table-scroll", chacune sur
       une seule ligne (nowrap, largeur naturelle). */
    .cell-dossier > *{margin-top:5px}
    .cell-dossier > *:first-child{margin-top:0}
    table.table-role th,table.table-role td{text-align:center}
    /* ⚠️ Colonnes figées par CLASSE (.col-date/.col-heure/.col-ref/
       .col-parties), jamais par ":nth-child" : la ligne d'édition
       (tr.edition) n'a qu'une seule cellule ("colspan=13"), qui est
       structurellement son 1er enfant — un sélecteur "td:nth-child(1)"
       la ciblerait aussi et lui collerait à tort "position:sticky"/
       largeur fixe (même piège déjà rencontré sur la colonne Action de
       la Matrice le 11/09/2026, ici évité dès le départ plutôt que
       corrigé après coup). Les colonnes défilantes (Juridiction→Résultat)
       restent en ":nth-child", sans risque : cette ligne d'édition n'a
       jamais de 5e cellule ou plus. */
    /* ⚠️ "border-collapse:collapse" (hérité du global styles.css) rend
       "position:sticky" sur des cellules de tableau peu fiable dans
       Chromium — "separate" + "border-spacing:0" scopé à cette seule
       table, sans changement visuel notable (bordures 1px déjà fines).
       ⚠️ Piège plus sérieux (1re passe, toujours valable ici) : des
       offsets "left" codés en dur supposaient qu'un "width" en px sur une
       colonne produirait exactement la largeur rendue — faux, notamment
       pour une colonne "compressible" (wrap autorisé, comme Parties ici)
       face à des colonnes voisines nowrap qui, elles, ne cèdent jamais
       de largeur. Les offsets "left" restent donc calculés en JS après
       rendu ("recalculerColonnesFigees()", variables CSS "--left-heure"/
       "--left-ref"/"--left-parties") — robuste quel que soit le résultat
       réel de la négociation de largeurs entre colonnes. Parties reçoit
       en plus un "min-width" (pas un "width" simple, qui avait échoué
       pareil en 1re passe) : un "min-width" est un plancher réellement
       respecté par le moteur de rendu, contrairement à "width" qui n'est
       qu'une suggestion pour l'algorithme de layout auto des tableaux. */
    table.table-role{border-collapse:separate;border-spacing:0}
    table.table-role .col-date,table.table-role .col-heure,table.table-role .col-ref{white-space:nowrap}
    table.table-role .col-ref,table.table-role .col-parties{text-align:left}
    table.table-role .col-parties{min-width:150px;max-width:280px}
    table.table-role .col-date,table.table-role .col-heure,table.table-role .col-ref,table.table-role .col-parties{position:sticky;background:#fff}
    table.table-role .col-date{left:0}
    table.table-role .col-heure{left:var(--left-heure, 90px)}
    table.table-role .col-ref{left:var(--left-ref, 140px)}
    table.table-role .col-parties{left:var(--left-parties, 270px);box-shadow:2px 0 4px rgba(16,24,40,.06)}
    table.table-role th.col-date,table.table-role th.col-heure,table.table-role th.col-ref,table.table-role th.col-parties{z-index:3}
    table.table-role td.col-date,table.table-role td.col-heure,table.table-role td.col-ref,table.table-role td.col-parties{z-index:1}
    tr.urgent td.col-date,tr.urgent td.col-heure,tr.urgent td.col-ref,tr.urgent td.col-parties{background:#fff5f4}
    tr.facturation-alerte td.col-date,tr.facturation-alerte td.col-heure,tr.facturation-alerte td.col-ref,tr.facturation-alerte td.col-parties{background:#fdf6e8}
    table.table-role th:nth-child(n+5):nth-child(-n+12),
    table.table-role td:nth-child(n+5):nth-child(-n+12){white-space:nowrap}
    table.table-role th:nth-child(6),table.table-role td:nth-child(6),
    table.table-role th:nth-child(8),table.table-role td:nth-child(8),
    table.table-role th:nth-child(9),table.table-role td:nth-child(9){text-align:left}
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md)}
    label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:720px}
    .col2{grid-column:1 / -1}
    .suggestions{display:flex;flex-wrap:wrap;gap:6px;margin:-6px 0 12px}
    .chip{background:#fff;border:1px solid var(--line);border-radius:12px;padding:5px 11px;font-size:var(--fs-sm);cursor:pointer}
  `],
})
export class RoleAudienceComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly preview = inject(DocumentPreviewService);
  readonly role = signal<any | null>(null);
  readonly motifs = signal<{ id: string; libelle: string }[]>([]);
  readonly dossierResultats = signal<Dossier[]>([]);
  readonly ligneRetour = signal<any | null>(null);
  // 24/09/2026 — distingue la 1re saisie (POST, panneau vierge) de la
  // correction d'un retour déjà enregistré (PUT, panneau pré-rempli) —
  // même panneau, même formulaire, seule la cible de l'appel change.
  readonly correctionRetour = signal(false);
  readonly erreur = signal('');
  // 24/09/2026 — aperçu inline de la « Suite programmée » (colonne dédiée) :
  // affiche la prochaine audience directement sous sa ligne d'origine, sans
  // changer de semaine (gap signalé par l'utilisateur — on se perdait entre
  // les 2 vues en cliquant sur l'ancien lien « Renvoyée au... »).
  readonly apercuSuiteId = signal<string | null>(null);
  @ViewChild('panneauRetour') panneauRetour?: ElementRef<HTMLElement>;
  @ViewChild('tableRole') tableRoleEl?: ElementRef<HTMLTableElement>;

  // 21/09/2026 — gap comblé : édition d'une audience déjà inscrite au rôle
  // (date/heure/juridiction/type/avocat), jamais le résultat (voir
  // ligneRetour/retourForm ci-dessus, qui reste le seul canal pour ça).
  readonly editionAudienceId = signal<string | null>(null);
  readonly erreurEditionAudience = signal('');
  editAudience: any = {};

  // Diligences (11/09/2026, gap comblé — voir CLAUDE.md/HISTORY.md).
  readonly diligences = signal<any[]>([]);
  readonly typesDiligence = signal<{ code: string; libelle: string }[]>([]);
  readonly membres = signal<any[]>([]);
  readonly dlDossierResultats = signal<Dossier[]>([]);
  // 21/09/2026 — « Nature de la procédure » : gap comblé — colonne
  // `audiences.nature_procedure` prévue au schéma (catalogue
  // `listes_valeurs('nature_procedure')`, déjà seedé : Bail/expulsion,
  // Divorce, Recouvrement…) mais jamais câblée à aucune route ni écran.
  readonly naturesProcedure = signal<{ code: string; libelle: string }[]>([]);
  dlDossierRecherche = '';
  dlDossierLabel = '';
  nouvelleDiligence: any = { type_diligence: 'diligence' };

  semaine = new Date().toISOString().slice(0, 10);
  dossierRecherche = '';
  dossierLabel = '';
  nouvelleLigne: any = { type: 'mise_en_etat', urgente: false };
  retourForm: any = { resultat: 'renvoi', motif_renvoi_id: '', motif_renvoi_precision: '', prochaine_date: '', observations: '' };

  libelleStatut(s: string): string {
    return ({ brouillon: 'Brouillon', valide: 'Validé', diffuse: 'Diffusé' } as Record<string, string>)[s] ?? s;
  }

  // 24/09/2026 — gap signalé par l'utilisateur (« quelle solution existe-t-il
  // lorsqu'une audience n'a pas eu de retour ») : surlignage direct sur la
  // ligne dès que sa date est déjà passée sans résultat saisi — complète la
  // tuile Tableau de bord (visibilité proactive) et l'e-mail de relance
  // (escalade) par un repère immédiat quand on regarde une semaine passée.
  // Comparaison sur la partie date seule (YYYY-MM-DD), pas d'objet Date
  // complet, pour éviter tout piège de fuseau horaire.
  estEnRetardSansRetour(l: any): boolean {
    if (l.resultat || !l.date_prevue) return false;
    return new Date(l.date_prevue).toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10);
  }

  // Même logique pour les diligences — la liste ci-dessous est déjà
  // filtrée à statut "a_faire" (chargerDiligences()), il suffit donc de
  // comparer la date.
  estDiligenceEnRetard(dl: any): boolean {
    if (!dl.date_diligence) return false;
    return new Date(dl.date_diligence).toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10);
  }

  // 21/09/2026 — a.heure (TIME Postgres) revient sérialisé avec les secondes
  // ("09:00:00") : n'affiche que l'heure et la minute, écran comme impression.
  formaterHeure(h: string | null | undefined): string {
    return h ? h.slice(0, 5) : '—';
  }

  // 21/09/2026 — l.type affichait jusqu'ici le code d'ENUM brut
  // ("mise_en_etat"/"refere") au lieu d'un libellé français, seul le
  // <select> de saisie avait déjà ces intitulés.
  libelleTypeAudience(code: string): string {
    return ({
      mise_en_etat: 'Mise en état', plaidoirie: 'Plaidoirie', conciliation: 'Conciliation',
      refere: 'Référé', prononce: 'Prononcé', autre: 'Autre',
    } as Record<string, string>)[code] ?? code;
  }

  libelleNatureProcedure(code: string | null | undefined, precision: string | null | undefined): string {
    if (!code) return '—';
    if (code === 'autre') return precision || 'Autre';
    return this.naturesProcedure().find((n) => n.code === code)?.libelle ?? code;
  }

  // 23/09/2026 — "motifs_renvoi" est un catalogue de base (id + libelle),
  // pas un ENUM avec un code stable comme nature_procedure/type_audience :
  // "Autre (préciser)" ne se repère que par correspondance exacte de
  // libellé. motifEstAutre() sert à afficher/masquer le champ "Préciser"
  // dans les 2 formulaires qui utilisent ce catalogue (Saisir le retour,
  // Modifier) ; libelleMotif() combine libellé + précision à l'affichage
  // (tableau, impression), même patron que libelleNatureProcedure().
  motifEstAutre(id: string | null | undefined): boolean {
    return !!id && this.motifs().find((m) => m.id === id)?.libelle === 'Autre (préciser)';
  }

  libelleMotif(libelle: string | null | undefined, precision: string | null | undefined): string {
    if (!libelle) return '—';
    if (libelle === 'Autre (préciser)') return precision || 'Autre';
    return libelle;
  }

  // 23/09/2026 — découpage de l'intitulé du dossier ("Client c/ Partie
  // adverse", convention du cabinet depuis le 31/08/2026) pour la colonne
  // Parties du Rôle d'audience — pas de champ structuré côté API, simple
  // partage sur le séparateur littéral. Un dossier Conseil (pas de "c/")
  // retombe sur une seule ligne via partiesGauche() seul.
  partiesGauche(intitule: string | null | undefined): string {
    if (!intitule) return '—';
    const i = intitule.indexOf(' c/ ');
    return i === -1 ? intitule : intitule.slice(0, i);
  }

  partiesDroite(intitule: string | null | undefined): string | null {
    if (!intitule) return null;
    const i = intitule.indexOf(' c/ ');
    return i === -1 ? null : intitule.slice(i + 4);
  }

  // 21/09/2026 — abrégé d'affichage uniquement (jamais écrit en base, la
  // saisie reste en texte libre) : ne couvre que le motif décrit par
  // l'utilisateur (« TGI CI, CII... TGI Kati ») — toute autre juridiction
  // (Tribunal de Commerce, Cour d'Appel, CCJA...) reste affichée telle que
  // saisie, faute de convention d'abréviation communiquée pour ces cas.
  abregeJuridiction(j: string | null | undefined): string {
    if (!j) return '—';
    let m = j.match(/^Tribunal de Grande Instance de la Commune\s+([IVXLCDM]+)$/i);
    if (m) return `TGI C${m[1].toUpperCase()}`;
    m = j.match(/^Tribunal de Grande Instance de\s+(.+)$/i);
    if (m) return `TGI ${m[1]}`;
    return j;
  }

  libelleTypeDiligence(code: string): string {
    return this.typesDiligence().find((t) => t.code === code)?.libelle ?? code;
  }

  // Statut de la partie (19/09/2026) — même logique que dossiers.component.ts
  // et dossier-detail.component.ts (voir CLAUDE.md pour la conception).
  private readonly libellesStatutPartie: Record<string, Record<string, string>> = {
    demandeur: { appel: 'Appelant', cassation: 'Demandeur au pourvoi', opposition: 'Demandeur en opposition', default: 'Demandeur' },
    defendeur: { appel: 'Intimé', cassation: 'Défendeur au pourvoi', opposition: 'Défendeur en opposition', default: 'Défendeur' },
    intervenant_volontaire: { default: 'Intervenant volontaire' },
    intervenant_force: { default: 'Intervenant forcé' },
    prevenu: { default: 'Prévenu' },
    partie_civile: { default: 'Partie civile' },
  };
  libelleStatutPartie(statut?: string | null, degre?: string | null, precision?: string | null): string {
    if (!statut) return '';
    if (statut === 'autre') return precision?.trim() ? precision.trim() : 'Autre';
    const table = this.libellesStatutPartie[statut];
    if (!table) return statut;
    return table[degre || ''] || table['default'];
  }

  ngOnInit(): void {
    this.charger();
    this.api.motifsRenvoi().subscribe({ next: (m) => this.motifs.set(m) });
    this.api.listesValeurs('type_diligence').subscribe({ next: (v) => this.typesDiligence.set(v) });
    this.api.listesValeurs('nature_procedure').subscribe({ next: (v) => this.naturesProcedure.set(v) });
    this.api.utilisateurs().subscribe({ next: (u) => this.membres.set(u) });
    this.chargerDiligences();
  }

  charger(): void {
    this.api.roleAudience(this.semaine).subscribe({
      next: (r) => {
        this.role.set(r);
        // 23/09/2026 — laisser le DOM peindre les nouvelles lignes avant de
        // mesurer (setTimeout, même patron que le défilement automatique
        // du 13/09/2026) : sans ce délai, la table pourrait ne pas encore
        // exister au moment de la lecture.
        setTimeout(() => this.recalculerColonnesFigees());
      },
    });
  }

  // 23/09/2026 — offsets "left" des colonnes figées (Date/Heure/Référence/
  // Parties) calculés à partir des largeurs RÉELLEMENT rendues (pas de px
  // codés en dur — voir le commentaire détaillé dans "styles" sur pourquoi
  // une valeur fixe s'est révélée fausse). Recalculé à chaque chargement de
  // rôle (changement de semaine compris) puisque le contenu — donc les
  // largeurs — change.
  recalculerColonnesFigees(): void {
    const table = this.tableRoleEl?.nativeElement;
    if (!table) return;
    const dateCell = table.querySelector('th.col-date') as HTMLElement | null;
    const heureCell = table.querySelector('th.col-heure') as HTMLElement | null;
    const refCell = table.querySelector('th.col-ref') as HTMLElement | null;
    if (!dateCell || !heureCell || !refCell) return;
    const largeurDate = dateCell.getBoundingClientRect().width;
    const largeurHeure = heureCell.getBoundingClientRect().width;
    const largeurRef = refCell.getBoundingClientRect().width;
    table.style.setProperty('--left-heure', `${largeurDate}px`);
    table.style.setProperty('--left-ref', `${largeurDate + largeurHeure}px`);
    table.style.setProperty('--left-parties', `${largeurDate + largeurHeure + largeurRef}px`);
  }

  chargerDiligences(): void {
    this.api.diligences({ statut: 'a_faire' }).subscribe({ next: (d) => this.diligences.set(d) });
  }

  rechercherDossiersDiligence(): void {
    this.nouvelleDiligence.dossier_id = null;
    if (this.dlDossierRecherche.length < 2) { this.dlDossierResultats.set([]); return; }
    this.api.dossiers(this.dlDossierRecherche).subscribe({ next: (d) => this.dlDossierResultats.set(d) });
  }

  choisirDossierDiligence(d: Dossier): void {
    this.nouvelleDiligence.dossier_id = d.id;
    this.dlDossierLabel = `${d.numero} — ${d.intitule}`;
    this.dlDossierResultats.set([]);
    this.dlDossierRecherche = '';
  }

  viderDossierDiligence(): void {
    this.nouvelleDiligence.dossier_id = null;
    this.dlDossierLabel = '';
  }

  ajouterDiligence(): void {
    this.erreur.set('');
    this.api.creerDiligence(this.nouvelleDiligence).subscribe({
      next: () => {
        this.nouvelleDiligence = { type_diligence: 'diligence' };
        this.dlDossierLabel = '';
        this.chargerDiligences();
      },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Ajout impossible.'),
    });
  }

  // Menu "⋮" (19/09/2026).
  actionsPourDiligence(dl: any): ActionMenuItem[] {
    if (!this.auth.peut('audiences.diligence.gerer')) return [];
    return [
      { label: 'Fait', action: () => this.majDiligence(dl, 'fait') },
      { label: 'Reporter', action: () => this.majDiligence(dl, 'reporte') },
      { label: 'Annuler', action: () => this.majDiligence(dl, 'annule'), danger: true },
    ];
  }

  majDiligence(dl: any, statut: string): void {
    this.api.majStatutDiligence(dl.id, statut).subscribe({ next: () => this.chargerDiligences() });
  }

  semaineDecalage(jours: number): void {
    const d = new Date(this.semaine + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + jours);
    this.semaine = d.toISOString().slice(0, 10);
    this.charger();
  }

  rechercherDossiers(): void {
    this.nouvelleLigne.dossier_id = null;
    if (this.dossierRecherche.length < 2) { this.dossierResultats.set([]); return; }
    this.api.dossiers(this.dossierRecherche).subscribe({ next: (d) => this.dossierResultats.set(d) });
  }

  choisirDossier(d: Dossier): void {
    this.nouvelleLigne.dossier_id = d.id;
    this.dossierLabel = `${d.numero} — ${d.intitule}`;
    this.dossierResultats.set([]);
    this.dossierRecherche = '';
  }

  ajouter(): void {
    this.erreur.set('');
    this.api.ajouterLigneRole(this.nouvelleLigne).subscribe({
      next: () => {
        this.nouvelleLigne = { type: 'mise_en_etat', urgente: false };
        this.dossierLabel = '';
        this.charger();
      },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Ajout impossible.'),
    });
  }

  valider(id: string): void {
    this.api.validerRole(id).subscribe({ next: () => this.charger() });
  }

  diffuser(id: string): void {
    this.api.diffuserRole(id).subscribe({ next: () => this.charger() });
  }

  ouvrirRetour(l: any): void {
    this.erreur.set('');
    this.correctionRetour.set(false);
    this.retourForm = { resultat: 'renvoi', motif_renvoi_id: '', motif_renvoi_precision: '', prochaine_date: '', observations: '' };
    this.ligneRetour.set(l);
    // 21/09/2026 — la tuile s'insère juste après le tableau du rôle, potentiellement
    // hors écran si la ligne cliquée est loin dans le tableau : défilement auto.
    setTimeout(() => this.panneauRetour?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  // 24/09/2026 — corrige un retour déjà saisi (date de renvoi erronée,
  // motif faux…), demande explicite de l'utilisateur. Pré-remplit le même
  // panneau depuis les valeurs déjà connues de la ligne (l.resultat/
  // l.motif_renvoi_id/l.motif_renvoi_precision/l.prochaine_date/
  // l.observations, toutes déjà exposées par GET /roles-audience).
  ouvrirCorrectionRetour(l: any): void {
    this.erreur.set('');
    this.correctionRetour.set(true);
    this.retourForm = {
      resultat: l.resultat || 'renvoi',
      motif_renvoi_id: l.motif_renvoi_id || '',
      motif_renvoi_precision: l.motif_renvoi_precision || '',
      prochaine_date: l.prochaine_date ? new Date(l.prochaine_date).toISOString().slice(0, 10) : '',
      observations: l.observations || '',
    };
    this.ligneRetour.set(l);
    setTimeout(() => this.panneauRetour?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  enregistrerRetour(audienceId: string): void {
    this.erreur.set('');
    // 24/09/2026 — validation côté client de la même règle que le serveur
    // (prochaine date obligatoire pour un renvoi) : évite un aller-retour
    // réseau pour une erreur déjà détectable ici, message affiché
    // directement dans le panneau (pas seulement tout en bas de l'écran).
    if (this.retourForm.resultat === 'renvoi' && !this.retourForm.prochaine_date) {
      this.erreur.set('La prochaine date est obligatoire pour un renvoi.');
      return;
    }
    // 23/09/2026 — motif_renvoi_precision n'est envoyée que si le motif
    // sélectionné est bien "Autre (préciser)" : évite qu'un texte tapé
    // puis abandonné (sélection changée vers un motif normal, le champ
    // "Préciser" disparaît du formulaire mais garderait sa valeur en
    // mémoire tant qu'il n'est pas explicitement vidé) ne se retrouve
    // enregistré sous un motif qui n'en a plus besoin.
    const precisionValide = this.motifEstAutre(this.retourForm.motif_renvoi_id);
    const payload = {
      ...this.retourForm,
      prochaine_date: this.retourForm.prochaine_date || null,
      motif_renvoi_id: this.retourForm.motif_renvoi_id || null,
      motif_renvoi_precision: precisionValide ? (this.retourForm.motif_renvoi_precision || null) : null,
    };
    const appel = this.correctionRetour()
      ? this.api.corrigerRetourAudience(audienceId, payload)
      : this.api.retourAudience(audienceId, payload);
    appel.subscribe({
      next: () => { this.ligneRetour.set(null); this.charger(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Enregistrement du retour impossible.'),
    });
  }

  // 24/09/2026 — jump direct vers une semaine donnée : réutilisée par le
  // sélecteur de date de l'en-tête, par le lien "Aller à cette semaine" de
  // l'aperçu "Suite programmée", et par le "onChange" du champ date lui-même
  // — un seul point d'entrée, plutôt que de naviguer semaine par semaine
  // avec "Semaine suivante →" (toujours disponible en complément, jamais
  // retirée).
  allerASemaine(date: string): void {
    this.semaine = new Date(date).toISOString().slice(0, 10);
    this.charger();
  }

  // 24/09/2026 — déplie/replie l'aperçu inline de la "Suite programmée"
  // (colonne dédiée) sous la ligne d'origine, sans changer de semaine.
  toggleApercuSuite(l: any): void {
    this.apercuSuiteId.set(this.apercuSuiteId() === l.audience_id ? null : l.audience_id);
  }

  // Menu "⋮" (19/09/2026) — Modifier toujours proposée (avec la permission),
  // Saisir le retour tant qu'aucun résultat n'est encore enregistré, sinon
  // Modifier le retour (24/09/2026, gap comblé : aucun moyen de corriger un
  // retour déjà saisi sans risquer de dupliquer l'audience suivante — voir
  // PUT /audiences/:id/retour côté serveur).
  actionsPourLigne(l: any): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];
    if (this.auth.peut('audiences.ligne.creer')) items.push({ label: 'Modifier', action: () => this.commencerEditionAudience(l) });
    if (this.auth.peut('audiences.retour.saisir')) {
      items.push(l.resultat
        ? { label: 'Modifier le retour', action: () => this.ouvrirCorrectionRetour(l) }
        : { label: 'Saisir le retour', action: () => this.ouvrirRetour(l) });
    }
    return items;
  }

  commencerEditionAudience(l: any): void {
    this.erreurEditionAudience.set('');
    this.editAudience = {
      date_audience: l.date_prevue ? new Date(l.date_prevue).toISOString().slice(0, 10) : '',
      heure: this.formaterHeure(l.heure) === '—' ? '' : this.formaterHeure(l.heure),
      juridiction: l.juridiction || '',
      type: l.type || 'mise_en_etat',
      avocat_id: l.avocat_id || '',
      instructions: l.instructions || '',
      nature_procedure: l.nature_procedure || '',
      nature_precision: l.nature_precision || '',
      dernier_motif_id: l.dernier_motif_id || '',
      dernier_motif_precision: l.dernier_motif_precision || '',
    };
    this.editionAudienceId.set(l.audience_id);
    // 23/09/2026 — constaté par l'utilisateur (reproduit en défilant comme
    // un vrai utilisateur doit le faire pour atteindre le bouton "⋮",
    // toujours hors champ au chargement) : la ligne d'édition n'est pas
    // figée comme Date/Heure/Référence/Parties, elle démarre toujours à
    // gauche du tableau (x=0) — sans ce recentrage, elle s'ouvrait
    // tronquée (champ Date coupé, Juridiction affichant "ommune IV" au
    // lieu de "Commune IV") pendant qu'on restait défilé à droite.
    setTimeout(() => this.tableRoleEl?.nativeElement.closest('.table-scroll')
      ?.scrollTo({ left: 0, behavior: 'smooth' }));
  }

  annulerEditionAudience(): void {
    this.editionAudienceId.set(null);
  }

  enregistrerEditionAudience(l: any): void {
    this.erreurEditionAudience.set('');
    const payload = {
      ...this.editAudience,
      avocat_id: this.editAudience.avocat_id || null,
      // 23/09/2026 — toujours envoyé (même vide -> null), contrairement
      // aux autres champs qui utilisent COALESCE côté serveur (absence =
      // ne pas toucher) : "Motif dernier renvoi" doit pouvoir être
      // explicitement vidé si le motif recopié automatiquement après un
      // renvoi s'avère faux — voir le commentaire détaillé sur la route
      // PUT côté backend (audiences.js). "dernier_motif_precision" n'est
      // envoyée que si le motif sélectionné est "Autre (préciser)" — même
      // garde que côté "Saisir le retour" (voir enregistrerRetour()).
      dernier_motif_id: this.editAudience.dernier_motif_id || null,
      dernier_motif_precision: this.motifEstAutre(this.editAudience.dernier_motif_id)
        ? (this.editAudience.dernier_motif_precision || null) : null,
    };
    this.api.majAudience(l.audience_id, payload).subscribe({
      next: () => { this.editionAudienceId.set(null); this.charger(); },
      error: (e) => this.erreurEditionAudience.set(e?.error?.error ?? 'Modification impossible.'),
    });
  }

  // 21/09/2026 — gap comblé (constat de l'utilisateur : « le rôle n'est
  // pas imprimable en autonomie, avec les instructions et sans la saisie
  // du retour »). Le bouton générique « Imprimer / PDF » (28/08/2026)
  // clone tel quel ce qui est affiché à l'écran — il aurait donc inclus
  // Résultat (non souhaité, l'audience n'a pas encore eu lieu) et jamais
  // Instructions (pas une colonne visible, seulement dans les formulaires
  // d'ajout/édition). Impossible de satisfaire les deux avec le même
  // mécanisme (garder Résultat à l'écran, l'exclure à l'impression) — vue
  // dédiée construite ici, propres colonnes, reprend le même patron de
  // fenêtre d'impression que ExportPrintComponent pour la cohérence
  // visuelle (en-tête cabinet, styles), sans dépendre du DOM affiché.
  // 21/09/2026 (3e passe) : 3 observations de l'utilisateur, toutes
  // scopées explicitement à l'impression (« pas forcément dans
  // l'interface Rôle d'audience ») — l'écran garde ses noms complets et
  // son intitulé « Avocat » inchangés, seule cette vue imprimée change :
  // (i) parties en gras (info prioritaire à la lecture), référence en
  // dessous en italique/petit (secondaire, juste un repère de recherche) ;
  // (ii)/(iii) codes courts (MDJ/MDA…) plutôt que noms complets pour
  // Responsable dossier et « Audiencier » (renommé depuis « Avocat » —
  // celui qui se rend effectivement à l'audience, potentiellement
  // différent du responsable permanent du dossier). Nécessite
  // avocat_code/responsable_dossier_code, ajoutés au SELECT de
  // GET /api/roles-audience (audiences.js) pour cette seule raison.
  // 23/09/2026 — remplace l'impression HTML/navigateur (window.open +
  // document.write + w.print(), @page landscape jamais fiable sur
  // Safari) par un vrai PDF généré côté serveur (backend/src/rolePdf.js,
  // pdfkit, orientation paysage imposée dans le fichier) — même patron
  // que Facturation (25/08/2026) : "Aperçu" réutilise le composant de
  // prévisualisation déjà partagé dans toute l'appli (DocumentPreviewService),
  // "Télécharger" déclenche l'enregistrement direct du fichier. Un bouton
  // "Imprimer" séparé devient inutile : le lecteur PDF du navigateur a
  // déjà le sien, orientation déjà correcte car imposée dans le fichier.
  // "semaine_debut" revient de l'API en ISO complet ("2026-09-21T00:00:00.000Z")
  // — ne garder que la date pour un nom de fichier lisible.
  private nomFichierPdf(r: any): string {
    return `Role-audience-${String(r.semaine_debut).slice(0, 10)}.pdf`;
  }

  apercuRolePdf(): void {
    const r = this.role();
    if (!r?.id) return;
    this.preview.ouvrir(this.nomFichierPdf(r), this.api.telechargerRolePdf(r.id));
  }

  telechargerRolePdf(): void {
    const r = this.role();
    if (!r?.id) return;
    this.api.telechargerRolePdf(r.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.nomFichierPdf(r);
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Téléchargement impossible.'),
    });
  }
}
