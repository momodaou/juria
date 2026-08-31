import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ClientPickerComponent } from '../../core/client-picker.component';

@Component({
  selector: 'app-ouverture',
  standalone: true,
  imports: [FormsModule, RouterLink, ClientPickerComponent],
  template: `
    <header class="page-head"><h1>Ouverture de dossier</h1></header>

    <section class="panel">
      <h3>Étape 1 — Contrôle des conflits d'intérêts (obligatoire)</h3>

      <label>Client</label>
      <input class="in" [(ngModel)]="clientNom" name="clientNom" placeholder="Ex. Bâtir-SA" />

      <label>Parties adverses / tiers liés (séparés par des virgules, facultatif)</label>
      <input class="in" [(ngModel)]="partiesAdverses" name="partiesAdverses" placeholder="Ex. SODIMA Sarl, M. Traoré" />

      @if (auth.peut('conflits.soumettre')) {
        <button class="btn" (click)="verifier()" [disabled]="chargement() || !clientNom">
          {{ chargement() ? 'Vérification…' : 'Lancer le contrôle' }}
        </button>
      } @else {
        <p class="err">Vous n'êtes pas autorisé à soumettre un contrôle de conflit.</p>
      }

      @if (resultat(); as r) {
        <div class="result" [class.ok]="r.resultat === 'absence'" [class.warn]="r.resultat === 'potentiel'">
          <b>{{ r.resultat === 'absence' ? '✓ Absence de conflit' : '⚠ Conflit potentiel détecté' }}</b>
          <p>{{ r.message }}</p>

          <div class="verifies">
            <span class="terme">Client vérifié :</span> <span class="chip">{{ clientNom }}</span>
            @if (partiesAdversesListe().length) {
              <span class="terme">Parties adverses vérifiées :</span>
              @for (p of partiesAdversesListe(); track p) { <span class="chip">{{ p }}</span> }
            }
          </div>

          @for (d of r.details; track d.terme) {
            <div class="match">
              <span class="terme">{{ d.terme }}</span> :
              @for (c of d.correspondances; track c.id) {
                <span class="chip">{{ c.nom }} ({{ c.source }}{{ c.dossier ? ' · ' + c.dossier : '' }})</span>
              }
            </div>
          }

          @if (r.resultat === 'potentiel' && !decisionPrise() && auth.peut('conflits.decision')) {
            <div class="decision">
              <label>Décision de l'associé</label>
              <input class="in" [(ngModel)]="motif" name="motif" placeholder="Motif (obligatoire)" />
              <div class="btns">
                <button class="btn ghost" (click)="decider(r.id, 'refuse')">Refuser</button>
                <button class="btn ghost" (click)="decider(r.id, 'oriente')">Orienter vers un confrère</button>
                <button class="btn" (click)="decider(r.id, 'accepte')">Accepter (motivé)</button>
              </div>
            </div>
          }

          @if (decisionPrise(); as dec) {
            <p class="decision-finale">Décision enregistrée : <b>{{ dec }}</b>.
              @if (dec === 'accepte' || r.resultat === 'absence') { L'ouverture peut se poursuivre. }
            </p>
          }
        </div>
      }

      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
    </section>

    @if (peutCreer()) {
      <section class="panel">
        <h3>Étape 2 — Création du dossier</h3>

        <label>Client</label>
        <app-client-picker [valeur]="dossier.client_id" [nomInitial]="nomClientPreselectionne"
                            (valeurChange)="dossier.client_id = $event"
                            (clientChoisi)="onClientPrincipalChoisi($event)"
                            placeholder="Rechercher le client (nom, RCCM, NIF, email…)"></app-client-picker>
        @if (!dossier.client_id && clientNom && creationClientCible() !== 'principal') {
          <p class="hint">
            Aucun client existant ne correspond exactement à « {{ clientNom }} » — vérifiez l'orthographe ci-dessus,
            @if (auth.peut('clients.creer')) {
              <button class="lien" type="button" (click)="ouvrirCreationClient('principal')">créez-le maintenant</button>,
            }
            ou <a routerLink="/clients" class="lien">complétez son KYC dans Clients &amp; KYC</a> plus tard.
          </p>
        }

        @if (creationClientCible(); as cible) {
          <div class="inline-client">
            <label>Nouveau client — {{ cible === 'principal' ? 'client principal' : 'client additionnel' }}</label>
            <select class="in" [(ngModel)]="nouveauClient.type" name="ncType">
              <option value="morale">Personne morale</option>
              <option value="physique">Personne physique</option>
            </select>
            @if (nouveauClient.type === 'morale') {
              <input class="in" [(ngModel)]="nouveauClient.denomination" name="ncDenomination" placeholder="Dénomination" />
            } @else {
              <div class="grid2">
                <input class="in" [(ngModel)]="nouveauClient.prenom" name="ncPrenom" placeholder="Prénom" />
                <input class="in" [(ngModel)]="nouveauClient.nom" name="ncNom" placeholder="Nom" />
              </div>
            }
            <div class="grid2">
              <input class="in" [(ngModel)]="nouveauClient.email" name="ncEmail" placeholder="Email (facultatif)" />
              <input class="in" [(ngModel)]="nouveauClient.telephone" name="ncTelephone" placeholder="Téléphone (facultatif)" />
            </div>
            <p class="muted" style="margin:-6px 0 10px">KYC laissé « à faire » — à compléter dans Clients &amp; KYC quand vous aurez les pièces.</p>

            @if (doublonsClient().length) {
              <div class="doublon">
                <b>⚠ Client(s) déjà en base ressemblant à celui-ci :</b>
                @for (d of doublonsClient(); track d.id) {
                  <p><a class="lien" [routerLink]="['/clients', d.id]" target="_blank">{{ d.denomination || (d.prenom + ' ' + d.nom) }}</a> — {{ d.motifs.join(', ') }}</p>
                }
                <div class="upload">
                  <button class="btn ghost" type="button" (click)="doublonsClient.set([])">Annuler, je vérifie</button>
                  <button class="btn" type="button" (click)="creerClientInline(true)">Créer quand même</button>
                </div>
              </div>
            } @else {
              <div class="upload">
                <button class="btn" type="button" (click)="creerClientInline()"
                        [disabled]="creationClientEnCours() || (nouveauClient.type === 'morale' ? !nouveauClient.denomination : !nouveauClient.nom)">
                  {{ creationClientEnCours() ? 'Création…' : 'Créer et sélectionner' }}
                </button>
                <button class="btn ghost" type="button" (click)="fermerCreationClient()">Annuler</button>
              </div>
            }
            @if (erreurNouveauClient()) { <p class="err">{{ erreurNouveauClient() }}</p> }
          </div>
        }

        <label>Autres clients sur ce dossier (facultatif — personnes physiques ou morales additionnelles)</label>
        <app-client-picker [exclureIds]="exclureAdditionnels()" [reinitialiserApresChoix]="true"
                            placeholder="Rechercher un client à ajouter…"
                            (clientChoisi)="ajouterClientAdditionnel($event)"></app-client-picker>
        @if (auth.peut('clients.creer') && creationClientCible() !== 'additionnel') {
          <button class="btn ghost" type="button" style="margin:-4px 0 12px" (click)="ouvrirCreationClient('additionnel')">+ Nouveau client</button>
        }
        @if (clientsAdditionnels().length) {
          <div class="verifies" style="margin-bottom:12px">
            @for (c of clientsAdditionnels(); track c.id) {
              <span class="chip">{{ c.nom }} <button class="lien-x" type="button" (click)="retirerClientAdditionnel(c.id)">✕</button></span>
            }
          </div>
        }

        <label>Parties adverses (séparées par des virgules, facultatif)</label>
        <input class="in" [(ngModel)]="partiesAdversesEdit" name="partiesAdversesEdit"
               (ngModelChange)="suggererIntitule()" placeholder="Ex. SODIMA Sarl, M. Traoré" />

        <label>Intitulé du dossier</label>
        <input class="in" [(ngModel)]="intituleDossier" name="intituleDossier"
               placeholder="Ex. Bâtir-SA c/ SODIMA Sarl" />
        <p class="muted" style="margin:-8px 0 12px">
          Suggéré automatiquement (« Client c/ Partie adverse » en contentieux, nom du client en conseil) — modifiable librement.
        </p>

        <div class="grid2">
          <div>
            <label>Pôle</label>
            <select class="in" [(ngModel)]="dossier.pole" name="pole" (ngModelChange)="onPoleChange()">
              <option value="contentieux">Contentieux</option>
              <option value="conseil">Conseil</option>
            </select>
          </div>
          <div>
            <label>Matière — discipline (facultatif, IND par défaut si non renseignée)</label>
            <select class="in" [(ngModel)]="dossier.code_matiere" name="matiere" (ngModelChange)="onMatiereChange()">
              <option value="">— Sélectionner (IND par défaut) —</option>
              @for (m of matieres(); track m.code) { <option [value]="m.code">{{ m.code }} — {{ m.libelle }}</option> }
            </select>
          </div>

          @if (dossier.pole === 'contentieux') {
            <div>
              <label>Statut procédure</label>
              <select class="in" [(ngModel)]="dossier.statut_procedure" name="statutProcedure">
                <option value="">— Sélectionner —</option>
                @for (s of statutsProcedure(); track s.code) { <option [value]="s.code">{{ s.libelle }}</option> }
              </select>
              @if (dossier.statut_procedure === 'autre') {
                <input class="in" [(ngModel)]="dossier.statut_procedure_precision" name="statutProcedurePrecision" placeholder="Préciser" />
              }
            </div>
            <div>
              <label>Juridiction</label>
              <select class="in" [(ngModel)]="juridictionChoisie" name="juridiction" (ngModelChange)="onJuridictionChange()">
                <option value="">— Sélectionner —</option>
                @for (j of juridictions(); track j.code) { <option [value]="j.code">{{ j.libelle }}</option> }
              </select>
              @if (juridictionChoisie === 'autre') {
                <input class="in" [(ngModel)]="dossier.juridiction" name="juridictionAutre" placeholder="Préciser la juridiction" />
              }
            </div>
            <div>
              <label>Instance (degré)</label>
              <select class="in" [(ngModel)]="dossier.instance_degre" name="instanceDegre">
                <option value="premiere_instance">Première instance</option>
                <option value="appel">Appel</option>
                <option value="cassation">Cassation (dont CCJA)</option>
                <option value="opposition">Opposition</option>
                <option value="refere">Référé</option>
                <option value="execution">Exécution</option>
                <option value="autre">Autre</option>
              </select>
            </div>
            <div>
              <label>Montant du litige (FCFA, facultatif)</label>
              <input class="in" type="number" [(ngModel)]="dossier.montant_litige" name="montantLitige" />
            </div>
            <div>
              <label>Réclamé par (facultatif)</label>
              <select class="in" [(ngModel)]="dossier.montant_litige_sens" name="montantLitigeSens">
                <option value="indetermine">Indéterminé</option>
                <option value="reclame_par_client">Notre client</option>
                <option value="reclame_par_partie_adverse">La partie adverse</option>
              </select>
            </div>
          } @else {
            <div class="col2">
              <label>Cabinet ou avocat partenaire (intermédiaire, facultatif)</label>
              <input class="in" [(ngModel)]="dossier.intermediaire" name="intermediaire" placeholder="Ex. Cabinet correspondant ou confrère qui fait le tampon" />
            </div>
          }

          <div class="col2">
            <label>Nature / objet du dossier (facultatif)</label>
            <textarea class="in" [(ngModel)]="dossier.objet" name="objet" rows="2"
                      placeholder="Ex. Recouvrement d'une créance commerciale impayée"></textarea>
          </div>

          <div>
            <label>Mode d'honoraires</label>
            <select class="in" [(ngModel)]="dossier.mode_honoraires" name="modeHonoraires">
              <option value="forfait">Forfait</option>
              <option value="temps_passe">Temps passé</option>
              <option value="success_fee">Success fee</option>
              <option value="abonnement">Abonnement</option>
              <option value="consultation">Consultation</option>
            </select>
          </div>
          <div>
            <label>Urgence</label>
            <select class="in" [(ngModel)]="dossier.urgence" name="urgence">
              <option value="moyenne">Moyenne</option>
              <option value="basse">Basse</option>
              <option value="haute">Haute</option>
            </select>
          </div>
          <div>
            <label>Responsable</label>
            <select class="in" [(ngModel)]="dossier.responsable_id" name="responsableId">
              <option value="">— Sélectionner —</option>
              @for (u of responsablesDisponibles(); track u.id) {
                <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option>
              }
            </select>
            @if (dossier.pro_bono) {
              <span class="hint">Un dossier pro bono ne peut être attribué qu'à un avocat associé — liste filtrée.</span>
            } @else if (!estAssocie()) {
              <span class="hint">Seul un avocat associé peut désigner un collaborateur/stagiaire/juriste comme responsable — liste filtrée aux associés.</span>
            }
          </div>
        </div>

        @if (auth.peut('dossiers.pro_bono.declarer')) {
          <label class="pb">
            <input type="checkbox" [(ngModel)]="dossier.pro_bono" (ngModelChange)="proBonoChange()" name="proBono" />
            Dossier pro bono (soumis au quota mensuel, frais de procédure minimum plutôt que le seuil d'honoraires classique — réservé aux dossiers attribués à un associé, y compris sur saisie déléguée à un collaborateur)
          </label>
        }

        <button class="btn" (click)="creerDossier()" [disabled]="creation() || !formValide()">
          {{ creation() ? 'Création…' : 'Créer le dossier' }}
        </button>
        @if (erreurCreation()) { <p class="err">{{ erreurCreation() }}</p> }
      </section>
    }
  `,
  styles: [`
    .in{display:block;width:100%;max-width:520px;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:14px}
    label{font-size:12px;color:var(--slate);font-weight:600}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn.ghost{background:#fff;border:1px solid var(--line);color:var(--slate)}
    .btn:disabled{opacity:.6}
    .result{margin-top:16px;border-radius:10px;padding:14px 16px}
    .result.ok{background:#e3f5ec;border:1px solid #9ed9bd}
    .result.warn{background:#fffaf0;border:1px solid #f0dcae}
    .match{margin-top:8px;font-size:13px}
    .terme{font-weight:600}
    .chip{display:inline-block;background:#fff;border:1px solid var(--line);border-radius:12px;padding:2px 9px;margin:2px;font-size:12px}
    .lien-x{background:none;border:none;color:var(--slate);cursor:pointer;font-size:11px;padding:0 0 0 4px}
    .upload{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
    .upload select{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px}
    .decision{margin-top:14px}
    .decision .btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
    .decision-finale{margin-top:12px;font-size:14px}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
    .col2{grid-column:1 / -1}
    textarea.in{font-family:inherit;resize:vertical}
    .pb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--slate);margin:6px 0 14px;cursor:pointer}
    .pb input{width:auto}
    .verifies{margin-top:10px;font-size:13px}
    .verifies .terme{display:block;margin-top:6px}
    .hint{font-size:12px;color:#9a6c12;margin:-6px 0 12px}
    .hint .lien{color:#9a6c12;text-decoration:underline}
    .lien{background:none;border:none;color:var(--gold);cursor:pointer;font-size:inherit;padding:0;text-decoration:underline}
    .muted{color:var(--grey);font-size:12px}
    .inline-client{background:var(--light);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:16px}
    .doublon{background:#fff;border:1px solid #f0dcae;border-radius:8px;padding:12px 14px;margin-top:4px}
    .doublon p{margin:4px 0;font-size:13px}
    .doublon .lien{color:var(--gold);text-decoration:underline}
  `],
})
export class OuvertureComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  clientNom = '';
  partiesAdverses = '';
  motif = '';
  readonly resultat = signal<any | null>(null);
  readonly decisionPrise = signal<string | null>(null);
  readonly chargement = signal(false);
  readonly erreur = signal('');

  // Étape 2 — création du dossier une fois l'absence de conflit confirmée
  // (ou le conflit potentiel accepté par un associé). numero généré
  // automatiquement côté serveur (référencement automatique, AFF-AA-XXX),
  // pas demandé ici. Les parties adverses saisies à l'étape 1 sont reprises
  // ici (éditables) plutôt que de disparaître après le contrôle des
  // conflits — corrige un gap signalé par l'utilisateur : le client et les
  // parties adverses vérifiés n'apparaissaient nulle part ensuite.
  // Sélecteur client principal/additionnel (21/08/2026, diagnostic
  // utilisateur) — ne précharge plus la liste complète des clients (capée
  // à 200, sans recherche) : <app-client-picker> interroge GET /api/clients
  // ?q= à la demande (voir client-picker.component.ts).
  readonly utilisateurs = signal<any[]>([]);
  readonly creation = signal(false);
  readonly erreurCreation = signal('');
  partiesAdversesEdit = '';
  dossier: any = { pole: 'contentieux', mode_honoraires: 'forfait', urgence: 'moyenne', pro_bono: false, instance_degre: 'premiere_instance', code_matiere: '', montant_litige_sens: 'indetermine' };

  // Intitulé du dossier (30/08/2026, demande utilisateur) — suggéré
  // automatiquement (« Client c/ Partie adverse » en contentieux, client
  // seul en conseil) dès que client/pôle/parties adverses sont connus, mais
  // reste un champ texte libre ordinaire : dernière valeur suggérée gardée
  // en mémoire (intituleAutoGenere) pour ne re-suggérer que tant que
  // l'utilisateur n'a pas lui-même modifié le champ — même garde
  // anti-écrasement que <app-client-picker> (21/08/2026). Ne s'applique
  // qu'à la création : une fois le dossier créé, `intitule` redevient un
  // champ texte ordinaire, sans re-suggestion (voir dossier-detail).
  intituleDossier = '';
  private intituleAutoGenere: string | null = null;
  nomClientPrincipal: string | null = null;

  private joindre(items: string[]): string {
    const liste = items.filter(Boolean);
    if (liste.length <= 1) return liste[0] ?? '';
    return `${liste.slice(0, -1).join(', ')} et ${liste[liste.length - 1]}`;
  }

  private composerIntitule(): string {
    const clients = this.joindre([this.nomClientPrincipal ?? '', ...this.clientsAdditionnels().map((c) => c.nom)]);
    if (!clients) return '';
    if (this.dossier.pole !== 'contentieux') return clients;
    const parties = this.joindre(this.partiesAdversesEdit.split(',').map((s) => s.trim()));
    return parties ? `${clients} c/ ${parties}` : clients;
  }

  suggererIntitule(): void {
    const suggestion = this.composerIntitule();
    if (!suggestion) return;
    // Ne remplace le champ que s'il est vide ou encore égal à la dernière
    // suggestion — jamais si l'utilisateur l'a personnalisé entre-temps.
    if (!this.intituleDossier || this.intituleDossier === this.intituleAutoGenere) {
      this.intituleDossier = suggestion;
    }
    this.intituleAutoGenere = suggestion;
  }

  onClientPrincipalChoisi(c: any): void {
    this.nomClientPrincipal = c ? (c.denomination || `${c.prenom ?? ''} ${c.nom ?? ''}`.trim()) : null;
    this.suggererIntitule();
  }

  // Champs conditionnels par pôle (19/08/2026) — matière suit désormais le
  // Guide de référencement des dossiers (table codes_matiere, déjà en base
  // mais jamais branchée jusqu'ici — remplace le domaine listes_valeurs
  // ad hoc créé la veille avant la découverte de ce référentiel officiel).
  // statut procédure/juridiction restent sur listes_valeurs, non concernés
  // par le guide. L'instance (degré) branche la table `instances`.
  readonly matieres = signal<{ code: string; libelle: string; couleur: string }[]>([]);
  readonly statutsProcedure = signal<{ code: string; libelle: string }[]>([]);
  readonly juridictions = signal<{ code: string; libelle: string }[]>([]);
  juridictionChoisie = '';

  chargerMatieres(): void {
    this.api.codesMatiere(this.dossier.pole).subscribe({ next: (l) => this.matieres.set(l) });
  }

  onPoleChange(): void {
    this.dossier.code_matiere = '';
    this.dossier.matiere = '';
    this.chargerMatieres();
    this.suggererIntitule();
  }

  onMatiereChange(): void {
    const m = this.matieres().find((x) => x.code === this.dossier.code_matiere);
    this.dossier.matiere = m ? m.libelle : '';
  }

  onJuridictionChange(): void {
    if (this.juridictionChoisie === 'autre') { this.dossier.juridiction = ''; return; }
    const j = this.juridictions().find((x) => x.code === this.juridictionChoisie);
    this.dossier.juridiction = j ? j.libelle : '';
  }

  formValide(): boolean {
    return !!(this.dossier.client_id && this.dossier.responsable_id && this.intituleDossier.trim());
  }

  // Deux règles, filtrées ensemble ici (30/08/2026, précisions de
  // l'utilisateur) — indicatif côté écran, la vraie garde est dans
  // POST/PUT /api/dossiers :
  //  - un dossier pro bono ne peut être attribué qu'à un associé ;
  //  - sur tout dossier, seul un associé peut imputer la responsabilité à
  //    un profil subordonné (Of Counsel, collaborateur, avocat stagiaire,
  //    juriste, stagiaire) — un compte non-associé ne peut donc désigner
  //    qu'un associé comme responsable, jamais lui-même ni un collègue.
  estAssocie(): boolean {
    return ['associe', 'associe_fondateur'].includes(this.auth.utilisateur()?.role ?? '');
  }

  responsablesDisponibles(): any[] {
    if (this.dossier.pro_bono || !this.estAssocie()) {
      return this.utilisateurs().filter((u) => u.role === 'associe' || u.role === 'associe_fondateur');
    }
    return this.utilisateurs();
  }

  proBonoChange(): void {
    if (this.dossier.pro_bono && !this.responsablesDisponibles().some((u: any) => u.id === this.dossier.responsable_id)) {
      this.dossier.responsable_id = '';
    }
  }

  // Clients additionnels (18/08/2026) — un même dossier peut comporter
  // plusieurs identités clientes (personnes physiques ou morales). Stocke
  // désormais {id, nom} directement (fourni par le picker au choix) plutôt
  // que de simples ids à résoudre dans une liste préchargée (supprimée).
  readonly clientsAdditionnels = signal<{ id: string; nom: string }[]>([]);

  exclureAdditionnels(): string[] {
    return [this.dossier.client_id, ...this.clientsAdditionnels().map((c) => c.id)].filter(Boolean);
  }

  // Création de client à la volée (19/08/2026) — pour ne pas obliger à
  // quitter l'écran d'ouverture pour créer un client manquant, tout en
  // gardant Clients & KYC comme registre maître (le KYC complet se fait
  // là-bas, cette création inline reste minimale, statut "à faire").
  readonly creationClientCible = signal<'principal' | 'additionnel' | null>(null);
  readonly creationClientEnCours = signal(false);
  readonly erreurNouveauClient = signal('');
  // Contrôle de doublon avant création (20/08/2026) — voir clients.js.
  readonly doublonsClient = signal<any[]>([]);
  nouveauClient: any = { type: 'morale' };

  ouvrirCreationClient(cible: 'principal' | 'additionnel'): void {
    this.nouveauClient = { type: 'morale', denomination: cible === 'principal' ? this.clientNom : '' };
    this.erreurNouveauClient.set('');
    this.doublonsClient.set([]);
    this.creationClientCible.set(cible);
  }

  fermerCreationClient(): void {
    this.creationClientCible.set(null);
    this.doublonsClient.set([]);
  }

  creerClientInline(ignorerDoublon = false): void {
    const cible = this.creationClientCible();
    if (!cible) return;
    this.erreurNouveauClient.set('');
    if (!ignorerDoublon) {
      this.api.verifierDoublonClient(this.nouveauClient).subscribe({
        next: (d) => { if (d.length) this.doublonsClient.set(d); else this.creerClientInlineReellement(cible); },
        error: () => this.creerClientInlineReellement(cible),
      });
      return;
    }
    this.doublonsClient.set([]);
    this.creerClientInlineReellement(cible);
  }

  private creerClientInlineReellement(cible: 'principal' | 'additionnel'): void {
    this.creationClientEnCours.set(true);
    this.api.creerClient(this.nouveauClient).subscribe({
      next: (r) => {
        this.creationClientEnCours.set(false);
        const nom = this.nouveauClient.denomination || `${this.nouveauClient.prenom ?? ''} ${this.nouveauClient.nom ?? ''}`.trim();
        if (cible === 'principal') {
          this.dossier.client_id = r.id;
          this.nomClientPreselectionne = nom;
          this.nomClientPrincipal = nom;
        } else {
          this.clientsAdditionnels.update((liste) => [...liste, { id: r.id, nom }]);
        }
        this.suggererIntitule();
        this.creationClientCible.set(null);
      },
      error: (e) => { this.creationClientEnCours.set(false); this.erreurNouveauClient.set(e?.error?.error ?? 'Création impossible.'); },
    });
  }

  ngOnInit(): void {
    this.api.utilisateurs().subscribe({ next: (u) => this.utilisateurs.set(u) });
    this.chargerMatieres();
    this.api.listesValeurs('statut_procedure').subscribe({ next: (l) => this.statutsProcedure.set(l) });
    this.api.listesValeurs('juridiction').subscribe({ next: (l) => this.juridictions.set(l) });
  }

  partiesAdversesListe(): string[] {
    return this.partiesAdverses.split(',').map((s) => s.trim()).filter(Boolean);
  }

  ajouterClientAdditionnel(c: any): void {
    if (!c) return;
    const nom = c.denomination || `${c.prenom ?? ''} ${c.nom ?? ''}`.trim();
    this.clientsAdditionnels.update((liste) => [...liste, { id: c.id, nom }]);
    this.suggererIntitule();
  }

  retirerClientAdditionnel(id: string): void {
    this.clientsAdditionnels.update((liste) => liste.filter((x) => x.id !== id));
    this.suggererIntitule();
  }

  peutCreer(): boolean {
    const r = this.resultat();
    return !!r && (r.resultat === 'absence' || this.decisionPrise() === 'accepte');
  }

  // Nom affiché par <app-client-picker> pour le client principal quand une
  // sélection est déjà connue (pré-sélection ci-dessous, ou création à la
  // volée) — le picker n'a plus de liste préchargée dans laquelle chercher
  // ce nom lui-même.
  nomClientPreselectionne: string | null = null;

  // Pré-sélectionne le client si son nom (saisi à l'étape 1) correspond
  // exactement, à la casse près, à un client existant — recherché via
  // l'API (21/08/2026 : ne dépend plus d'une liste complète préchargée)
  // ; sinon laisse le champ vide avec l'indice affiché dans le template
  // plutôt que de deviner.
  private preselectionnerClient(): void {
    this.partiesAdversesEdit = this.partiesAdverses;
    if (this.dossier.client_id) return;
    const cible = this.clientNom.trim().toLowerCase();
    if (!cible) return;
    this.api.clients(this.clientNom.trim()).subscribe({
      next: (liste) => {
        const trouve = liste.find((c: any) => {
          const nom = (c.denomination || `${c.prenom} ${c.nom}`).trim().toLowerCase();
          return nom === cible;
        });
        if (trouve) {
          this.dossier.client_id = trouve.id;
          this.nomClientPreselectionne = trouve.denomination || `${trouve.prenom} ${trouve.nom}`;
          this.nomClientPrincipal = this.nomClientPreselectionne;
          this.suggererIntitule();
        }
      },
    });
  }

  creerDossier(): void {
    this.erreurCreation.set('');
    this.creation.set(true);
    const partiesAdverses = this.partiesAdversesEdit.split(',').map((s) => s.trim()).filter(Boolean);
    // Instance initiale : seulement pertinent en contentieux, et seulement
    // si un degré ou une juridiction a effectivement été renseigné.
    const instanceInitiale = this.dossier.pole === 'contentieux' && (this.dossier.instance_degre || this.dossier.juridiction)
      ? { degre: this.dossier.instance_degre, juridiction: this.dossier.juridiction || null }
      : undefined;
    this.api.creerDossier({
      intitule: this.intituleDossier, ...this.dossier,
      parties_adverses: partiesAdverses,
      clients_additionnels: this.clientsAdditionnels().map((c) => c.id),
      instance_initiale: instanceInitiale,
    }).subscribe({
      next: (r) => { this.creation.set(false); this.router.navigate(['/dossiers', r.id]); },
      error: (e) => { this.creation.set(false); this.erreurCreation.set(e?.error?.error ?? 'Création impossible.'); },
    });
  }

  verifier(): void {
    this.chargement.set(true);
    this.erreur.set('');
    this.resultat.set(null);
    this.decisionPrise.set(null);
    const noms = [this.clientNom, ...this.partiesAdversesListe()].filter(Boolean).join(', ');
    // intitule_projet n'est qu'un repère archivé dans conflict_checks (audit,
    // non utilisé par la recherche de conflit elle-même) — l'intitulé final
    // du dossier est désormais composé à l'Étape 2 (voir suggererIntitule()).
    this.api.conflictCheck({ intitule_projet: this.clientNom, noms }).subscribe({
      next: (r) => { this.resultat.set(r); this.chargement.set(false); this.preselectionnerClient(); },
      error: (e) => { this.chargement.set(false); this.erreur.set(e?.error?.error ?? 'Erreur lors du contrôle'); },
    });
  }

  decider(id: string, decision: string): void {
    if (!this.motif) { this.erreur.set('Le motif est obligatoire.'); return; }
    this.erreur.set('');
    this.api.decisionConflit(id, { decision, motif: this.motif }).subscribe({
      next: (r) => this.decisionPrise.set(r.decision),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Décision impossible (rôle associé requis).'),
    });
  }
}
