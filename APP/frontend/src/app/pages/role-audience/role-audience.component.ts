import { Component, inject, signal, OnInit, ViewChild, ElementRef } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, Dossier } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MenuActionsComponent, ActionMenuItem } from '../../core/menu-actions.component';

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
          @if (r.lignes?.length) { <button class="btn sm ghost" (click)="imprimerRole()">🖶 Imprimer le rôle</button> }
        </div>

        @if (r.lignes?.length) {
          <div class="table-scroll">
          <table class="table-role" #tableRole>
            <!-- 23/09/2026 — 3e passe : Heure recollée à Date (retour sur la
                 2e passe, qui la collait à Juridiction — nouvelle demande
                 explicite de l'utilisateur). 4 colonnes figées désormais
                 (Date/Heure/Référence/Parties, voir "styles" plus bas). -->
            <tr><th class="col-date">Date</th><th class="col-heure">Heure</th><th class="col-ref">Référence</th><th class="col-parties">Parties</th><th>Juridiction</th><th>Procédure</th><th>Type audience</th><th>Motif dernier renvoi</th><th>Instructions</th><th>Resp dossier</th><th>Audiencier</th><th>Résultat</th><th></th></tr>
            @for (l of r.lignes; track l.id) {
              <tr [class.urgent]="l.urgente" [class.facturation-alerte]="!!l.statut_facturation">
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
                <td>{{ l.motif_dernier_renvoi || '—' }}</td>
                <td>{{ l.instructions || '—' }}</td>
                <td>{{ l.responsable_dossier_code || '—' }}</td>
                <td>{{ l.avocat_code || '—' }}</td>
                <td>
                  @if (l.resultat) {
                    <span class="tag">{{ l.resultat }}</span>
                    @if (l.motif_renvoi) { <span class="muted"> · {{ l.motif_renvoi }}</span> }
                  } @else { <span class="muted">à saisir</span> }
                </td>
                <td><app-menu-actions [actions]="actionsPourLigne(l)" /></td>
              </tr>
              @if (editionAudienceId() === l.audience_id) {
                <tr class="edition">
                  <td colspan="13">
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
          <h3>Retour d'audience — {{ l.dossier_numero }} — {{ l.dossier_intitule }} ({{ l.date_prevue | date:'dd/MM/yyyy' }})</h3>
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
              <div>
                <label>Prochaine date</label>
                <input class="in" type="date" [(ngModel)]="retourForm.prochaine_date" name="prochaine" />
              </div>
            }
            <div class="col2">
              <label>Observations</label>
              <input class="in" [(ngModel)]="retourForm.observations" name="obs" />
            </div>
          </div>
          <div class="actions">
            <button class="btn" (click)="enregistrerRetour(l.audience_id)">Enregistrer le retour</button>
            <button class="btn ghost" (click)="ligneRetour.set(null)">Annuler</button>
          </div>
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
            <tr>
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
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer}
    .btn.ghost{background:#fff;border:1px solid var(--line);color:var(--slate)}
    .btn.sm{padding:6px 11px;font-size:var(--fs-sm)}
    .btn:disabled{opacity:.6}
    .statut-bar{display:flex;align-items:center;gap:12px;margin-bottom:14px}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    tr.urgent td{background:#fff5f4}
    tr.facturation-alerte td{background:#fdf6e8}
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
  readonly role = signal<any | null>(null);
  readonly motifs = signal<{ id: string; libelle: string }[]>([]);
  readonly dossierResultats = signal<Dossier[]>([]);
  readonly ligneRetour = signal<any | null>(null);
  readonly erreur = signal('');
  @ViewChild('panneauRetour') panneauRetour?: ElementRef<HTMLElement>;
  @ViewChild('tableRole') tableRoleEl?: ElementRef<HTMLTableElement>;

  // 21/09/2026 — gap comblé : édition d'une audience déjà inscrite au rôle
  // (date/heure/juridiction/type/avocat), jamais le résultat (voir
  // ligneRetour/retourForm ci-dessus, qui reste le seul canal pour ça).
  readonly editionAudienceId = signal<string | null>(null);
  readonly erreurEditionAudience = signal('');
  editAudience: any = {};
  private raisonSociale = 'JFC AVOCATS MALI';

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
  retourForm: any = { resultat: 'renvoi', motif_renvoi_id: '', prochaine_date: '', observations: '' };

  libelleStatut(s: string): string {
    return ({ brouillon: 'Brouillon', valide: 'Validé', diffuse: 'Diffusé' } as Record<string, string>)[s] ?? s;
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
    // Lecture ouverte (voir parametres.js) — pas besoin de permission dédiée
    // pour un en-tête d'impression, même patron que ExportPrintComponent.
    this.api.parametresCabinet().subscribe({
      next: (c) => { if (c?.raison_sociale) this.raisonSociale = c.raison_sociale; },
      error: () => {},
    });
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
    this.retourForm = { resultat: 'renvoi', motif_renvoi_id: '', prochaine_date: '', observations: '' };
    this.ligneRetour.set(l);
    // 21/09/2026 — la tuile s'insère juste après le tableau du rôle, potentiellement
    // hors écran si la ligne cliquée est loin dans le tableau : défilement auto.
    setTimeout(() => this.panneauRetour?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  enregistrerRetour(audienceId: string): void {
    const payload = { ...this.retourForm, prochaine_date: this.retourForm.prochaine_date || null, motif_renvoi_id: this.retourForm.motif_renvoi_id || null };
    this.api.retourAudience(audienceId, payload).subscribe({
      next: () => { this.ligneRetour.set(null); this.charger(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Enregistrement du retour impossible.'),
    });
  }

  // Menu "⋮" (19/09/2026) — Modifier toujours proposée (avec la permission),
  // Saisir le retour seulement tant qu'aucun résultat n'est encore enregistré.
  actionsPourLigne(l: any): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];
    if (this.auth.peut('audiences.ligne.creer')) items.push({ label: 'Modifier', action: () => this.commencerEditionAudience(l) });
    if (!l.resultat && this.auth.peut('audiences.retour.saisir')) items.push({ label: 'Saisir le retour', action: () => this.ouvrirRetour(l) });
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
      // PUT côté backend (audiences.js).
      dernier_motif_id: this.editAudience.dernier_motif_id || null,
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
  private echapper(v: any): string {
    return String(v ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 23/09/2026 — fusion demandée par l'utilisateur pour que l'impression
  // tienne sur une seule ligne par audience : Motif dernier renvoi +
  // Instructions (texte libre tous les deux, même nature — « notes sur
  // cette audience ») regroupés sous un même intitulé « Notes (audience
  // du jour) ». Type audience reste volontairement sa PROPRE colonne
  // (court, catégoriel, utile à balayer d'un coup d'œil) — pas fusionné,
  // contrairement à la proposition initiale de l'utilisateur, sur mon
  // conseil qu'il a retenu. Chaque ligne n'apparaît que si renseignée
  // (pas de "—" répété deux fois quand les deux champs sont vides).
  private notesAudienceHtml(l: any): string {
    const lignes: string[] = [];
    if (l.motif_dernier_renvoi) lignes.push(`<div><b>Motif dernier renvoi :</b> ${this.echapper(l.motif_dernier_renvoi)}</div>`);
    if (l.instructions) lignes.push(`<div><b>Instructions :</b> ${this.echapper(l.instructions)}</div>`);
    return lignes.length ? lignes.join('') : '—';
  }

  // 23/09/2026 (4e passe) — sur retour explicite de l'utilisateur, la
  // Référence rejoint de nouveau la cellule Parties à l'impression
  // uniquement (l'écran, lui, garde 2 colonnes séparées — inchangé) :
  // parties en gras (+ "c/" centré s'il y en a 2), référence en petit
  // italique en dessous — repli sur le traitement du 21/09/2026, avant la
  // scission en 2 colonnes de la passe précédente.
  // 5e passe (23/09/2026) — colonne centrée dans son ensemble (voir la
  // classe "parties-impr" posée sur la <td> plus bas) + interlignage
  // resserré entre les 2 parties et le "c/" (voir "styles", ".partie-l"/
  // ".c-barre") ; mention "(client)" en italique/petit à la suite du nom
  // de notre client (toujours le "gauche" — convention du cabinet, client
  // cité en premier, établie le 31/08/2026) pour lever l'ambiguïté sans
  // supposer que le lecteur connaît cette convention.
  // 6e passe (23/09/2026) — "(client)" déplacé en suffixe entre
  // parenthèses (au lieu d'une étiquette en préfixe) ; la référence
  // (".reference") reçoit plus d'espace au-dessus pour se détacher
  // visuellement du bloc parties+"c/", qui lui reste resserré.
  // 9e passe (23/09/2026) — le découpage forcé en 3 lignes (nom client /
  // "c/" seul / nom adverse) est abandonné au profit d'un texte qui suit
  // naturellement, comme sur l'écran (7e passe côté écran, même
  // raisonnement) : même un nom court occupait 3 lignes fixes avec
  // l'ancien découpage, alors qu'en texte fluide 1-2 lignes suffisent
  // souvent — l'objectif de tout ce chantier était justement de gagner de
  // la place. C'est aussi le traitement qu'avait la colonne "Dossier"
  // combinée avant toute cette refonte (des mois sans qu'il ait posé
  // problème). Seul compromis : "c/" n'est plus isolé sur sa propre
  // ligne, redevient un mot dans le texte, là où il tombe au retour à la
  // ligne — jugé acceptable (reste lisible : "Société X c/ Coopérative
  // Y"), sur avis explicite de l'utilisateur.
  private partiesHtmlImpression(l: any): string {
    const gauche = this.echapper(this.partiesGauche(l.dossier_intitule));
    const droite = this.partiesDroite(l.dossier_intitule);
    const parties = droite
      ? `<b>${gauche} <span class="etq-client">(client)</span> c/ ${this.echapper(droite)}</b>`
      : `<b>${gauche} <span class="etq-client">(client)</span></b>`;
    return `${parties}<div class="reference">${this.echapper(l.dossier_numero)}</div>`;
  }

  imprimerRole(): void {
    const r = this.role();
    if (!r?.lignes?.length) return;
    // 23/09/2026 (4e passe) — retour sur la 3e passe (ligne diviseur pleine
    // largeur par jour) : l'utilisateur préfère finalement la colonne Date
    // "à l'ancienne" (en rowspan, une cellule par jour) — MAIS avec Heure
    // comme colonne autonome collée à Date (une valeur par ligne, jamais
    // rowspannée : c'est justement ce qui varie d'une audience à l'autre
    // au sein d'un même jour). 9 colonnes : Date, Heure, Parties (+
    // référence en italique dessous), Juridiction, Procédure, Type
    // audience, Notes, Resp dossier, Audiencier.
    // r.lignes est déjà trié par date_prevue côté serveur (ORDER BY dans
    // GET /api/roles-audience), donc les lignes d'un même jour sont déjà
    // consécutives — un simple compteur de span suffit, pas de tri à refaire.
    const lignesHtml: string[] = [];
    for (let i = 0; i < r.lignes.length; i++) {
      const l = r.lignes[i];
      const cleJour = (l.date_prevue || '').slice(0, 10);
      const premiereDuJour = i === 0 || (r.lignes[i - 1].date_prevue || '').slice(0, 10) !== cleJour;
      let span = 1;
      if (premiereDuJour) {
        for (let j = i + 1; j < r.lignes.length && (r.lignes[j].date_prevue || '').slice(0, 10) === cleJour; j++) span++;
      }
      lignesHtml.push(`<tr>
        ${premiereDuJour ? `<td rowspan="${span}">${this.echapper(this.formaterJour(l.date_prevue))}</td>` : ''}
        <td>${this.echapper(this.formaterHeure(l.heure))}</td>
        <td>${this.partiesHtmlImpression(l)}</td>
        <td>${this.echapper(this.abregeJuridiction(l.juridiction))}</td>
        <td>${this.echapper(this.libelleNatureProcedure(l.nature_procedure, l.nature_precision))}</td>
        <td>${this.echapper(this.libelleTypeAudience(l.type))}</td>
        <td>${this.notesAudienceHtml(l)}</td>
        <td>${this.echapper(l.responsable_dossier_code)}</td>
        <td>${this.echapper(l.avocat_code)}</td>
      </tr>`);
    }
    const lignes = lignesHtml.join('');
    const w = window.open('', '_print', 'width=1300,height=700');
    if (!w) { alert("Impression bloquée par le navigateur (pop-up) — autorisez les fenêtres pop-up pour JURIA."); return; }
    w.document.write(`<html><head><title>JURIA — Rôle d'audience</title><style>
      @page { size: landscape; margin: 14mm; }
      body{font-family:Arial,Helvetica,sans-serif;color:#1F2A44;padding:24px}
      h1{font-size:18px;color:#1F2A44;border-bottom:2px solid #B08D57;padding-bottom:6px}
      .sub{color:#6B7280;font-size:12px;margin:2px 0 16px}
      table{border-collapse:collapse;width:100%;margin:10px 0;font-size:12px;table-layout:fixed}
      /* 23/09/2026 — alignement uniformisé à gauche (constaté "désorganisé"
         avec le mélange centré/gauche du 21/09/2026), inchangé pour toutes
         les colonnes. 9e passe : Parties en texte fluide (voir
         partiesHtmlImpression()) — plus de lignes forcées ".partie-l"/
         ".c-barre" (retirées), le texte s'enroule naturellement comme
         n'importe quel paragraphe. La référence (".reference") continue
         de s'en détacher par un espacement plus généreux au-dessus.
         "(client)" en italique/petit à la suite du nom (".etq-client"). */
      th,td{border:1px solid #C7CDD6;padding:5px 8px;text-align:left;vertical-align:top;overflow-wrap:break-word}
      th{background:#1F2A44;color:#fff}
      .etq-client{font-size:9px;font-style:italic;color:#6B7280}
      .reference{display:block;color:#6B7280;font-size:11px;font-style:italic;margin-top:8px}
    </style></head><body>
    <h1>${this.echapper(this.raisonSociale)} — Rôle d'audience</h1>
    <div class="sub">Semaine du ${this.formaterDate(r.semaine_debut)} au ${this.formaterDate(r.semaine_fin)} — édité le ${new Date().toLocaleString('fr-FR')}</div>
    <table>
      <colgroup>
        <col style="width:8%"><col style="width:6%"><col style="width:22%"><col style="width:10%">
        <col style="width:10%"><col style="width:8%"><col style="width:20%">
        <col style="width:8%"><col style="width:8%">
      </colgroup>
      <tr><th>Date</th><th>Heure</th><th>Parties</th><th>Juridiction</th><th>Procédure</th><th>Type audience</th><th>Notes (audience du jour)</th><th>Resp dossier</th><th>Audiencier</th></tr>
      ${lignes}
    </table>
    </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  private formaterDate(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('fr-FR');
  }

  // "Lundi 21/09/2026" — jour de la semaine (capitalisé) + date, pour la
  // cellule Date fusionnée de l'impression du rôle.
  private formaterJour(d: string | null | undefined): string {
    if (!d) return '—';
    const date = new Date(d);
    const jour = date.toLocaleDateString('fr-FR', { weekday: 'long' });
    return jour.charAt(0).toUpperCase() + jour.slice(1) + ' ' + date.toLocaleDateString('fr-FR');
  }
}
