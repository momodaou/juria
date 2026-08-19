import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-dossier-detail',
  standalone: true,
  imports: [DatePipe, DecimalPipe, RouterLink, FormsModule],
  template: `
    <a routerLink="/dossiers" class="back">← Retour aux dossiers</a>

    @if (dossier(); as d) {
      <div class="dcard">
        <div class="dcard-top">
          <div>
            <h1>{{ d.intitule }}</h1>
            <div class="sub">{{ d.numero }} · {{ d.matiere || d.pole }} · {{ d.juridiction }}</div>
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            <span class="tag" [class.haute]="d.urgence === 'haute'">Urgence {{ d.urgence }}</span>
            <button class="btn ghost" (click)="modeEdition() ? annulerEdition() : activerEdition(d)">
              {{ modeEdition() ? 'Annuler' : 'Modifier' }}
            </button>
            @if (auth.peut('dossiers.archiver') && d.statut !== 'archive') {
              <button class="btn ghost" (click)="archiverDossier()">Archiver</button>
            }
            @if (auth.peut('dossiers.supprimer')) {
              <button class="btn ghost danger" (click)="supprimerDossier()">Supprimer</button>
            }
          </div>
        </div>
        <div class="meta">
          <div><span>Client</span><b>{{ d.client_nom }}</b></div>
          <div><span>Responsable</span><b>{{ d.responsable_nom }}</b></div>
          <div><span>Montant</span><b>{{ d.montant_litige ? (d.montant_litige | number) + ' FCFA' : '—' }}</b></div>
          <div><span>Statut</span><b>{{ d.statut }}</b></div>
          <div><span>Phase</span><b>{{ d.phase }}</b></div>
          <div><span>Mode d'honoraires</span><b>{{ d.mode_honoraires || '—' }}{{ d.pro_bono ? ' (Pro bono)' : '' }}</b></div>
        </div>
      </div>

      @if (modeEdition()) {
        <section class="panel">
          <h3>Modifier la fiche</h3>
          <div class="grid2">
            <div><label>Intitulé</label><input class="in" [(ngModel)]="edit.intitule" name="editIntitule" /></div>
            <div>
              <label>Pôle</label>
              <select class="in" [(ngModel)]="edit.pole" name="editPole">
                <option value="contentieux">Contentieux</option>
                <option value="conseil">Conseil</option>
              </select>
            </div>
            <div><label>Matière — discipline</label><input class="in" [(ngModel)]="edit.matiere" name="editMatiere" /></div>
            <div><label>Juridiction</label><input class="in" [(ngModel)]="edit.juridiction" name="editJuridiction" /></div>

            @if (edit.pole === 'contentieux') {
              <div>
                <label>Statut procédure</label>
                <select class="in" [(ngModel)]="edit.statut_procedure" name="editStatutProcedure">
                  <option value="">— Sélectionner —</option>
                  @for (s of statutsProcedure(); track s.code) { <option [value]="s.code">{{ s.libelle }}</option> }
                </select>
                @if (edit.statut_procedure === 'autre') {
                  <input class="in" [(ngModel)]="edit.statut_procedure_precision" name="editStatutProcedurePrecision" placeholder="Préciser" />
                }
              </div>
              <div><label>Montant du litige (FCFA, facultatif)</label><input class="in" type="number" [(ngModel)]="edit.montant_litige" name="editMontant" /></div>
            } @else {
              <div class="col2"><label>Cabinet ou avocat partenaire (intermédiaire, facultatif)</label><input class="in" [(ngModel)]="edit.intermediaire" name="editIntermediaire" /></div>
            }

            <div class="col2">
              <label>Nature / objet du dossier</label>
              <textarea class="in" [(ngModel)]="edit.objet" name="editObjet" rows="2"></textarea>
            </div>

            <div>
              <label>Mode d'honoraires</label>
              <select class="in" [(ngModel)]="edit.mode_honoraires" name="editModeHonoraires">
                <option value="forfait">Forfait</option>
                <option value="temps_passe">Temps passé</option>
                <option value="success_fee">Success fee</option>
                <option value="abonnement">Abonnement</option>
                <option value="consultation">Consultation</option>
              </select>
            </div>
            <div>
              <label>Urgence</label>
              <select class="in" [(ngModel)]="edit.urgence" name="editUrgence">
                <option value="basse">Basse</option>
                <option value="moyenne">Moyenne</option>
                <option value="haute">Haute</option>
              </select>
            </div>
            <div>
              <label>Phase</label>
              <select class="in" [(ngModel)]="edit.phase" name="editPhase">
                @for (p of phases; track p) { <option [value]="p">{{ p }}</option> }
              </select>
            </div>
            <div>
              <label>Statut</label>
              <select class="in" [(ngModel)]="edit.statut" name="editStatut">
                <option value="ouvert">Ouvert</option>
                <option value="en_cours">En cours</option>
                <option value="suspendu">Suspendu</option>
                <option value="clos">Clos</option>
                <option value="archive">Archivé</option>
              </select>
            </div>
            <div>
              <label>Responsable</label>
              <select class="in" [(ngModel)]="edit.responsable_id" name="editResponsable">
                @for (u of utilisateurs(); track u.id) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
              </select>
            </div>
          </div>
          <button class="btn" (click)="enregistrerDossier()" [disabled]="enregistrement()">
            {{ enregistrement() ? 'Enregistrement…' : 'Enregistrer' }}
          </button>
          @if (erreurEdition()) { <p class="err">{{ erreurEdition() }}</p> }
        </section>
      }

      @if (d.pro_bono) {
      <section class="panel">
        <h3>Honoraires — pro bono</h3>
          <div class="meta">
            <div><span>Cumul facturé</span><b>{{ d.cumul_xof | number }} FCFA</b></div>
            <div><span>Seuil applicable</span><b>{{ d.honoraires_seuil_xof | number }} FCFA (frais de procédure pro bono)</b></div>
            <div>
              <span>Statut</span>
              <b>
                <span class="tag"
                      [class.ok]="d.statut_honoraires === 'atteint'"
                      [class.attente]="d.statut_honoraires === 'sous_seuil'"
                      [class.haute]="d.statut_honoraires === 'sans_honoraires'">
                  {{ d.statut_honoraires === 'atteint' ? 'Seuil atteint' : d.statut_honoraires === 'sous_seuil' ? 'Sous le seuil' : 'Sans honoraires' }}
                </span>
              </b>
            </div>
          </div>
          @if (d.alerte_honoraires_j3 || d.alerte_honoraires_j7 || d.alerte_honoraires_j15) {
            <p class="muted" style="margin-top:8px">
              Alertes déjà déclenchées : {{ alertesDeclenchees(d) }}
            </p>
          }
      </section>
      }

      <section class="panel">
        <h3>Clients associés au dossier</h3>
        <p class="muted">Client principal : <b>{{ d.client_nom }}</b>. D'autres identités clientes (personnes physiques ou morales) peuvent être associées au même dossier.</p>
        @if (d.clients_additionnels?.length) {
          <table>
            <tr><th>Nom</th><th>Type</th><th></th></tr>
            @for (c of d.clients_additionnels; track c.id) {
              <tr>
                <td><a class="lien" [routerLink]="['/clients', c.id]">{{ c.nom }}</a></td>
                <td>{{ c.type === 'morale' ? 'Personne morale' : 'Personne physique' }}</td>
                <td>
                  @if (auth.peut('dossiers.clients_additionnels.gerer')) {
                    <button class="lien" (click)="retirerClient(c.id)">Retirer</button>
                  }
                </td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucun client supplémentaire.</p> }

        @if (auth.peut('dossiers.clients_additionnels.gerer')) {
          <div class="upload">
            <select [(ngModel)]="clientAAjouter" name="clientAAjouter">
              <option value="">Ajouter un client…</option>
              @for (c of clientsDisponibles(); track c.id) {
                <option [value]="c.id">{{ c.denomination || (c.prenom + ' ' + c.nom) }}</option>
              }
            </select>
            <button class="btn" (click)="ajouterClient()" [disabled]="!clientAAjouter">Ajouter</button>
          </div>
        }
      </section>

      @if (d.pole === 'contentieux') {
        <section class="panel">
          <h3>Instances</h3>
          <p class="muted">1re instance, appel, cassation… chaque degré garde sa propre juridiction et son n° de rôle.</p>
          @if (d.instances?.length) {
            <table>
              <tr><th>Degré</th><th>Juridiction</th><th>N° de rôle</th><th>Décision</th></tr>
              @for (i of d.instances; track i.id) {
                <tr>
                  <td>{{ libelleDegre(i.degre) }}</td>
                  <td>{{ i.juridiction || '—' }}</td>
                  <td>{{ i.numero_role || '—' }}</td>
                  <td>{{ i.decision || '—' }}</td>
                </tr>
              }
            </table>
          } @else { <p class="muted">Aucune instance enregistrée.</p> }

          @if (auth.peut('dossiers.instances.gerer')) {
            <div class="grid2" style="margin-top:12px">
              <div>
                <label>Degré</label>
                <select class="in" [(ngModel)]="nouvelleInstance.degre" name="niDegre">
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
                <label>Juridiction</label>
                <select class="in" [(ngModel)]="nouvelleInstance.juridiction" name="niJuridiction">
                  <option value="">— Sélectionner —</option>
                  @for (j of juridictions(); track j.code) { <option [value]="j.libelle">{{ j.libelle }}</option> }
                </select>
              </div>
              <div><label>N° de rôle (facultatif)</label><input class="in" [(ngModel)]="nouvelleInstance.numero_role" name="niNumeroRole" /></div>
            </div>
            <button class="btn" (click)="ajouterInstance()" [disabled]="ajoutInstanceEnCours()">
              {{ ajoutInstanceEnCours() ? 'Ajout…' : '+ Ajouter cette instance' }}
            </button>
            @if (erreurInstance()) { <p class="err">{{ erreurInstance() }}</p> }
          }
        </section>
      }

      <section class="panel">
        <h3>Parties adverses</h3>
        @if (d.parties?.length) {
          <table>
            <tr><th>Rôle</th><th>Dénomination</th><th>Conseil</th></tr>
            @for (p of d.parties; track p.id) {
              <tr><td>{{ p.role }}</td><td>{{ p.denomination }}</td><td>{{ p.conseil || '—' }}</td></tr>
            }
          </table>
        } @else { <p class="muted">Aucune partie enregistrée.</p> }
      </section>

      <section class="panel">
        <h3>Délais & audiences</h3>
        <div class="upload">
          <select [(ngModel)]="dType" name="dtype" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px">
            <option value="audience">Audience</option>
            <option value="delai_procedure">Délai de procédure</option>
            <option value="delai_recours">Délai de recours</option>
            <option value="depot">Dépôt</option>
            <option value="prescription">Prescription</option>
          </select>
          <input [(ngModel)]="dTitre" name="dtitre" placeholder="Intitulé" style="flex:1;min-width:150px">
          <input type="date" [(ngModel)]="dDate" name="ddate">
          <button class="btn" (click)="ajouterDelai()" [disabled]="!dDate">Ajouter</button>
        </div>
        @if (evenements().length) {
          <table>
            <tr><th>Type</th><th>Intitulé</th><th>Échéance</th><th>Jours</th></tr>
            @for (e of evenements(); track e.id) {
              <tr>
                <td>{{ e.type }}</td><td>{{ e.titre }}</td>
                <td>{{ e.date_echeance | date:'dd/MM/yyyy' }}</td>
                <td><span class="tag" [class.haute]="e.jours_restants <= 7">J-{{ e.jours_restants }}</span></td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucun délai enregistré.</p> }
      </section>

      <section class="panel">
        <h3>Pièces (GED)</h3>

        <div class="upload">
          <input type="file" (change)="fichierChoisi($event)" />
          <select [(ngModel)]="categorie" name="categorie">
            <option value="piece_client">Pièce client</option>
            <option value="correspondance">Correspondance</option>
            <option value="contrat">Contrat</option>
            <option value="conclusions">Conclusions</option>
            <option value="decision">Décision</option>
            <option value="note_interne">Note interne</option>
            <option value="autre">Autre</option>
          </select>
          <button class="btn" (click)="televerser()" [disabled]="!fichier() || envoi()">
            {{ envoi() ? 'Envoi…' : 'Téléverser' }}
          </button>
        </div>

        @if (documents().length) {
          <table>
            <tr><th>Nom</th><th>Catégorie</th><th>Version</th><th>Statut</th><th></th></tr>
            @for (doc of documents(); track doc.id) {
              <tr>
                <td>{{ doc.nom }}</td><td>{{ doc.categorie }}</td>
                <td>v{{ doc.version }}</td><td>{{ doc.statut }}</td>
                <td><button class="lien" (click)="ouvrir(doc)">Ouvrir</button></td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucune pièce.</p> }
      </section>

      <section class="panel">
        <h3>Temps passé</h3>
        <div class="upload">
          <input type="number" placeholder="Durée (min)" [(ngModel)]="dureeMin" name="duree" style="width:130px" />
          <input type="text" placeholder="Description" [(ngModel)]="descTemps" name="desc" style="flex:1;min-width:180px" />
          <button class="btn" (click)="ajouterTemps()" [disabled]="!dureeMin">Ajouter</button>
        </div>
        @if (temps().length) {
          <table>
            <tr><th>Date</th><th>Durée</th><th>Facturable</th><th>Description</th></tr>
            @for (t of temps(); track t.id) {
              <tr>
                <td>{{ t.date_saisie | date:'dd/MM/yyyy' }}</td>
                <td>{{ (t.duree_minutes / 60) | number:'1.1-1' }} h</td>
                <td>{{ t.facturable ? 'Oui' : 'Non' }}</td>
                <td>{{ t.description || '—' }}</td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucun temps saisi.</p> }
      </section>

      <section class="panel">
        <h3>Fil du dossier — communications</h3>
        <div class="upload">
          <select [(ngModel)]="cType" name="ctype" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px">
            <option value="email">E-mail</option>
            <option value="courrier">Courrier</option>
            <option value="appel">Appel</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="reunion">Réunion / CR d'audience</option>
            <option value="note">Note</option>
          </select>
          <input [(ngModel)]="cSujet" name="csujet" placeholder="Sujet" style="min-width:150px">
          <input [(ngModel)]="cResume" name="cresume" placeholder="Résumé" style="flex:1;min-width:180px">
          <button class="btn" (click)="ajouterComm()" [disabled]="!cSujet">Enregistrer</button>
        </div>
        @if (communications().length) {
          <table>
            <tr><th>Date</th><th>Type</th><th>Sujet</th><th>Résumé</th></tr>
            @for (c of communications(); track c.id) {
              <tr>
                <td>{{ c.date_comm | date:'dd/MM/yyyy' }}</td>
                <td>{{ c.type }}</td><td>{{ c.sujet }}</td><td>{{ c.resume || '—' }}</td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucune communication enregistrée.</p> }
      </section>

      <section class="panel">
        <h3>Assistant IA <span class="ia-tag">projet à valider</span></h3>
        <p class="muted" style="margin-bottom:8px">Un appui, jamais une décision : toute production doit être validée par l'avocat.</p>
        <textarea [(ngModel)]="iaTexte" name="iatexte" rows="4"
          placeholder="Collez ici le texte d'une pièce à résumer…"
          style="width:100%;border:1px solid var(--line);border-radius:8px;padding:10px;font-size:13px;font-family:inherit"></textarea>
        <div class="upload" style="margin-top:8px">
          <button class="btn" (click)="iaResumer()" [disabled]="iaEnCours() || !iaTexte">Résumer (IA)</button>
          <button class="btn" style="background:#fff;border:1px solid var(--line);color:var(--slate)" (click)="iaChrono()" [disabled]="iaEnCours()">Chronologie du dossier (IA)</button>
        </div>
        @if (iaEnCours()) { <p class="muted" style="margin-top:10px">Génération en cours…</p> }
        @if (iaOut()) {
          <div style="margin-top:12px;background:#fffaf0;border:1px solid #f0dcae;border-radius:10px;padding:14px 16px">
            <b style="color:#8a6412">Assistant IA — projet à valider</b>
            <p style="white-space:pre-wrap;font-size:13px;margin-top:6px">{{ iaOut() }}</p>
          </div>
        }
      </section>
    } @else if (erreur()) {
      <p class="err">{{ erreur() }}</p>
    } @else {
      <p class="muted">Chargement…</p>
    }
  `,
  styles: [`
    .upload{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
    .upload select{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer}
    .btn.ghost{background:#fff;border:1px solid var(--line);color:var(--slate)}
    .btn.ghost.danger{color:var(--red);border-color:#f0c8c5}
    .btn:disabled{opacity:.6}
    .lien{background:none;border:none;color:var(--gold);cursor:pointer;font-size:13px;padding:0}
    .ia-tag{background:#eef;border:1px solid #d5d9f5;color:#43489a;border-radius:12px;padding:2px 9px;font-size:11px;font-weight:600;margin-left:8px}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    .tag.attente{background:#fbf1dc;color:#9a6c12}
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:14px}
    label{font-size:12px;color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
    .col2{grid-column:1 / -1}
    textarea.in{font-family:inherit;resize:vertical}
  `],
})
export class DossierDetailComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  private id = '';
  readonly dossier = signal<any | null>(null);
  readonly evenements = signal<any[]>([]);
  readonly documents = signal<any[]>([]);
  readonly erreur = signal('');

  readonly fichier = signal<File | null>(null);
  readonly envoi = signal(false);
  categorie = 'piece_client';

  readonly temps = signal<any[]>([]);
  dureeMin: number | null = null;
  descTemps = '';

  readonly communications = signal<any[]>([]);
  dType = 'audience'; dTitre = ''; dDate = '';
  cType = 'email'; cSujet = ''; cResume = '';

  iaTexte = '';
  readonly iaOut = signal('');
  readonly iaEnCours = signal(false);

  // Édition de la fiche (ajout 18/08/2026) — PUT /api/dossiers/:id
  // n'existait pas du tout jusqu'ici (gap signalé par l'utilisateur).
  // Même patron que le verrou optimiste déjà utilisé côté clients
  // (maj_le_attendu), pour rester cohérent entre les deux écrans.
  readonly modeEdition = signal(false);
  readonly enregistrement = signal(false);
  readonly erreurEdition = signal('');
  readonly utilisateurs = signal<any[]>([]);
  edit: any = {};
  readonly phases = ['consultation', 'ouverture', 'mise_en_etat', 'plaidoirie', 'decision', 'execution', 'recours', 'cloture'];
  // Statut procédure (19/08/2026) — liste_valeurs déjà utilisée à la
  // création (ouverture.component.ts), reprise ici pour l'édition.
  readonly statutsProcedure = signal<{ code: string; libelle: string }[]>([]);

  // Instances (19/08/2026) — 1re instance/appel/cassation… Table déjà en
  // base mais jamais branchée avant ce jour (voir plan de la session).
  readonly juridictions = signal<{ code: string; libelle: string }[]>([]);
  readonly ajoutInstanceEnCours = signal(false);
  readonly erreurInstance = signal('');
  nouvelleInstance: any = { degre: 'premiere_instance', juridiction: '' };

  // Clients additionnels (ajout 18/08/2026) — un dossier peut désormais
  // comporter plusieurs identités clientes.
  readonly clients = signal<any[]>([]);
  clientAAjouter = '';

  clientsDisponibles(): any[] {
    const d = this.dossier();
    if (!d) return [];
    const dejaLies = new Set([d.client_id, ...(d.clients_additionnels || []).map((c: any) => c.id)]);
    return this.clients().filter((c) => !dejaLies.has(c.id));
  }

  ajouterClient(): void {
    if (!this.clientAAjouter) return;
    this.api.ajouterClientDossier(this.id, this.clientAAjouter).subscribe({
      next: () => { this.clientAAjouter = ''; this.api.dossier(this.id).subscribe({ next: (d) => this.dossier.set(d) }); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Ajout impossible.'),
    });
  }

  private readonly libellesDegre: Record<string, string> = {
    premiere_instance: 'Première instance', appel: 'Appel', cassation: 'Cassation (dont CCJA)',
    opposition: 'Opposition', refere: 'Référé', execution: 'Exécution', autre: 'Autre',
  };
  libelleDegre(degre: string): string { return this.libellesDegre[degre] ?? degre; }

  ajouterInstance(): void {
    this.erreurInstance.set('');
    this.ajoutInstanceEnCours.set(true);
    this.api.ajouterInstance(this.id, this.nouvelleInstance).subscribe({
      next: () => {
        this.ajoutInstanceEnCours.set(false);
        this.nouvelleInstance = { degre: 'premiere_instance', juridiction: '' };
        this.api.dossier(this.id).subscribe({ next: (d) => this.dossier.set(d) });
      },
      error: (e) => { this.ajoutInstanceEnCours.set(false); this.erreurInstance.set(e?.error?.error ?? 'Ajout impossible.'); },
    });
  }

  retirerClient(clientId: string): void {
    this.api.retirerClientDossier(this.id, clientId).subscribe({
      next: () => this.api.dossier(this.id).subscribe({ next: (d) => this.dossier.set(d) }),
    });
  }

  archiverDossier(): void {
    if (!window.confirm('Archiver ce dossier ?')) return;
    this.api.majDossier(this.id, { statut: 'archive', maj_le_attendu: this.dossier()?.maj_le }).subscribe({
      next: () => this.api.dossier(this.id).subscribe({ next: (d) => this.dossier.set(d) }),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Archivage impossible.'),
    });
  }

  supprimerDossier(): void {
    if (!window.confirm('Supprimer définitivement ce dossier ? Impossible si une activité (facture, document, temps…) est déjà enregistrée.')) return;
    this.api.supprimerDossier(this.id).subscribe({
      next: () => this.router.navigate(['/dossiers']),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Suppression impossible.'),
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.id = id;
    this.api.dossier(id).subscribe({
      next: (d) => this.dossier.set(d),
      error: () => this.erreur.set('Dossier introuvable.'),
    });
    this.api.utilisateurs().subscribe({ next: (u) => this.utilisateurs.set(u) });
    this.api.clients().subscribe({ next: (c) => this.clients.set(c) });
    this.api.listesValeurs('statut_procedure').subscribe({ next: (l) => this.statutsProcedure.set(l) });
    this.api.listesValeurs('juridiction').subscribe({ next: (l) => this.juridictions.set(l) });
    this.rafraichirDelais();
    this.rafraichirDocuments();
    this.rafraichirTemps();
    this.rafraichirComms();
  }

  activerEdition(d: any): void {
    this.edit = {
      intitule: d.intitule, pole: d.pole, matiere: d.matiere, juridiction: d.juridiction,
      montant_litige: d.montant_litige, mode_honoraires: d.mode_honoraires,
      urgence: d.urgence, phase: d.phase, statut: d.statut, responsable_id: d.responsable_id,
      objet: d.objet, statut_procedure: d.statut_procedure, statut_procedure_precision: d.statut_procedure_precision,
      intermediaire: d.intermediaire,
    };
    this.erreurEdition.set('');
    this.modeEdition.set(true);
  }

  annulerEdition(): void {
    this.modeEdition.set(false);
  }

  enregistrerDossier(): void {
    this.erreurEdition.set('');
    this.enregistrement.set(true);
    this.api.majDossier(this.id, { ...this.edit, maj_le_attendu: this.dossier()?.maj_le }).subscribe({
      next: () => {
        this.enregistrement.set(false);
        this.modeEdition.set(false);
        this.api.dossier(this.id).subscribe({ next: (d) => this.dossier.set(d) });
      },
      error: (e) => {
        this.enregistrement.set(false);
        if (e?.status === 409) {
          this.erreurEdition.set('Ce dossier a été modifié entre-temps — rechargement...');
          this.api.dossier(this.id).subscribe({ next: (d) => this.dossier.set(d) });
        } else {
          this.erreurEdition.set(e?.error?.error ?? 'Enregistrement impossible.');
        }
      },
    });
  }

  alertesDeclenchees(d: any): string {
    return [d.alerte_honoraires_j3 && 'J+3', d.alerte_honoraires_j7 && 'J+7', d.alerte_honoraires_j15 && 'J+15']
      .filter((x) => x)
      .join(', ');
  }

  private rafraichirDelais(): void {
    this.api.dossierEvenements(this.id).subscribe({ next: (e) => this.evenements.set(e), error: () => {} });
  }
  ajouterDelai(): void {
    if (!this.dDate) return;
    this.api.creerEvenement({ dossier_id: this.id, type: this.dType, titre: this.dTitre, date_echeance: this.dDate }).subscribe({
      next: () => { this.dTitre = ''; this.dDate = ''; this.rafraichirDelais(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Ajout impossible'),
    });
  }

  private rafraichirComms(): void {
    this.api.dossierCommunications(this.id).subscribe({ next: (c) => this.communications.set(c), error: () => {} });
  }
  ajouterComm(): void {
    if (!this.cSujet) return;
    this.api.creerCommunication({ dossier_id: this.id, type: this.cType, sujet: this.cSujet, resume: this.cResume }).subscribe({
      next: () => { this.cSujet = ''; this.cResume = ''; this.rafraichirComms(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Enregistrement impossible'),
    });
  }

  iaResumer(): void {
    if (!this.iaTexte) return;
    this.iaEnCours.set(true); this.iaOut.set('');
    this.api.iaResume({ texte: this.iaTexte }).subscribe({
      next: (r) => { this.iaOut.set(r.resume); this.iaEnCours.set(false); },
      error: (e) => { this.iaEnCours.set(false); this.iaOut.set(e?.error?.error ?? 'Service IA indisponible.'); },
    });
  }

  iaChrono(): void {
    this.iaEnCours.set(true); this.iaOut.set('');
    const payload = this.iaTexte ? { texte: this.iaTexte } : { dossier_id: this.id };
    this.api.iaChronologie(payload).subscribe({
      next: (r) => { this.iaOut.set(r.chronologie); this.iaEnCours.set(false); },
      error: (e) => { this.iaEnCours.set(false); this.iaOut.set(e?.error?.error ?? 'Service IA indisponible.'); },
    });
  }

  private rafraichirTemps(): void {
    this.api.tempsDossier(this.id).subscribe({ next: (t) => this.temps.set(t), error: () => {} });
  }

  ajouterTemps(): void {
    if (!this.dureeMin) return;
    this.api.creerTemps({ dossier_id: this.id, duree_minutes: this.dureeMin, description: this.descTemps }).subscribe({
      next: () => { this.dureeMin = null; this.descTemps = ''; this.rafraichirTemps(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Saisie impossible'),
    });
  }

  private rafraichirDocuments(): void {
    this.api.dossierDocuments(this.id).subscribe({ next: (d) => this.documents.set(d), error: () => {} });
  }

  fichierChoisi(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.fichier.set(input.files && input.files.length ? input.files[0] : null);
  }

  televerser(): void {
    const f = this.fichier();
    if (!f) return;
    this.envoi.set(true);
    this.api.televerserDocument(this.id, f, { categorie: this.categorie }).subscribe({
      next: () => { this.envoi.set(false); this.fichier.set(null); this.rafraichirDocuments(); },
      error: (e) => { this.envoi.set(false); this.erreur.set(e?.error?.error ?? 'Téléversement impossible'); },
    });
  }

  ouvrir(doc: any): void {
    this.api.telechargerDocument(doc.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      error: () => this.erreur.set('Téléchargement impossible'),
    });
  }
}
