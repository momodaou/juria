import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, ParametresHonoraires, ParametresCabinet } from '../../core/api.service';
import { ComptesCabinetComponent } from '../../core/comptes-cabinet.component';
import { AuthService } from '../../core/auth.service';
import { MenuActionsComponent, ActionMenuItem } from '../../core/menu-actions.component';
import { ROLES } from '../../core/roles';

@Component({
  selector: 'app-acces',
  standalone: true,
  imports: [DatePipe, FormsModule, MenuActionsComponent, ComptesCabinetComponent],
  template: `
    <header class="page-head">
      <div>
        <h1>Accès &amp; permissions</h1>
        <p>Création de compte, validation à l'entrée, évolution des rôles, délégations d'accès, journal d'audit. Réservé associé/admin.</p>
      </div>
      <button class="btn" (click)="afficherFormCompte.set(!afficherFormCompte())">
        {{ afficherFormCompte() ? 'Annuler' : '+ Nouveau compte' }}
      </button>
    </header>

    @if (erreurGlobale()) {
      <section class="panel"><p class="err">{{ erreurGlobale() }}</p></section>
    } @else {
      @if (afficherFormCompte()) {
        <section class="panel">
          <h3>Nouveau compte</h3>
          <div class="grid2">
            <div><label>Code</label><input class="in" [(ngModel)]="nouveauCompte.code" name="code" placeholder="Ex. HNA" /></div>
            <div>
              <label>Rôle initial</label>
              <select class="in" [(ngModel)]="nouveauCompte.role" name="roleInit">
                @for (r of roles; track r.code) { <option [value]="r.code">{{ r.libelle }}</option> }
              </select>
            </div>
            <div><label>Prénom</label><input class="in" [(ngModel)]="nouveauCompte.prenom" name="prenom" /></div>
            <div><label>Nom</label><input class="in" [(ngModel)]="nouveauCompte.nom" name="nom" /></div>
            <div class="col2"><label>Email</label><input class="in" type="email" [(ngModel)]="nouveauCompte.email" name="email" /></div>
          </div>
          <button class="btn" (click)="creerCompte()" [disabled]="!nouveauCompte.code || !nouveauCompte.prenom || !nouveauCompte.nom || !nouveauCompte.email">
            Créer (compte inactif, à valider ensuite)
          </button>
          @if (erreurCompte()) { <p class="err">{{ erreurCompte() }}</p> }
        </section>
      }

      @if (dernierMotDePasse()) {
        <section class="panel alerte">
          <h3>Mot de passe temporaire (affiché une seule fois)</h3>
          <p><b>{{ dernierMotDePasse()!.nom }}</b> — <code class="mdp">{{ dernierMotDePasse()!.mdp }}</code></p>
          <p class="muted">
            @if (dernierMotDePasse()!.creation) {
              Communiquez-le en toute sécurité à la personne concernée. Le compte reste inactif tant qu'il n'est pas validé ci-dessous.
            } @else {
              Communiquez-le en toute sécurité à la personne concernée. L'ancien mot de passe ne fonctionne plus, le statut du compte n'a pas changé.
            }
          </p>
          <button class="lien" (click)="dernierMotDePasse.set(null)">Fermer</button>
        </section>
      }

      <section class="panel">
        <h3>Membres du cabinet</h3>
        <table>
          <tr><th>Nom</th><th>Rôle</th><th>Statut</th><th></th></tr>
          @for (u of utilisateurs(); track u.id) {
            <tr>
              <td>{{ u.prenom }} {{ u.nom }} <span class="muted">({{ u.code }})</span></td>
              <td>
                <select class="sel" [ngModel]="u.role" (ngModelChange)="changerRole(u, $event)">
                  @for (r of roles; track r.code) { <option [value]="r.code">{{ r.libelle }}</option> }
                </select>
              </td>
              <td>
                <span class="tag" [class.ok]="u.actif" [class.attente]="statut(u) === 'attente'" [class.haute]="statut(u) === 'suspendu'">
                  {{ libelleStatut(u) }}
                </span>
              </td>
              <td><app-menu-actions [actions]="actionsPourUtilisateur(u)" /></td>
            </tr>
            @if (editionUtilisateurId() === u.id) {
              <tr class="edition">
                <td colspan="4">
                  <div class="grid2">
                    <div><label>Prénom</label><input class="in" [(ngModel)]="editUtilisateur.prenom" name="euPrenom" /></div>
                    <div><label>Nom</label><input class="in" [(ngModel)]="editUtilisateur.nom" name="euNom" /></div>
                    <div><label>Code</label><input class="in" [(ngModel)]="editUtilisateur.code" name="euCode" /></div>
                    <div><label>E-mail</label><input class="in" type="email" [(ngModel)]="editUtilisateur.email" name="euEmail" /></div>
                    <div><label>Taux horaire (FCFA/h)</label><input class="in" type="number" [(ngModel)]="editUtilisateur.taux_horaire" name="euTaux" /></div>
                  </div>
                  <button class="lien" (click)="enregistrerEditionUtilisateur()">Enregistrer</button>
                  <button class="lien" (click)="annulerEditionUtilisateur()">Annuler</button>
                  @if (erreurGlobale()) { <p class="err">{{ erreurGlobale() }}</p> }
                </td>
              </tr>
            }
          }
        </table>
      </section>

      <section class="panel">
        <h3>Délégations d'accès</h3>
        <p class="muted" style="margin-top:-6px">
          « Autre (note seule) » n'accorde aucun droit — purement déclaratif. Choisir une action précise du catalogue l'accorde réellement à la personne pendant la période de la délégation, sans avoir à aussi cocher la case dans la Matrice.
        </p>
        <div class="upload">
          <select class="sel" [(ngModel)]="nouvelleDeleg.utilisateur_id" name="deleUser">
            <option value="">Bénéficiaire…</option>
            @for (u of utilisateurs(); track u.id) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
          </select>
          <select class="sel" [(ngModel)]="nouvelleDeleg.action_code" name="deleAction" style="min-width:220px">
            <option value="">Autre (note seule, sans effet)</option>
            @for (grp of modulesActions(); track grp.module) {
              <optgroup [label]="grp.module">
                @for (a of grp.items; track a.code) { <option [value]="a.code">{{ a.label }}</option> }
              </optgroup>
            }
          </select>
          <select class="sel" [(ngModel)]="nouvelleDeleg.portee" name="delePortee">
            <option value="temporaire">Temporaire</option>
            <option value="permanent">Permanent</option>
          </select>
          <input class="sel" [(ngModel)]="nouvelleDeleg.description" name="deleDesc" placeholder="Ex. Accès facturation" style="flex:1;min-width:180px" />
          @if (nouvelleDeleg.portee === 'temporaire') {
            <input class="sel" type="date" [(ngModel)]="nouvelleDeleg.date_fin" name="deleFin" />
          }
          <button class="btn sm" (click)="accorderDelegation()" [disabled]="!nouvelleDeleg.utilisateur_id || !nouvelleDeleg.description">Accorder</button>
        </div>

        @if (delegations().length) {
          <table>
            <tr><th>Bénéficiaire</th><th>Action déléguée</th><th>Portée</th><th>Description</th><th>Du</th><th>Au</th><th>Statut</th><th></th></tr>
            @for (d of delegations(); track d.id) {
              <tr>
                <td>{{ d.utilisateur }}</td>
                <td>{{ d.action_code ? libelleAction(d.action_code) : '—' }}</td>
                <td>{{ d.portee }}</td>
                <td>{{ d.description }}</td>
                <td>{{ d.date_debut | date:'dd/MM/yyyy' }}</td>
                <td>{{ d.date_fin ? (d.date_fin | date:'dd/MM/yyyy') : '—' }}</td>
                <td><span class="tag" [class.ok]="d.actif" [class.haute]="!d.actif">{{ d.actif ? 'Active' : 'Révoquée' }}</span></td>
                <td>@if (d.actif) { <button class="lien" (click)="revoquer(d)">Révoquer</button> }</td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucune délégation.</p> }
      </section>

      @if (auth.peut('parametres.honoraires.modifier') && parametres()) {
        <section class="panel">
          <h3>Seuils pro bono</h3>
          <p class="muted">Plancher minimum, pas un forfait imposé — un dossier pro bono peut toujours être facturé au-delà. Réservé aux avocats habilités (voir dossiers.pro_bono.declarer dans la matrice ci-dessous).</p>
          <div class="grid2">
            <div>
              <label>Frais de procédure minimum — dossier pro bono (FCFA)</label>
              <input class="in" type="number" [(ngModel)]="parametresEdit.frais_procedure_pro_bono_min_xof" name="seuilProBono" />
            </div>
            <div>
              <label>Quota pro bono (dossiers/mois/responsable)</label>
              <input class="in" type="number" [(ngModel)]="parametresEdit.quota_pro_bono_mensuel" name="quotaProBono" />
            </div>
            <div>
              <label>Seuil d'alerte — stock de vignettes de plaidoirie</label>
              <input class="in" type="number" [(ngModel)]="parametresEdit.seuil_alerte_vignettes" name="seuilVignettes" />
            </div>
            <div>
              <label>Plafond par dépense — petite caisse (FCFA)</label>
              <input class="in" type="number" [(ngModel)]="parametresEdit.petite_caisse_plafond_depense" name="plafondPetiteCaisse" placeholder="non défini : engagement impossible" />
            </div>
          </div>
          <button class="btn" (click)="enregistrerParametres()">Enregistrer</button>
          @if (parametresMessage()) { <p class="muted" style="margin-top:8px">{{ parametresMessage() }}</p> }
        </section>
      }

      @if (auth.peut('parametres.cabinet.modifier') && cabinet()) {
        <section class="panel">
          <h3>Identité du cabinet</h3>
          <p class="muted">Imprimée sur les factures, actes et notes d'honoraires (en-tête, bloc « informations de paiement »).</p>
          <div class="grid2">
            <div><label>Raison sociale</label><input class="in" [(ngModel)]="cabinetEdit.raison_sociale" name="cabRaison" /></div>
            <div><label>Forme</label><input class="in" [(ngModel)]="cabinetEdit.forme" name="cabForme" /></div>
            <div><label>Adresse</label><input class="in" [(ngModel)]="cabinetEdit.adresse" name="cabAdresse" /></div>
            <div><label>Téléphone</label><input class="in" [(ngModel)]="cabinetEdit.telephone" name="cabTel" /></div>
            <div><label>E-mail</label><input class="in" [(ngModel)]="cabinetEdit.email" name="cabEmail" /></div>
            <div><label>NIF</label><input class="in" [(ngModel)]="cabinetEdit.nif" name="cabNif" /></div>
            <div><label>RCCM</label><input class="in" [(ngModel)]="cabinetEdit.rccm" name="cabRccm" /></div>
            <div><label>Compte CARPA</label><input class="in" [(ngModel)]="cabinetEdit.compte_carpa" name="cabCarpa" /></div>
          </div>
          <label>Mentions légales (pied de page facture)</label>
          <textarea class="in" rows="2" [(ngModel)]="cabinetEdit.mentions_legales" name="cabMentions" style="width:100%"></textarea>
          <button class="btn" (click)="enregistrerCabinet()">Enregistrer</button>
          @if (cabinetMessage()) { <p class="muted" style="margin-top:8px">{{ cabinetMessage() }}</p> }
        </section>

        <app-comptes-cabinet />
      }

      @if (matrice()) {
        <section class="panel">
          <h3>Matrice des permissions</h3>
          <p class="muted">Réservé Associé + Administrateur IT. Chaque case autorise (ou non) le rôle en colonne à effectuer l'action en ligne. Les cases sans coche par défaut correspondent au comportement d'origine de l'application — à ajuster librement.</p>
          <div class="matrice-scroll">
            <table class="matrice">
              <thead>
                <tr>
                  <th class="col-action">Action</th>
                  @for (r of roles; track r.code) { <th class="col-role" [title]="r.libelle">{{ r.court }}</th> }
                </tr>
              </thead>
              <tbody>
                @for (m of modulesMatrice(); track m) {
                  <tr class="ligne-module">
                    <td class="col-action">{{ m }}</td>
                    <td [attr.colspan]="roles.length"></td>
                  </tr>
                  @for (a of actionsDuModule(m); track a.code) {
                    <tr>
                      <td class="col-action">{{ a.label }} @if (a.restreinte) { <span class="pastille" title="Réservée à la direction avant l'introduction de cette matrice">★</span> }</td>
                      @for (r of roles; track r.code) {
                        <td class="col-role">
                          <input type="checkbox" [checked]="valeurPermission(r.code, a.code)" (change)="basculerPermission(r.code, a.code, $event)" />
                        </td>
                      }
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      <section class="panel">
        <h3>Journal d'audit (100 dernières actions)</h3>
        <div class="audit-filtres">
          <select class="sel" [(ngModel)]="auditFiltre.utilisateur_id" (ngModelChange)="chargerAudit()">
            <option value="">Tous les utilisateurs</option>
            @for (u of utilisateurs(); track u.id) {
              <option [value]="u.id">{{ u.code }} — {{ u.prenom }} {{ u.nom }}</option>
            }
          </select>
          <select class="sel" [(ngModel)]="auditFiltre.entite" (ngModelChange)="chargerAudit()">
            <option value="">Toutes les entités</option>
            @for (e of ENTITES_AUDIT; track e.code) {
              <option [value]="e.code">{{ e.libelle }}</option>
            }
          </select>
          <input class="sel" type="date" [(ngModel)]="auditFiltre.depuis" (ngModelChange)="chargerAudit()" title="Depuis le">
          <input class="sel" type="date" [(ngModel)]="auditFiltre.jusqu_au" (ngModelChange)="chargerAudit()" title="Jusqu'au">
          <a class="lien" (click)="reinitialiserFiltreAudit()">Réinitialiser</a>
        </div>
        @if (audit().length) {
          <table>
            <tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Entité</th></tr>
            @for (a of audit(); track a.id) {
              <tr>
                <td>{{ a.horodatage | date:'dd/MM/yyyy HH:mm' }}</td>
                <td>{{ a.utilisateur_code ? (a.utilisateur_code + ' — ' + a.utilisateur) : (a.utilisateur || '—') }}</td>
                <td><span class="tag">{{ a.action }}</span></td>
                <td>{{ a.entite || '—' }}</td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucune entrée pour ce filtre.</p> }
      </section>
    }
  `,
  styles: [`
    /* 09/10/2026 — filtres du journal d'audit. */
    .audit-filtres{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
    /* 26/09/2026 — audit doublons, même style que clients.component.ts. */
    .doublon{background:#fffaf0;border:1px solid #f0dcae;border-radius:10px;padding:14px 16px;margin-top:10px}
    .doublon p{margin:4px 0;font-size:var(--fs-base)}
    .doublon .btns{display:flex;gap:8px;margin-top:10px}
    .edition td{background:var(--light);padding:12px 14px}
    .sel{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:var(--fs-base)}
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md)}
    label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:600px}
    .col2{grid-column:1 / -1}
    .upload{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .btn.sm{padding:9px 14px;font-size:var(--fs-base)}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    .tag.haute{background:#fbe6e5;color:#b13a36}
    .tag.attente{background:#fbf1dc;color:#9a6c12}
    .panel.alerte{border-left:4px solid var(--amber)}
    .mdp{background:#f7f9fc;border:1px solid var(--line);border-radius:6px;padding:3px 8px;font-size:var(--fs-md);font-weight:700;letter-spacing:.5px}
    /* Matrice des permissions (11/09/2026) — 13 colonnes de rôle ne
       tiennent pas sur un écran standard avec des intitulés sur une seule
       ligne (ex. « Assist. comptable ») : plutôt que de réduire encore la
       police (déjà au palier le plus petit de l'échelle, --fs-xs/--fs-sm),
       les colonnes de rôle sont maintenant à largeur fixe avec un intitulé
       sur 2 lignes, et la colonne Action reste visible (position sticky)
       pendant le défilement horizontal pour ne pas perdre le contexte de
       la ligne en cours en regardant les colonnes de droite (ex. Admin.
       IT, Archiviste). Le défilement reste nécessaire sur les petits
       écrans, mais tient désormais en un minimum de distance.
       ⚠️ position:sticky sur une cellule de table exige border-collapse
       (déjà en place) et un fond opaque explicite sur les cellules
       collantes, sinon le contenu défilant transparaît en dessous. */
    /* 08/10/2026 — la colonne Action était déjà figée horizontalement,
       mais l'en-tête des rôles (ligne du haut) ne l'était pas verticalement
       : en défilant vers le bas dans une matrice de ~60 lignes, on perdait
       la correspondance colonne↔rôle (constat direct de l'utilisateur).
       ⚠️ Simplement ajouter position:sticky;top:0 au thead n'aurait rien
       donné ici : .matrice-scroll n'avait qu'overflow-x:auto, qui fait
       calculer overflow-y à auto également (règle CSS : si un axe est
       différent de visible, l'autre axe "visible" devient "auto") — un
       conteneur qui devient ainsi un conteneur de défilement sans jamais
       avoir de hauteur bornée ne "scrolle" jamais lui-même, donc sticky
       n'a aucun scrollport où s'accrocher pendant le défilement de la
       page. Corrigé en donnant au conteneur une vraie hauteur bornée
       (max-height + overflow:auto explicite sur les 2 axes) : la matrice
       devient son propre cadre de défilement interne, ligne d'en-tête ET
       colonne Action figées en même temps (patron tableur classique). */
    .matrice-scroll{overflow:auto;max-height:65vh;border:1px solid var(--line);border-radius:8px}
    /* border-collapse:separate (pas collapse) — avec collapse, la colonne
       sticky laissait passer une fine tranche de la colonne suivante en
       défilement (artefact connu de position:sticky combiné à
       border-collapse:collapse sur une table). border-spacing:0 conserve
       un rendu visuellement identique à collapse en dehors de ce cas. */
    table.matrice{border-collapse:separate;border-spacing:0;font-size:var(--fs-sm)}
    table.matrice th, table.matrice td{border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:6px 8px;text-align:center;white-space:nowrap}
    table.matrice .col-action{text-align:left;width:220px;white-space:normal;
      position:sticky;left:0;background:#fff;box-shadow:2px 0 4px -2px rgba(0,0,0,.15);}
    /* 82px : assez pour qu'un intitulé d'un seul mot (Assistante,
       Comptable, Archiviste, Stagiaire) tienne sur une ligne sans coupure
       au milieu d'un mot ; les intitulés à 2 mots (Assoc. fondateur, Of
       Counsel…) se répartissent naturellement sur 2 lignes à l'espace. */
    table.matrice .col-role{width:82px;white-space:normal}
    /* z-index croissant du bas vers le haut à chaque intersection de 2
       éléments figés : corps (auto, 0 implicite) < ligne d'en-tête figée
       (1, pour passer devant le corps qui défile dessous) < coin Action
       de l'en-tête (2, figé à la fois en haut ET à gauche — doit passer
       devant l'en-tête des rôles ET la colonne Action du corps). */
    table.matrice thead th{background:var(--light);font-weight:700;font-size:var(--fs-xs);
      position:sticky;top:0;z-index:1}
    table.matrice thead .col-action{z-index:2}
    /* Le libellé de section (ex. « ATELIER D'ACTES ») est sa propre
       cellule .col-action (1 seule colonne, pas de colspan) pour hériter
       du même comportement sticky que les libellés d'action ci-dessous —
       découvert en testant : position:sticky ne s'applique pas de façon
       fiable à une cellule avec colspan sur plusieurs colonnes (le texte
       défilait hors champ alors que le fond navy, lui, restait visible
       puisqu'il couvre toute la largeur de la ligne). La 2de cellule
       (colspan sur les rôles restants) complète juste le bandeau visuel. */
    tr.ligne-module td{background:var(--navy);color:#fff;font-weight:700;text-align:left;font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.04em;border-color:var(--navy)}
    tr.ligne-module td.col-action{background:var(--navy);z-index:1}
    .pastille{color:var(--gold);margin-left:3px}
  `],
})
export class AccesComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly utilisateurs = signal<any[]>([]);
  readonly parametres = signal<ParametresHonoraires | null>(null);
  readonly parametresMessage = signal('');
  parametresEdit: Partial<ParametresHonoraires> = {};
  readonly delegations = signal<any[]>([]);
  // 09/10/2026 — catalogue des 80 actions pour le sélecteur "Action
  // déléguée" (route dédiée, accessible même à admin_general qui n'a pas
  // accès à GET /api/acces/permissions, réservée associe+admin_it).
  readonly catalogueActions = signal<{ code: string; module: string; label: string }[]>([]);
  readonly modulesActions = computed(() => {
    const parModule = new Map<string, { code: string; module: string; label: string }[]>();
    for (const a of this.catalogueActions()) {
      if (!parModule.has(a.module)) parModule.set(a.module, []);
      parModule.get(a.module)!.push(a);
    }
    return Array.from(parModule.entries()).map(([module, items]) => ({ module, items }));
  });
  libelleAction(code: string): string {
    return this.catalogueActions().find((a) => a.code === code)?.label ?? code;
  }
  readonly audit = signal<any[]>([]);
  readonly erreurGlobale = signal('');
  readonly afficherFormCompte = signal(false);
  readonly erreurCompte = signal('');
  readonly dernierMotDePasse = signal<{ nom: string; mdp: string; creation: boolean } | null>(null);

  // Identité du cabinet (28/08/2026, facture PDF enrichie) ; les comptes ont leur composant.
  readonly cabinet = signal<ParametresCabinet | null>(null);
  readonly cabinetMessage = signal('');
  cabinetEdit: Partial<ParametresCabinet> = {};

  nouvelleDeleg: any = { portee: 'temporaire' };
  nouveauCompte: any = { role: 'collaborateur' };

  // 13 statuts réels du cabinet (17/08/2026, complété après coup avec
  // associe_fondateur et la distinction avocat_stagiaire/stagiaire).
  // `court` = en-tête de colonne dans la matrice de permissions ; `libelle`
  // = intitulé complet ailleurs. L'associé-fondateur a les mêmes droits
  // qu'un associé classique partout SAUF la matrice de permissions
  // elle-même (réservée associé + admin IT, voir acces.js backend).
  // 20/09/2026 : extrait dans core/roles.ts (source unique) — cette copie
  // locale était jusqu'ici la seule source de libellés, jamais réutilisée
  // ailleurs dans l'appli (constat de l'utilisateur : rôle brut affiché
  // dans Cabinet, Mon compte, les sélecteurs de responsable/intervenant).
  readonly roles = ROLES;

  readonly matrice = signal<{ catalogue: any[]; roles: string[]; valeurs: Record<string, boolean> } | null>(null);

  // Filtres du journal d'audit (09/10/2026, demande explicite de
  // l'utilisateur : « identifier au besoin, par le code d'un profil —
  // mda/mdj/bco… — telle ou telle action effectuée »). `utilisateur_id`/
  // `entite` existaient déjà côté API, jamais câblés depuis l'écran.
  auditFiltre: { utilisateur_id: string; entite: string; depuis: string; jusqu_au: string } = {
    utilisateur_id: '', entite: '', depuis: '', jusqu_au: '',
  };
  readonly ENTITES_AUDIT = [
    { code: 'dossiers', libelle: 'Dossier' },
    { code: 'clients', libelle: 'Client' },
    { code: 'dossier_instances', libelle: 'Instance' },
    { code: 'dossier_parties', libelle: 'Partie au dossier' },
    { code: 'audiences', libelle: 'Audience' },
    { code: 'evenements', libelle: 'Échéance' },
    { code: 'utilisateurs', libelle: 'Compte utilisateur' },
    { code: 'delegations_acces', libelle: 'Délégation d’accès' },
    { code: 'permissions_role', libelle: 'Matrice de permissions' },
    { code: 'factures', libelle: 'Facture' },
    { code: 'conversations', libelle: 'Conversation (messagerie)' },
    { code: 'messages', libelle: 'Message' },
  ];

  statut(u: any): 'actif' | 'attente' | 'suspendu' {
    if (u.actif) return 'actif';
    return u.valide_le ? 'suspendu' : 'attente';
  }

  libelleStatut(u: any): string {
    const s = this.statut(u);
    return s === 'actif' ? 'Actif' : s === 'attente' ? 'En attente de validation' : 'Suspendu';
  }

  chargerAudit(): void {
    this.api.journalAudit(this.auditFiltre).subscribe({
      next: (a) => { this.audit.set(a); this.erreurGlobale.set(''); },
      error: (e) => this.erreurGlobale.set(e?.error?.error ?? 'Accès réservé aux associés/admin.'),
    });
  }

  reinitialiserFiltreAudit(): void {
    this.auditFiltre = { utilisateur_id: '', entite: '', depuis: '', jusqu_au: '' };
    this.chargerAudit();
  }

  ngOnInit(): void {
    this.api.utilisateurs(null).subscribe({ next: (u) => this.utilisateurs.set(u) });
    this.api.catalogueActionsDelegation().subscribe({ next: (c) => this.catalogueActions.set(c) });
    this.chargerDelegations();
    this.chargerAudit();
    // 403 attendu pour un Administrateur général (matrice réservée
    // Associé + Administrateur IT) : on masque simplement la section,
    // sans faire remonter d'erreur.
    this.api.permissionsMatrice().subscribe({
      next: (m) => this.matrice.set(m),
      error: () => this.matrice.set(null),
    });
    // 403 attendu pour tout rôle hors Associé/Administrateur IT — la
    // section est simplement masquée (auth.peut()), pas traité en erreur.
    if (this.auth.peut('parametres.honoraires.modifier')) {
      this.api.parametresHonoraires().subscribe({
        next: (p) => { this.parametres.set(p); this.parametresEdit = { ...p }; },
        error: () => {},
      });
    }
    // 403 attendu hors direction/comptabilité — section simplement masquée.
    if (this.auth.peut('parametres.cabinet.modifier')) {
      this.api.parametresCabinet().subscribe({
        next: (c) => { this.cabinet.set(c); this.cabinetEdit = { ...c }; },
        error: () => {},
      });
    }
  }

  enregistrerParametres(): void {
    this.parametresMessage.set('');
    this.api.majParametresHonoraires(this.parametresEdit).subscribe({
      next: (p) => { this.parametres.set(p); this.parametresEdit = { ...p }; this.parametresMessage.set('Enregistré.'); },
      error: (e) => this.parametresMessage.set(e?.error?.error ?? 'Enregistrement impossible.'),
    });
  }

  enregistrerCabinet(): void {
    this.cabinetMessage.set('');
    this.api.majParametresCabinet(this.cabinetEdit).subscribe({
      next: (c) => { this.cabinet.set(c); this.cabinetEdit = { ...c }; this.cabinetMessage.set('Enregistré.'); },
      error: (e) => this.cabinetMessage.set(e?.error?.error ?? 'Enregistrement impossible.'),
    });
  }

  modulesMatrice(): string[] {
    const m = this.matrice();
    if (!m) return [];
    return [...new Set(m.catalogue.map((a: any) => a.module))];
  }

  actionsDuModule(module: string): any[] {
    return (this.matrice()?.catalogue ?? []).filter((a: any) => a.module === module);
  }

  valeurPermission(role: string, actionCode: string): boolean {
    return !!this.matrice()?.valeurs[`${role}::${actionCode}`];
  }

  basculerPermission(role: string, actionCode: string, ev: Event): void {
    const autorise = (ev.target as HTMLInputElement).checked;
    this.api.majPermission(role, actionCode, autorise).subscribe({
      next: () => {
        const m = this.matrice();
        if (m) m.valeurs[`${role}::${actionCode}`] = autorise;
      },
      error: () => {
        (ev.target as HTMLInputElement).checked = !autorise; // revert visuel si l'appel échoue
      },
    });
  }

  chargerDelegations(): void {
    this.api.delegations().subscribe({ next: (d) => this.delegations.set(d) });
  }

  creerCompte(): void {
    this.erreurCompte.set('');
    this.api.creerCompte(this.nouveauCompte).subscribe({
      next: (r) => {
        this.dernierMotDePasse.set({ nom: `${r.prenom} ${r.nom}`, mdp: r.mot_de_passe_temporaire, creation: true });
        this.afficherFormCompte.set(false);
        this.nouveauCompte = { role: 'collaborateur' };
        this.api.utilisateurs(null).subscribe({ next: (u) => this.utilisateurs.set(u) });
      },
      error: (e) => this.erreurCompte.set(e?.error?.error ?? 'Création impossible.'),
    });
  }

  // Met à jour un membre dans le signal `utilisateurs` (jamais par mutation
  // directe d'un objet déjà rendu — voir explication ci-dessous).
  private majUtilisateurLocal(id: string, patch: Record<string, any>): void {
    this.utilisateurs.update((liste) => liste.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  valider(u: any): void {
    this.api.validerCompte(u.id).subscribe({
      next: () => this.majUtilisateurLocal(u.id, { actif: true, valide_le: new Date().toISOString() }),
      error: (e) => this.erreurGlobale.set(e?.error?.error ?? 'Validation impossible.'),
    });
  }

  reinitialiserMotDePasse(u: any): void {
    this.api.reinitialiserMotDePasse(u.id).subscribe({
      next: (r) => this.dernierMotDePasse.set({ nom: `${r.prenom} ${r.nom}`, mdp: r.mot_de_passe_temporaire, creation: false }),
      error: (e) => this.erreurGlobale.set(e?.error?.error ?? 'Réinitialisation impossible.'),
    });
  }

  changerRole(u: any, role: string): void {
    this.api.majRoleUtilisateur(u.id, role).subscribe({ next: () => this.majUtilisateurLocal(u.id, { role }) });
  }

  // Menu "⋮" (19/09/2026).
  actionsPourUtilisateur(u: any): ActionMenuItem[] {
    const items: ActionMenuItem[] = [{ label: 'Modifier', action: () => this.commencerEditionUtilisateur(u) }];
    if (this.statut(u) === 'attente') {
      items.push({ label: 'Valider', action: () => this.valider(u) });
    } else {
      items.push({ label: u.actif ? 'Désactiver' : 'Réactiver', action: () => this.basculerActif(u), danger: u.actif });
    }
    items.push({ label: 'Réinit. mot de passe', action: () => this.reinitialiserMotDePasse(u) });
    return items;
  }

  // Correction d'identité/taux horaire (19/09/2026, gap comblé — la route
  // existait depuis le 04/09/2026 mais n'avait jamais eu d'UI, voir
  // CLAUDE.md).
  readonly editionUtilisateurId = signal<string | null>(null);
  editUtilisateur: any = {};
  commencerEditionUtilisateur(u: any): void {
    this.erreurGlobale.set('');
    this.editUtilisateur = { code: u.code, prenom: u.prenom, nom: u.nom, email: u.email, taux_horaire: u.taux_horaire };
    this.editionUtilisateurId.set(u.id);
  }
  annulerEditionUtilisateur(): void {
    this.editionUtilisateurId.set(null);
    this.editUtilisateur = {};
  }
  enregistrerEditionUtilisateur(): void {
    const id = this.editionUtilisateurId();
    if (!id) return;
    this.erreurGlobale.set('');
    this.api.majIdentiteUtilisateur(id, this.editUtilisateur).subscribe({
      next: (u) => {
        this.majUtilisateurLocal(id, u);
        this.editionUtilisateurId.set(null);
        this.editUtilisateur = {};
      },
      error: (e) => this.erreurGlobale.set(e?.error?.error ?? 'Modification impossible.'),
    });
  }

  // 🐛 Bug trouvé le 04/09/2026 (« désactiver/réactiver a du mal à
  // fonctionner ») : `u.actif = !u.actif` mutait directement l'objet déjà
  // affiché, sans jamais réécrire le signal `utilisateurs` — l'appli
  // n'ayant pas zone.js (aucun polyfill, voir angular.json), rien ne
  // déclenche de nouveau rendu après la résolution asynchrone de l'appel
  // HTTP : le libellé du bouton restait figé sur l'ancien état tant qu'un
  // événement sans rapport (ou un rechargement complet) ne forçait pas un
  // nouveau passage de détection de changements. Corrigé en passant par
  // `majUtilisateurLocal()` (écrit réellement dans le signal via `.update()`).
  basculerActif(u: any): void {
    this.api.majActifUtilisateur(u.id, !u.actif).subscribe({ next: () => this.majUtilisateurLocal(u.id, { actif: !u.actif }) });
  }

  accorderDelegation(): void {
    this.api.creerDelegation(this.nouvelleDeleg).subscribe({
      next: () => { this.nouvelleDeleg = { portee: 'temporaire' }; this.chargerDelegations(); },
    });
  }

  revoquer(d: any): void {
    this.api.revoquerDelegation(d.id).subscribe({ next: () => this.chargerDelegations() });
  }
}
