import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DocumentPreviewService } from '../../core/document-preview.service';
import { MenuActionsComponent, ActionMenuItem } from '../../core/menu-actions.component';
import { LibellePipe } from '../../core/libelles';

@Component({
  selector: 'app-client-detail',
  standalone: true,
  imports: [LibellePipe, DatePipe, DecimalPipe, FormsModule, RouterLink, MenuActionsComponent],
  template: `
    <a routerLink="/clients" class="back">← Retour aux clients</a>

    @if (client(); as c) {
      <div class="dcard">
        <div class="dcard-top">
          <div>
            <h1>{{ c.denomination || (c.prenom + ' ' + c.nom) }}</h1>
            <div class="sub">
              {{ libelleTypeClient(c.type) }}
              @if (aIdentifiantFiscal(c.type)) { · {{ c.rccm || c.nif || 'Identifiant non renseigné' }} }
              · {{ c.pays }}
            </div>
            @if (nbDossiers() !== null) {
              <a class="lien" [routerLink]="['/dossiers']" [queryParams]="{ client: clientId, clientLabel: c.denomination || (c.prenom + ' ' + c.nom) }">
                Voir {{ nbDossiers() }} dossier{{ nbDossiers()! > 1 ? 's' : '' }}
              </a>
            }
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            <span class="tag" [class.haute]="c.kyc_statut === 'piece_expiree'" [class.ok]="c.kyc_statut === 'a_jour'">
              KYC : {{ libelleKyc(c.kyc_statut) }}
            </span>
            @if (auth.peut('clients.modifier')) {
              <button class="btn ghost" (click)="modeEdition() ? annulerEdition() : activerEdition(c)">
                {{ modeEdition() ? 'Annuler' : 'Modifier' }}
              </button>
            }
            @if (auth.peut('clients.supprimer')) {
              <button class="btn ghost danger" (click)="supprimerClient()">Supprimer</button>
            }
          </div>
        </div>
        <div class="meta">
          <div><span>Email</span><b>{{ c.email || '—' }}</b></div>
          <div><span>Téléphone</span><b>{{ c.telephone || '—' }}</b></div>
          <div><span>Adresse</span><b>{{ c.adresse || '—' }}, {{ c.ville }}</b></div>
          <div><span>Dernière MAJ KYC</span><b>{{ c.kyc_maj_le ? (c.kyc_maj_le | date:'dd/MM/yyyy') : '—' }}</b></div>
          @if (c.type === 'morale') {
            @if (c.capital_social) { <div><span>Capital social</span><b>{{ c.capital_social }}</b></div> }
            @if (c.representant_nom) { <div><span>Représentant légal</span><b>{{ c.representant_nom }}{{ c.representant_qualite ? ', ' + c.representant_qualite : '' }}</b></div> }
          } @else {
            @if (c.date_naissance || c.lieu_naissance) { <div><span>Naissance</span><b>{{ c.date_naissance ? (c.date_naissance | date:'dd/MM/yyyy') : '—' }}{{ c.lieu_naissance ? ' à ' + c.lieu_naissance : '' }}</b></div> }
            @if (c.profession) { <div><span>Profession</span><b>{{ c.profession }}</b></div> }
          }
        </div>
        <!-- 09/10/2026, repositionné le 09/10/2026 (2e passe, retour utilisateur :
             « entre-mêlées avec les sous-rubriques ») — rattaché au pied de l'en-tête
             (même patron que la fiche dossier) plutôt que laissé en texte libre entre
             la carte et les panneaux du dessous. -->
        <div class="dcard-foot">
          <span>
            Créé par <b>{{ c.cree_par_code || c.cree_par_nom || '—' }}</b>
            @if (c.cree_le) { le {{ c.cree_le | date:'dd/MM/yyyy à HH:mm' }} }
          </span>
          @if (c.derniere_modification; as dm) {
            <span class="dcard-foot-sep">
              Dernière modification par <b>{{ dm.utilisateur_code || dm.utilisateur_nom || '—' }}</b>
              — le {{ dm.horodatage | date:'dd/MM/yyyy à HH:mm' }}
            </span>
          }
        </div>
      </div>

      @if (erreur()) { <p class="err" style="margin:12px 0 0">{{ erreur() }}</p> }

      @if (modeEdition()) {
        <section class="panel">
          <h3>Modifier la fiche</h3>
          <div class="grid2">
            @if (c.type === 'morale') {
              <div><label>Dénomination</label><input class="in" [(ngModel)]="edit.denomination" name="editDenomination" /></div>
              <div><label>Forme juridique</label><input class="in" [(ngModel)]="edit.forme_juridique" name="editForme" /></div>
            } @else {
              <div><label>Prénom</label><input class="in" [(ngModel)]="edit.prenom" name="editPrenom" /></div>
              <div><label>Nom</label><input class="in" [(ngModel)]="edit.nom" name="editNom" /></div>
              <div><label>Nationalité</label><input class="in" [(ngModel)]="edit.nationalite" name="editNationalite" /></div>
            }
            @if (aIdentifiantFiscal(c.type)) {
              <div><label>RCCM</label><input class="in" [(ngModel)]="edit.rccm" name="editRccm" /></div>
              <div><label>NIF</label><input class="in" [(ngModel)]="edit.nif" name="editNif" /></div>
            }
            <div><label>Email</label><input class="in" type="email" [(ngModel)]="edit.email" name="editEmail" /></div>
            <div><label>Téléphone</label><input class="in" [(ngModel)]="edit.telephone" name="editTelephone" /></div>
            <div><label>Ville</label><input class="in" [(ngModel)]="edit.ville" name="editVille" /></div>
            <div><label>Pays</label><input class="in" [(ngModel)]="edit.pays" name="editPays" /></div>
            <div class="col2"><label>Adresse</label><input class="in" [(ngModel)]="edit.adresse" name="editAdresse" /></div>
            <div class="col2"><label>Bénéficiaires effectifs</label><input class="in" [(ngModel)]="edit.beneficiaires_effectifs" name="editBenef" /></div>
            <div class="col2"><label>Notes</label><input class="in" [(ngModel)]="edit.notes" name="editNotes" /></div>
          </div>
          <h4 class="sous-titre">Identité pour les actes <span class="muted">(facultatif — reprise dans l'Atelier d'actes ; une rubrique vide apparaît « [à compléter] »)</span></h4>
          <div class="grid2">
            @if (c.type === 'morale') {
              <div><label>Capital social</label><input class="in" [(ngModel)]="edit.capital_social" name="editCapital" placeholder="Ex. 5.000.000 F CFA" /></div>
              <div><label>Date d'immatriculation (RCCM)</label><input class="in" type="date" [(ngModel)]="edit.rccm_date" name="editRccmDate" /></div>
              <div><label>Représentant légal</label><input class="in" [(ngModel)]="edit.representant_nom" name="editRepNom" /></div>
              <div><label>Qualité du représentant</label><input class="in" [(ngModel)]="edit.representant_qualite" name="editRepQualite" placeholder="Ex. Directeur général" /></div>
              <div><label>Boîte postale</label><input class="in" [(ngModel)]="edit.boite_postale" name="editBp" /></div>
              <div><label>Droit applicable (société étrangère)</label><input class="in" [(ngModel)]="edit.droit_applicable" name="editDroit" placeholder="Ex. société de droit français" /></div>
            } @else {
              <div>
                <label>Civilité</label>
                <select class="in" [(ngModel)]="edit.civilite" name="editCivilite">
                  <option [ngValue]="null">—</option>
                  <option value="M">Monsieur</option>
                  <option value="Mme">Madame</option>
                  <option value="Mlle">Mademoiselle</option>
                </select>
              </div>
              <div><label>Profession</label><input class="in" [(ngModel)]="edit.profession" name="editProfession" /></div>
              <div><label>Date de naissance</label><input class="in" type="date" [(ngModel)]="edit.date_naissance" name="editNaissance" /></div>
              <div><label>Lieu de naissance</label><input class="in" [(ngModel)]="edit.lieu_naissance" name="editLieuNaissance" /></div>
              <div><label>Père (prénom et nom)</label><input class="in" [(ngModel)]="edit.pere" name="editPere" /></div>
              <div><label>Mère (prénom et nom)</label><input class="in" [(ngModel)]="edit.mere" name="editMere" /></div>
              <div><label>Boîte postale</label><input class="in" [(ngModel)]="edit.boite_postale" name="editBp2" /></div>
            }
          </div>
          <button class="btn" (click)="enregistrerFiche()" [disabled]="enregistrement()">
            {{ enregistrement() ? 'Enregistrement…' : 'Enregistrer' }}
          </button>
          @if (erreurEdition()) { <p class="err">{{ erreurEdition() }}</p> }
        </section>
      }

      @if (auth.peut('clients.modifier')) {
        <section class="panel">
          <h3>Statut KYC</h3>
          <div class="upload">
            <select class="sel" [(ngModel)]="nouveauStatutKyc" name="statutKyc">
              <option value="a_faire">À faire</option>
              <option value="incomplet">Incomplet</option>
              <option value="piece_expiree">Pièce expirée</option>
              <option value="a_jour">À jour</option>
            </select>
            <button class="btn" (click)="majStatutKyc()">Mettre à jour le statut</button>
          </div>
          @if (messageKyc()) { <p class="ok-msg">{{ messageKyc() }}</p> }
        </section>
      }

      <!-- Convention-cadre / abonnement — ancrage par CLIENT (09/10/2026,
           revu depuis le 05/10/2026, voir CLAUDE.md/HISTORY.md : une seule
           facture périodique couvre tous les dossiers du client, la
           configuration n'a donc plus de sens au niveau du dossier). -->
      <section class="panel">
        <h3>Convention-cadre (abonnement)</h3>
        @if (c.abonnement_periodicite) {
          <div class="conv-info">
            <div><span>Périodicité</span><b>{{ libellePeriodicite(c.abonnement_periodicite) }}</b></div>
            <div><span>Montant convenu</span><b>{{ c.abonnement_montant_convenu_xof ? (c.abonnement_montant_convenu_xof | number) + ' FCFA' : '—' }}</b></div>
            <div><span>Dernière facture</span><b>{{ c.abonnement_derniere_facture_le ? (c.abonnement_derniere_facture_le | date:'dd/MM/yyyy') : 'aucune facture encore liée' }}</b></div>
            <div>
              <span>Statut</span>
              <b>
                @if (c.abonnement_statut) {
                  <span class="tag" [class.haute]="c.abonnement_statut === 'en_retard'">
                    {{ c.abonnement_statut === 'en_retard' ? 'En retard depuis le ' : 'Prochaine échéance le ' }}{{ c.abonnement_prochaine_echeance | date:'dd/MM/yyyy' }}
                  </span>
                } @else { — }
              </b>
            </div>
          </div>
        } @else {
          <p class="muted">Ce client n'est pas sous convention-cadre — chaque dossier est facturé individuellement.</p>
        }
        @if (auth.peut('clients.modifier')) {
          @if (!modeEditionAbonnement()) {
            <button class="btn ghost" (click)="activerEditionAbonnement(c)">{{ c.abonnement_periodicite ? 'Modifier la convention' : 'Configurer une convention-cadre' }}</button>
          } @else {
            <div class="grid2">
              <div>
                <label>Périodicité</label>
                <select class="in" [(ngModel)]="editAbonnement.abonnement_periodicite" name="editAbonnementPeriodicite">
                  <option value="">— non configurée —</option>
                  @for (p of periodicitesAbonnement(); track p.code) { <option [value]="p.code">{{ p.libelle }}</option> }
                </select>
              </div>
              @if (editAbonnement.abonnement_periodicite && editAbonnement.abonnement_periodicite !== 'mensuelle') {
                <div>
                  <label>Mois d'ancrage</label>
                  <select class="in" [(ngModel)]="editAbonnement.mois_ancrage" name="editAbonnementMois" (ngModelChange)="onMoisAncrageChange()">
                    <option [value]="null">—</option>
                    @for (m of MOIS_NOMS; track m; let i = $index) { <option [value]="i + 1">{{ m }}</option> }
                  </select>
                </div>
              }
              <div>
                <label>Jour de facturation</label>
                <select class="in" [(ngModel)]="editAbonnement.jour_ancrage" name="editAbonnementJour">
                  <option [value]="null">—</option>
                  @for (j of joursDisponibles(editAbonnement.abonnement_periodicite === 'mensuelle' ? null : editAbonnement.mois_ancrage); track j) { <option [value]="j">{{ j }}</option> }
                </select>
              </div>
              <div class="col2">
                <label>Montant convenu (FCFA, facultatif)</label>
                <input class="in" type="number" min="0" [(ngModel)]="editAbonnement.montant_convenu" name="editAbonnementMontant" />
              </div>
            </div>
            <p class="muted" style="margin:-6px 0 12px">
              Ce repère se répète indéfiniment (il n'y a pas d'année à choisir, l'échéance n'a pas de fin) — pour une périodicité mensuelle, seul le jour compte ; au-delà, le mois d'ancrage fixe aussi le point de départ du cycle.
              Périodicité et jour de facturation doivent être renseignés ensemble, ou tous les deux laissés vides pour retirer la convention (tout dossier de ce client redevient alors facturé individuellement).
            </p>
            <button class="btn" (click)="enregistrerAbonnement()" [disabled]="enregistrementAbonnement()">{{ enregistrementAbonnement() ? 'Enregistrement…' : 'Enregistrer' }}</button>
            <button class="btn ghost" (click)="modeEditionAbonnement.set(false)">Annuler</button>
            @if (erreurAbonnement()) { <p class="err">{{ erreurAbonnement() }}</p> }
          }
        }
      </section>

      <section class="panel">
        <h3>Pièces KYC / LBC-FT</h3>
        @if (c.pieces_kyc?.length) {
          <table>
            <tr><th>Pièce</th><th>Expiration</th><th>Ajoutée le</th><th></th></tr>
            @for (p of c.pieces_kyc; track p.id) {
              <tr [class.expiree]="p.expiree">
                <td>{{ p.libelle }}</td>
                <td>{{ p.date_expiration ? (p.date_expiration | date:'dd/MM/yyyy') : '—' }}
                  @if (p.expiree) { <span class="tag haute">expirée</span> }
                </td>
                <td>{{ p.cree_le | date:'dd/MM/yyyy' }}</td>
                <td><app-menu-actions [actions]="actionsPourPiece(p)" /></td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucune pièce enregistrée.</p> }

        @if (auth.peut('clients.kyc_piece.ajouter')) {
          <div class="upload">
            <input class="sel" [(ngModel)]="nouvellePiece.libelle" name="libelle" placeholder="Ex. Passeport, RCCM…" />
            <input class="sel" type="date" [(ngModel)]="nouvellePiece.date_expiration" name="expiration" />
            <input type="file" (change)="onFichierChoisi($event)" />
            <button class="btn" (click)="ajouterPiece()" [disabled]="!nouvellePiece.libelle || ajoutEnCours()">
              {{ ajoutEnCours() ? 'Ajout…' : 'Ajouter la pièce' }}
            </button>
          </div>
        }
        @if (erreurPiece()) { <p class="err">{{ erreurPiece() }}</p> }
      </section>

      <section class="panel">
        <h3>Personnes &amp; entités liées</h3>
        <p class="muted">Bénéficiaires effectifs, filiales, dirigeants, représentants… (LBC-FT). Un lien saisi ici apparaît aussi sur la fiche de l'autre client.</p>
        @if (liensCombines(c).length) {
          <table>
            <tr><th>Nature</th><th>Client lié</th><th></th></tr>
            @for (l of liensCombines(c); track l.id) {
              <tr>
                <td>{{ l.nature }}</td>
                <td><a class="lien" [routerLink]="['/clients', l.lie_a_id]">{{ l.lie_a_nom }}</a></td>
                <td>
                  @if (auth.peut('clients.modifier')) {
                    <button class="lien" (click)="retirerLien(l.id)">Retirer</button>
                  }
                </td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucun lien enregistré.</p> }

        @if (auth.peut('clients.modifier')) {
          <div class="upload">
            <select class="sel" [(ngModel)]="nouveauLien.lie_a_id" name="lienClient">
              <option value="">Client lié…</option>
              @for (autre of autresClients(); track autre.id) {
                <option [value]="autre.id">{{ autre.denomination || (autre.prenom + ' ' + autre.nom) }}</option>
              }
            </select>
            <input class="sel" [(ngModel)]="nouveauLien.nature" name="lienNature" placeholder="Nature (ex. filiale, dirigeant, bénéficiaire effectif…)" />
            <button class="btn" (click)="ajouterLien()" [disabled]="!nouveauLien.lie_a_id || !nouveauLien.nature || ajoutLienEnCours()">{{ ajoutLienEnCours() ? 'Ajout…' : 'Ajouter' }}</button>
          </div>
          @if (doublonsLien().length) {
            <div class="doublon">
              <b>⚠ Ce lien existe déjà :</b>
              @for (d of doublonsLien(); track d.id) { <p>{{ d.nature }}</p> }
              <div class="btns">
                <button class="btn ghost" (click)="doublonsLien.set([])">Annuler, je vérifie</button>
                <button class="btn" (click)="ajouterLienQuandMeme()" [disabled]="ajoutLienEnCours()">Ajouter quand même</button>
              </div>
            </div>
          }
          @if (erreurLien()) { <p class="err">{{ erreurLien() }}</p> }
        }
      </section>

      <section class="panel">
        <h3>Dossiers liés</h3>
        @if (c.dossiers?.length) {
          <table>
            <tr><th>N°</th><th>Intitulé</th><th>Statut</th><th>Phase</th></tr>
            @for (d of c.dossiers; track d.id) {
              <tr class="clik" [routerLink]="['/dossiers', d.id]">
                <td>{{ d.numero }}</td><td>{{ d.intitule }}</td><td>{{ d.statut | libelle:'statutDossier' }}</td><td>{{ d.phase | libelle:'phase' }}</td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucun dossier pour ce client.</p> }
      </section>

      <section class="panel">
        <h3>Originaux &amp; pièces physiques confiés</h3>
        @if (c.originaux_confies?.length) {
          <table>
            <tr><th>Type</th><th>Description</th><th>Reçu le</th><th>Emplacement</th><th>Statut</th><th></th></tr>
            @for (o of c.originaux_confies; track o.id) {
              <tr>
                <td>{{ o.type_piece || '—' }}</td>
                <td>{{ o.description }}</td>
                <td>{{ o.recu_le | date:'dd/MM/yyyy' }}</td>
                <td>{{ o.emplacement || '—' }}</td>
                <td>
                  @if (o.restitue) { <span class="tag ok">Restitué le {{ o.restitue_le | date:'dd/MM/yyyy' }}</span> }
                  @else { <span class="tag">Conservé</span> }
                </td>
                <td>
                  @if (!o.restitue && auth.peut('originaux.restituer')) { <button class="lien" (click)="restituer(o.id)">Marquer restitué</button> }
                </td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucun original confié enregistré.</p> }

        @if (auth.peut('originaux.creer')) {
          <div class="upload">
            <select class="sel" [(ngModel)]="nouvelOriginal.type_piece" name="typePiece">
              <option value="">Type…</option>
              @for (t of typesOriginal(); track t.code) { <option [value]="t.code">{{ t.libelle }}</option> }
            </select>
            <input class="sel" [(ngModel)]="nouvelOriginal.description" name="description" placeholder="Description" />
            <input class="sel" [(ngModel)]="nouvelOriginal.emplacement" name="emplacement" placeholder="Emplacement (coffre, armoire…)" />
            <button class="btn" (click)="ajouterOriginal()" [disabled]="!nouvelOriginal.description || ajoutOriginalEnCours()">{{ ajoutOriginalEnCours() ? 'Ajout…' : 'Ajouter' }}</button>
          </div>
        }
      </section>
    } @else if (erreur()) {
      <p class="err">{{ erreur() }}</p>
    }
  `,
  styles: [`
    .sous-titre{margin:18px 0 6px;font-size:var(--fs-md)}
    .sous-titre .muted{font-weight:400;font-size:var(--fs-sm)}
    /* 09/10/2026 — traçabilité procédurale, intégrée au pied de l'en-tête bleu
       (repositionnée le 09/10/2026, 2e passe), même patron que dossier-detail.component.ts. */
    .dcard-foot{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:14px;padding-top:10px;border-top:1px solid rgba(255,255,255,.14);font-size:var(--fs-xs);color:#9aa7bd}
    .dcard-foot-sep::before{content:'·';margin-right:14px;opacity:.6}
    .dcard-foot b{color:#d7dde8}
    /* 26/09/2026 — audit doublons, même style que clients.component.ts. */
    .doublon{background:#fffaf0;border:1px solid #f0dcae;border-radius:10px;padding:14px 16px;margin-top:10px}
    .doublon p{margin:4px 0;font-size:var(--fs-base)}
    .doublon .btns{display:flex;gap:8px;margin-top:10px}
    .sel{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:var(--fs-base)}
    .upload{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer}
    .btn.ghost{background:#fff;border:1px solid var(--line);color:var(--slate)}
    .btn:disabled{opacity:.6}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    tr.expiree td{background:#fff5f4}
    .ok-msg{color:var(--green);font-size:var(--fs-base);margin-top:8px}
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md)}
    label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
    .col2{grid-column:1 / -1}
    .btn.ghost.danger{color:var(--red);border-color:#f0c8c5}
    /* 09/10/2026 — convention-cadre : .meta (dcard) ne s'applique qu'à
       l'en-tête bleu, réutilisée par erreur ici sans son contexte —
       corrigé en un style dédié, même esprit (libellé au-dessus de la
       valeur) mais fonctionnel dans un panneau ordinaire. */
    .conv-info{display:flex;gap:26px;flex-wrap:wrap;margin-bottom:12px}
    .conv-info div{display:flex;flex-direction:column;gap:2px}
    .conv-info span{font-size:var(--fs-xs);color:var(--slate)}
    .conv-info b{font-size:var(--fs-md)}
  `],
})
export class ClientDetailComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  private readonly preview = inject(DocumentPreviewService);

  readonly client = signal<any | null>(null);
  readonly erreur = signal('');
  // Navigation inter-modules (06/09/2026) — nombre de dossiers de ce client,
  // pour le lien "Voir les dossiers" (évite de cliquer dans le vide).
  readonly nbDossiers = signal<number | null>(null);
  readonly erreurPiece = signal('');
  readonly messageKyc = signal('');
  readonly ajoutEnCours = signal(false);

  // Convention-cadre / abonnement — ancrage par CLIENT (09/10/2026, voir
  // CLAUDE.md/HISTORY.md). Même patron d'édition inline que le registre
  // Facturation ("Clients sous convention"), ici directement sur la fiche
  // client — l'endroit naturel pour la configurer.
  readonly periodicitesAbonnement = signal<{ code: string; libelle: string }[]>([]);
  libellePeriodicite(code: string): string {
    return this.periodicitesAbonnement().find((p) => p.code === code)?.libelle ?? code;
  }
  readonly modeEditionAbonnement = signal(false);
  readonly enregistrementAbonnement = signal(false);
  readonly erreurAbonnement = signal('');
  editAbonnement: any = {};

  // Repère jour/mois sans année (10/10/2026) — remplace l'ancien input
  // type="date" qui donnait l'illusion trompeuse qu'on choisissait une
  // année : le serveur ne retient JAMAIS l'année (periodicite.js ne stocke
  // que jour_echeance/mois_echeance), et l'ancien composant reconstruisait
  // systématiquement la date affichée avec l'année courante à chaque
  // réouverture — toute année saisie était donc silencieusement perdue.
  readonly MOIS_NOMS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

  // Jours valides pour un mois donné (1-indexé), année de référence 2024
  // (bissextile, autorise le 29 février) — sans mois (périodicité
  // mensuelle), les 31 jours restent tous proposés, le clamp au nombre de
  // jours réel du mois se fait de toute façon à chaque occurrence calculée
  // côté serveur (calculerProchaineEcheance).
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

  activerEditionAbonnement(c: any): void {
    this.erreurAbonnement.set('');
    this.editAbonnement = {
      abonnement_periodicite: c.abonnement_periodicite || '',
      jour_ancrage: c.abonnement_jour_facturation ?? null,
      mois_ancrage: c.abonnement_mois_facturation ?? null,
      montant_convenu: c.abonnement_montant_convenu_xof ?? null,
    };
    this.modeEditionAbonnement.set(true);
  }

  enregistrerAbonnement(): void {
    this.erreurAbonnement.set('');
    const periodicite = this.editAbonnement.abonnement_periodicite || '';
    const jour = this.editAbonnement.jour_ancrage;
    if (!!periodicite !== !!jour) {
      this.erreurAbonnement.set('Périodicité et jour de facturation doivent être renseignés ensemble.');
      return;
    }
    if (periodicite && periodicite !== 'mensuelle' && !this.editAbonnement.mois_ancrage) {
      this.erreurAbonnement.set("Le mois d'ancrage est requis pour cette périodicité (au-delà de la mensuelle).");
      return;
    }
    // Reconstruit une date réelle uniquement pour le format attendu par
    // l'API (date d'ancrage) — l'année (2024, bissextile) n'a jamais
    // d'effet côté serveur, qui n'en extrait que le jour et le mois.
    let prochaineFacturation: string | null = null;
    if (periodicite) {
      const mois = periodicite === 'mensuelle' ? new Date().getMonth() + 1 : Number(this.editAbonnement.mois_ancrage);
      prochaineFacturation = `2024-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
    }
    this.enregistrementAbonnement.set(true);
    this.api.majAbonnementClient(this.clientId, {
      abonnement_periodicite: periodicite || null,
      abonnement_prochaine_facturation: prochaineFacturation,
      montant_convenu: this.editAbonnement.montant_convenu,
    }).subscribe({
      next: () => {
        this.enregistrementAbonnement.set(false);
        this.modeEditionAbonnement.set(false);
        this.charger();
      },
      error: (e) => {
        this.enregistrementAbonnement.set(false);
        this.erreurAbonnement.set(e?.error?.error ?? 'Enregistrement impossible.');
      },
    });
  }
  readonly typesOriginal = signal<{ code: string; libelle: string }[]>([]);

  // Édition de la fiche identité/coordonnées (ajout 18/08/2026) — le backend
  // (PUT /api/clients/:id) le permettait déjà, mais aucun écran n'exposait
  // ces champs : seul le statut KYC était modifiable via l'UI (gap signalé
  // par l'utilisateur). Même patron que dossier-detail.component.ts.
  readonly modeEdition = signal(false);
  readonly enregistrement = signal(false);
  readonly erreurEdition = signal('');
  edit: any = {};

  clientId = '';
  nouveauStatutKyc = 'a_jour';
  nouvellePiece: { libelle: string; date_expiration: string } = { libelle: '', date_expiration: '' };
  fichierChoisi: File | null = null;
  nouvelOriginal: { type_piece: string; description: string; emplacement: string } = { type_piece: '', description: '', emplacement: '' };

  // Personnes/entités liées (20/08/2026, diagnostic utilisateur) — la table
  // client_liens existait déjà (lue par GET /api/clients/:id) mais n'avait
  // jusqu'ici aucun écran ni aucune route d'écriture (voir clients.js).
  readonly clientsTous = signal<any[]>([]);
  readonly erreurLien = signal('');
  // 26/09/2026 — audit doublons : garde anti-double-clic + avertissement de
  // ressaisie pour les liens (deux fois le même client lié avec la même
  // nature n'a jamais de sens légitime, mais on reste sur un avertissement
  // plutôt qu'un blocage dur, cohérent avec le reste de cette passe).
  readonly ajoutLienEnCours = signal(false);
  readonly doublonsLien = signal<any[]>([]);
  readonly ajoutOriginalEnCours = signal(false);
  nouveauLien: { lie_a_id: string; nature: string } = { lie_a_id: '', nature: '' };

  // Combine les deux sens (liens saisis depuis cette fiche + liens saisis
  // depuis l'autre bout) en une seule liste pour l'affichage.
  liensCombines(c: any): any[] {
    return [...(c.liens || []), ...(c.liens_inverses || [])];
  }

  autresClients(): any[] {
    const dejaLies = new Set([this.clientId, ...this.liensCombines(this.client()).map((l: any) => l.lie_a_id)]);
    return this.clientsTous().filter((c) => !dejaLies.has(c.id));
  }

  ajouterLien(): void {
    if (!this.nouveauLien.lie_a_id || !this.nouveauLien.nature) return;
    this.erreurLien.set('');
    this.doublonsLien.set([]);
    this.api.verifierDoublonLien(this.clientId, this.nouveauLien.lie_a_id, this.nouveauLien.nature).subscribe({
      next: (d) => { if (d.length) this.doublonsLien.set(d); else this.ajouterLienReellement(); },
      error: () => this.ajouterLienReellement(),
    });
  }

  ajouterLienQuandMeme(): void {
    this.doublonsLien.set([]);
    this.ajouterLienReellement();
  }

  private ajouterLienReellement(): void {
    this.ajoutLienEnCours.set(true);
    this.api.ajouterLienClient(this.clientId, this.nouveauLien).subscribe({
      next: () => { this.ajoutLienEnCours.set(false); this.nouveauLien = { lie_a_id: '', nature: '' }; this.doublonsLien.set([]); this.charger(); },
      error: (e) => { this.ajoutLienEnCours.set(false); this.erreurLien.set(e?.error?.error ?? 'Ajout impossible.'); },
    });
  }

  retirerLien(lienId: string): void {
    if (!window.confirm('Retirer ce lien ?')) return;
    this.api.retirerLienClient(this.clientId, lienId).subscribe({
      next: () => this.charger(),
      error: (e) => this.erreurLien.set(e?.error?.error ?? 'Retrait impossible.'),
    });
  }

  private readonly libellesKyc: Record<string, string> = {
    a_faire: 'À faire', incomplet: 'Incomplet', piece_expiree: 'Pièce expirée', a_jour: 'À jour',
  };
  libelleKyc(statut: string): string { return this.libellesKyc[statut] ?? statut; }

  // 10/10/2026 — même règle que clients.component.ts (liste) : un
  // entrepreneur individuel est identifié en prénom/nom (comme "physique")
  // mais a RCCM/NIF (comme "morale") ; un "physique" simple n'a ni l'un ni
  // l'autre.
  libelleTypeClient(type: string): string {
    if (type === 'morale') return 'Personne morale';
    if (type === 'entrepreneur_individuel') return 'Entrepreneur individuel';
    return 'Personne physique';
  }

  aIdentifiantFiscal(type: string): boolean {
    return type === 'morale' || type === 'entrepreneur_individuel';
  }

  ngOnInit(): void {
    this.clientId = this.route.snapshot.paramMap.get('id') ?? '';
    this.charger();
    this.api.listesValeurs('type_original').subscribe({ next: (t) => this.typesOriginal.set(t) });
    this.api.clients().subscribe({ next: (c) => this.clientsTous.set(c) });
    this.api.listesValeurs('periodicite').subscribe({ next: (l) => this.periodicitesAbonnement.set(l.filter((p) => p.code !== 'ponctuelle')) });
  }

  charger(): void {
    this.api.client(this.clientId).subscribe({
      next: (c) => { this.client.set(c); this.nouveauStatutKyc = c.kyc_statut; },
      error: () => this.erreur.set('Impossible de charger ce client.'),
    });
    this.api.dossiers('', { client_id: this.clientId }).subscribe({
      next: (d) => this.nbDossiers.set(d.length),
      error: () => this.nbDossiers.set(null),
    });
  }

  activerEdition(c: any): void {
    this.edit = {
      denomination: c.denomination, rccm: c.rccm, nif: c.nif, forme_juridique: c.forme_juridique,
      prenom: c.prenom, nom: c.nom, nationalite: c.nationalite,
      email: c.email, telephone: c.telephone, adresse: c.adresse, ville: c.ville, pays: c.pays,
      beneficiaires_effectifs: c.beneficiaires_effectifs, notes: c.notes,
      civilite: c.civilite, date_naissance: c.date_naissance, lieu_naissance: c.lieu_naissance, pere: c.pere, mere: c.mere,
      profession: c.profession, capital_social: c.capital_social, rccm_date: c.rccm_date,
      representant_nom: c.representant_nom, representant_qualite: c.representant_qualite,
      boite_postale: c.boite_postale, droit_applicable: c.droit_applicable,
    };
    this.erreurEdition.set('');
    this.modeEdition.set(true);
  }

  annulerEdition(): void {
    this.modeEdition.set(false);
  }

  enregistrerFiche(): void {
    this.erreurEdition.set('');
    this.enregistrement.set(true);
    this.api.majClient(this.clientId, { ...this.edit, maj_le_attendu: this.client()?.maj_le }).subscribe({
      next: () => { this.enregistrement.set(false); this.modeEdition.set(false); this.charger(); },
      error: (e) => {
        this.enregistrement.set(false);
        if (e?.status === 409) {
          this.erreurEdition.set('Cette fiche a été modifiée entre-temps — rechargement...');
          this.charger();
        } else {
          this.erreurEdition.set(e?.error?.error ?? 'Enregistrement impossible.');
        }
      },
    });
  }

  supprimerClient(): void {
    if (!window.confirm('Supprimer définitivement ce client ? Impossible si une activité (dossier, facture, pièce KYC…) est déjà enregistrée.')) return;
    this.erreur.set('');
    this.api.supprimerClient(this.clientId).subscribe({
      next: () => this.router.navigate(['/clients']),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Suppression impossible.'),
    });
  }

  majStatutKyc(): void {
    this.messageKyc.set('');
    this.erreur.set('');
    this.api.majClient(this.clientId, {
      kyc_statut: this.nouveauStatutKyc,
      maj_le_attendu: this.client()?.maj_le,
    }).subscribe({
      next: () => { this.messageKyc.set('Statut KYC mis à jour.'); this.charger(); },
      error: (e) => {
        if (e?.status === 409) {
          this.erreur.set(e?.error?.error ?? 'Cette fiche a été modifiée entre-temps — rechargement...');
          this.charger(); // recharge la version à jour pour repartir sur des bases fraîches
        } else {
          this.erreur.set('Mise à jour impossible.');
        }
      },
    });
  }

  onFichierChoisi(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.fichierChoisi = input.files?.[0] ?? null;
  }

  ajouterPiece(): void {
    this.ajoutEnCours.set(true);
    this.erreurPiece.set('');
    this.api.ajouterPieceKyc(this.clientId, this.nouvellePiece.libelle, this.nouvellePiece.date_expiration || null, this.fichierChoisi)
      .subscribe({
        next: () => {
          this.ajoutEnCours.set(false);
          this.nouvellePiece = { libelle: '', date_expiration: '' };
          this.fichierChoisi = null;
          this.charger();
        },
        error: (e) => { this.ajoutEnCours.set(false); this.erreurPiece.set(e?.error?.error ?? 'Ajout impossible.'); },
      });
  }

  // Ouverture classique + aperçu sans ouverture (21/08/2026, demande
  // utilisateur) — n'existaient pas du tout ici jusqu'ici (seule la
  // suppression était exposée, alors que l'API de téléchargement existait
  // déjà). Le Content-Type renvoyé par le serveur dépend de `type_mime`,
  // capturé uniquement depuis cette même date (voir schema.sql/clients.js)
  // — les pièces plus anciennes retombent sur "aperçu non disponible".
  apercuPiece(p: any): void {
    this.preview.ouvrir(p.libelle, this.api.telechargerPieceKyc(this.clientId, p.id));
  }

  // Menu "⋮" (19/09/2026).
  actionsPourPiece(p: any): ActionMenuItem[] {
    const items: ActionMenuItem[] = [
      { label: 'Aperçu', action: () => this.apercuPiece(p) },
      { label: 'Ouvrir', action: () => this.ouvrirPiece(p) },
    ];
    if (this.auth.peut('clients.kyc_piece.supprimer')) items.push({ label: 'Supprimer', action: () => this.supprimerPiece(p.id), danger: true });
    return items;
  }

  ouvrirPiece(p: any): void {
    this.api.telechargerPieceKyc(this.clientId, p.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      error: () => this.erreurPiece.set('Ouverture impossible.'),
    });
  }

  supprimerPiece(pieceId: string): void {
    if (!window.confirm('Supprimer définitivement cette pièce KYC ?')) return;
    this.api.supprimerPieceKyc(this.clientId, pieceId).subscribe({
      next: () => this.charger(),
      error: (e) => this.erreurPiece.set(e?.error?.error ?? 'Suppression impossible.'),
    });
  }

  ajouterOriginal(): void {
    this.erreur.set('');
    this.ajoutOriginalEnCours.set(true);
    this.api.creerOriginal({ client_id: this.clientId, ...this.nouvelOriginal }).subscribe({
      next: () => { this.ajoutOriginalEnCours.set(false); this.nouvelOriginal = { type_piece: '', description: '', emplacement: '' }; this.charger(); },
      error: () => { this.ajoutOriginalEnCours.set(false); this.erreur.set('Ajout de l’original impossible.'); },
    });
  }

  restituer(id: string): void {
    const a = window.prompt('Remis à (nom de la personne) :');
    if (!a) return;
    this.erreur.set('');
    this.api.restituerOriginal(id, a).subscribe({
      next: () => this.charger(),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Opération impossible.'),
    });
  }
}
