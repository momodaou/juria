import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MenuActionsComponent, ActionMenuItem } from '../../core/menu-actions.component';
import { libelleRole } from '../../core/roles';

@Component({
  selector: 'app-cabinet',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, MenuActionsComponent],
  template: `
    <header class="page-head">
      <div>
        <h1>Administratif &amp; RH</h1>
        <p>Équipe, charge de travail, congés, pointage, échéances RH, obligations administratives.</p>
      </div>
    </header>

    @if (echeances().length) {
      <section class="panel alerte">
        <h3>⚠ Échéances RH à venir</h3>
        <table>
          <tr><th>Membre</th><th>Type</th><th>Échéance</th><th>Jours</th></tr>
          @for (e of echeances(); track e.utilisateur_id + e.type_echeance) {
            <tr>
              <td>{{ e.prenom }} {{ e.nom }}</td>
              <td>{{ libelleEcheance(e.type_echeance) }}</td>
              <td>{{ e.echeance | date:'dd/MM/yyyy' }}</td>
              <td><span class="tag" [class.haute]="e.jours_restants <= 7">{{ e.jours_restants < 0 ? 'dépassé' : 'J-' + e.jours_restants }}</span></td>
            </tr>
          }
        </table>
      </section>
    }

    <section class="panel">
      <h3>Équipe</h3>
      <table>
        <tr><th>Membre</th><th>Rôle</th><th>Dossiers actifs</th><th>Heures ce mois</th></tr>
        @for (m of equipe(); track m.id) {
          <tr>
            <td>{{ m.prenom }} {{ m.nom }}</td>
            <td>{{ libelleRole(m.role) }}</td>
            <td>{{ m.dossiers_actifs }}</td>
            <td>{{ m.heures_mois | number }} h</td>
          </tr>
        }
      </table>
    </section>

    <section class="panel">
      <h3>{{ estSoiMemeVue() ? 'Mon pointage' : 'Pointage — ' + nomMembre(pointageMembreId()) }}
        — {{ presences()?.total_heures ?? 0 }} h ({{ presences()?.jours_pointes ?? 0 }} jour(s) pointé(s))</h3>
      <div class="upload">
        @if (auth.peut('cabinet.consulter')) {
          <select class="sel" [ngModel]="pointageMembreId()" (ngModelChange)="changerMembrePointage($event)" name="pointMembre" title="Voir le pointage de…">
            <option value="">Moi-même</option>
            @for (m of membres(); track m.id) { <option [value]="m.id">{{ m.prenom }} {{ m.nom }}</option> }
          </select>
        }
        <select class="sel" [ngModel]="periodeType()" (ngModelChange)="changerPeriodeType($event)" name="periodeType" title="Période">
          <option value="mois">Par mois</option>
          <option value="semaine">Par semaine</option>
        </select>
        @if (periodeType() === 'mois') {
          <input class="sel" type="month" [ngModel]="periodeMois" (ngModelChange)="changerPeriodeMois($event)" name="periodeMoisSel" />
        } @else {
          <input class="sel" type="week" [ngModel]="periodeSemaine" (ngModelChange)="changerPeriodeSemaine($event)" name="periodeSemaineSel" />
        }
      </div>
      @if (presences()?.debut) {
        <p class="muted">Période affichée : du {{ presences().debut | date:'dd/MM/yyyy' }} au {{ presences().fin | date:'dd/MM/yyyy' }}.</p>
      }
      @if (!estSoiMemeVue()) {
        <p class="muted">Lecture seule — seul le titulaire peut pointer ou corriger son propre pointage.</p>
      } @else if (auth.peut('cabinet.presence.pointer')) {
        <div class="upload">
          <input class="sel" type="date" [(ngModel)]="pointageDate" name="pdate" [max]="aujourdhui" title="Jour pointé" />
          <input class="sel" type="time" [(ngModel)]="pointageArrivee" name="arr" placeholder="Arrivée" />
          <input class="sel" type="time" [(ngModel)]="pointageDepart" name="dep" placeholder="Départ" />
          <button class="btn sm" (click)="enregistrerPointage()">{{ pointageCorrection ? 'Enregistrer la correction' : 'Enregistrer' }}</button>
          @if (pointageCorrection) { <button class="lien" (click)="reinitialiserPointage()">Annuler</button> }
        </div>
        @if (pointageCorrection) { <p class="muted">Correction du {{ pointageDate | date:'dd/MM/yyyy' }} : les heures saisies remplacent celles du jour.</p> }
        @if (erreurPointage()) { <p class="err">{{ erreurPointage() }}</p> }
      }
      @if (presences()?.jours?.length) {
        <table>
          <tr><th>Date</th><th>Arrivée</th><th>Départ</th><th>Heures</th><th></th></tr>
          @for (j of presences().jours; track j.date_jour) {
            <tr>
              <td>{{ j.date_jour | date:'dd/MM/yyyy' }}</td><td>{{ heure(j.heure_arrivee) }}</td><td>{{ heure(j.heure_depart) }}</td><td>{{ j.heures || '—' }}</td>
              <td><app-menu-actions [actions]="actionsPourPointage(j)" /></td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucun pointage sur cette période.</p> }
    </section>

    <section class="panel">
      <h3>Congés</h3>
      @if (auth.peut('cabinet.conge.demander')) {
        <div class="upload">
          <select class="sel" [(ngModel)]="nouveauConge.type" name="typeConge">
            <option value="annuel">Annuel</option><option value="maladie">Maladie</option>
            <option value="maternite">Maternité</option><option value="paternite">Paternité</option>
            <option value="sans_solde">Sans solde</option><option value="autre">Autre</option>
          </select>
          <input class="sel" type="date" [(ngModel)]="nouveauConge.date_debut" name="debut" />
          <input class="sel" type="date" [(ngModel)]="nouveauConge.date_fin" name="fin" />
          <button class="btn sm" (click)="demander()" [disabled]="!nouveauConge.date_debut || !nouveauConge.date_fin || ajoutCongeEnCours()">{{ ajoutCongeEnCours() ? 'Envoi…' : 'Demander' }}</button>
        </div>
        @if (doublonsConge().length) {
          <div class="doublon">
            <b>⚠ Une demande existe déjà pour ces dates :</b>
            @for (d of doublonsConge(); track d.id) { <p>{{ d.type }} — {{ d.date_debut | date:'dd/MM/yyyy' }} au {{ d.date_fin | date:'dd/MM/yyyy' }} ({{ d.statut }})</p> }
            <div class="btns">
              <button class="btn ghost" (click)="doublonsConge.set([])">Annuler, je vérifie</button>
              <button class="btn" (click)="demanderQuandMeme()" [disabled]="ajoutCongeEnCours()">Demander quand même</button>
            </div>
          </div>
        }
      }
      @if (conges().length) {
        <table>
          <tr><th>Membre</th><th>Type</th><th>Du</th><th>Au</th><th>Statut</th><th></th></tr>
          @for (c of conges(); track c.id) {
            <tr>
              <td>{{ c.membre }}</td><td>{{ libelleTypeConge(c.type) }}</td>
              <td>{{ c.date_debut | date:'dd/MM/yyyy' }}</td><td>{{ c.date_fin | date:'dd/MM/yyyy' }}</td>
              <td><span class="tag" [class.ok]="c.statut==='approuve'" [class.haute]="c.statut==='refuse'">{{ c.statut === 'annule' ? 'annulé' : c.statut }}</span></td>
              <td><app-menu-actions [actions]="actionsPourConge(c)" /></td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucune demande.</p> }
      @if (erreurConge()) { <p class="err">{{ erreurConge() }}</p> }
    </section>

    @if (auth.peut('echeances_admin.consulter')) {
      <section class="panel">
        <h3>Obligations administratives du cabinet</h3>
        <p class="muted" style="margin-bottom:12px">Échéances fiscales, sociales et ordinales récurrentes (TVA, INPS, ITS, IS, patente, Ordre, assurance…), sans rattachement à un dossier ni un client — distinct des « Échéances RH » ci-dessus, qui concernent chaque membre individuellement.</p>
        @if (auth.peut('echeances_admin.gerer')) {
          <div class="upload">
            @if (eaEnEditionId()) { <span class="tag">Modification en cours</span> }
            <select class="sel" [(ngModel)]="eaCategorie" name="eac">
              @for (c of categoriesEcheanceAdmin(); track c.code) { <option [value]="c.code">{{ c.libelle }}</option> }
            </select>
            <input class="sel" [(ngModel)]="eaLibelle" name="eal" placeholder="Libellé (ex. Renouvellement assurance RC pro)" style="flex:1;min-width:200px" />
            <select class="sel" [(ngModel)]="eaPeriodicite" name="eap">
              @for (p of periodicitesEcheanceAdmin(); track p.code) { <option [value]="p.code">{{ p.libelle }}</option> }
            </select>
            <input class="sel" type="date" [(ngModel)]="eaDate" name="ead" />
            @if (eaEnEditionId()) {
              <button class="btn sm" (click)="enregistrerModificationEcheanceAdmin()" [disabled]="!eaLibelle || !eaDate">Enregistrer</button>
              <button class="lien" (click)="annulerEditionEcheanceAdmin()">Annuler</button>
            } @else {
              <button class="btn sm" (click)="ajouterEcheanceAdmin()" [disabled]="!eaLibelle || !eaDate || ajoutEcheanceAdminEnCours()">{{ ajoutEcheanceAdminEnCours() ? 'Ajout…' : 'Ajouter' }}</button>
            }
          </div>
          @if (doublonsEcheanceAdmin().length) {
            <div class="doublon">
              <b>⚠ Une échéance très proche existe déjà :</b>
              @for (d of doublonsEcheanceAdmin(); track d.id) { <p>{{ d.libelle }} — {{ d.categorie }} — prochaine le {{ d.prochaine_date | date:'dd/MM/yyyy' }}</p> }
              <div class="btns">
                <button class="btn ghost" (click)="doublonsEcheanceAdmin.set([])">Annuler, je vérifie</button>
                <button class="btn" (click)="ajouterEcheanceAdminQuandMeme()" [disabled]="ajoutEcheanceAdminEnCours()">Ajouter quand même</button>
              </div>
            </div>
          }
          @if (erreurEcheanceAdmin()) { <p class="err">{{ erreurEcheanceAdmin() }}</p> }
        }
        @if (echeancesAdmin().length) {
          <table>
            <tr><th>Échéance</th><th>Catégorie</th><th>Libellé</th><th>Périodicité</th><th>Payé</th><th>Alerte</th><th></th></tr>
            @for (e of echeancesAdmin(); track e.id) {
              <tr>
                <td>{{ e.prochaine_date | date:'dd/MM/yyyy' }}</td>
                <td>{{ libelleCategorieEcheanceAdmin(e.categorie) }}</td>
                <td>{{ e.libelle }}</td>
                <td>{{ libellePeriodiciteEcheanceAdmin(e.periodicite) }}</td>
                <td>@if (e.depense_montant) { {{ e.depense_montant | number }} FCFA } @else { — }</td>
                <td><span class="tag" [class.haute]="e.jours_restants <= 7">{{ e.jours_restants < 0 ? 'dépassé' : 'J-' + e.jours_restants }}</span></td>
                <td><app-menu-actions [actions]="actionsPourEcheanceAdmin(e)" /></td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucune échéance administrative enregistrée.</p> }
      </section>
    }

    <section class="panel">
      <h3>Bulletins de paie (option légère — archivage indicatif)
        — {{ bulletinMembreId() ? nomMembre(bulletinMembreId()) : 'les miens' }}</h3>
      @if (auth.peut('cabinet.bulletins.consulter')) {
        <div class="upload">
          <select class="sel" [ngModel]="bulletinMembreId()" (ngModelChange)="changerMembreBulletin($event)" name="bulVoir" title="Voir les bulletins de…">
            <option value="">Moi-même</option>
            @for (m of membres(); track m.id) { <option [value]="m.id">{{ m.prenom }} {{ m.nom }}</option> }
          </select>
        </div>
      }
      @if (bulletins().length) {
        <table>
          <tr><th>Mois</th><th>Brut</th><th>Net</th><th>Primes</th><th>Versé le</th></tr>
          @for (b of bulletins(); track b.id) {
            <tr>
              <td>{{ b.mois | date:'MM/yyyy' }}</td>
              <td>@if (b.salaire_brut) { {{ b.salaire_brut | number }} FCFA } @else { — }</td>
              <td>@if (b.salaire_net) { {{ b.salaire_net | number }} FCFA } @else { — }</td>
              <td>@if (b.primes) { {{ b.primes | number }} FCFA } @else { — }</td>
              <td>{{ b.verse_le ? (b.verse_le | date:'dd/MM/yyyy') : '—' }}</td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucun bulletin archivé.</p> }

      @if (auth.peut('cabinet.bulletin.generer')) {
        <h4 style="margin:18px 0 10px">Archiver un bulletin</h4>
        <div class="upload">
          <select class="sel" [(ngModel)]="nouveauBulletin.utilisateur_id" name="bulUser">
            <option value="">Membre…</option>
            @for (m of membres(); track m.id) { <option [value]="m.id">{{ m.prenom }} {{ m.nom }}</option> }
          </select>
          <input class="sel" type="date" [(ngModel)]="nouveauBulletin.mois" name="bulMois" />
          <input class="sel" type="number" [(ngModel)]="nouveauBulletin.salaire_brut" name="bulBrut" placeholder="Brut" />
          <input class="sel" type="number" [(ngModel)]="nouveauBulletin.salaire_net" name="bulNet" placeholder="Net" />
          <button class="btn sm" (click)="archiverBulletin()" [disabled]="!nouveauBulletin.utilisateur_id || ajoutBulletinEnCours()">{{ ajoutBulletinEnCours() ? 'Archivage…' : 'Archiver' }}</button>
        </div>
        @if (erreurBulletin()) { <p class="err">{{ erreurBulletin() }}</p> }
      }
    </section>
  `,
  styles: [`
    /* 26/09/2026 — audit doublons, même style que clients.component.ts. */
    .doublon{background:#fffaf0;border:1px solid #f0dcae;border-radius:10px;padding:14px 16px;margin-bottom:14px}
    .doublon p{margin:4px 0;font-size:var(--fs-base)}
    .doublon .btns{display:flex;gap:8px;margin-top:10px}
    .sel{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:var(--fs-base)}
    .upload{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
    .btn.sm{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer;font-size:var(--fs-base)}
    .btn.sm:disabled{opacity:.6}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    .tag.haute{background:#fbe6e5;color:#b13a36}
    .panel.alerte{border-left:4px solid var(--amber)}
  `],
})
export class CabinetComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly libelleRole = libelleRole;
  readonly equipe = signal<any[]>([]);
  // Annuaire complet (GET /api/utilisateurs, ouvert à tout le monde) — pour
  // les sélecteurs "voir/attribuer à un membre" ci-dessous (27/09/2026).
  // Volontairement DISTINCT de `equipe` (gardée par cabinet.consulter,
  // expose le taux horaire) : un rôle qui peut générer un bulletin ou voir
  // le pointage d'autrui n'a pas forcément aussi la vue de supervision
  // d'équipe — bug trouvé en auditant ce module (admin_it, par exemple, a
  // cabinet.bulletin.generer mais pas cabinet.consulter : le sélecteur
  // "Membre…" du formulaire d'archivage était silencieusement vide).
  readonly membres = signal<any[]>([]);
  readonly echeances = signal<any[]>([]);
  readonly conges = signal<any[]>([]);
  readonly presences = signal<any>(null);

  pointageArrivee = '';
  pointageDepart = '';
  // Pointage d'un autre jour / correction (25/09/2026).
  readonly aujourdhui = new Date().toISOString().slice(0, 10);
  pointageDate = this.aujourdhui;
  pointageCorrection = false;
  readonly erreurPointage = signal('');
  readonly erreurConge = signal('');
  // 26/09/2026 — audit doublons : garde anti-double-clic + avertissement de
  // ressaisie (même patron que clients.component.ts).
  readonly ajoutCongeEnCours = signal(false);
  readonly doublonsConge = signal<any[]>([]);
  nouveauConge: any = { type: 'annuel' };
  nouveauBulletin: any = { mois: new Date().toISOString().slice(0, 8) + '01' };

  // Consultation du pointage/des bulletins d'un autre membre (27/09/2026,
  // audit Cabinet demandé par l'utilisateur — voir CLAUDE.md/HISTORY.md).
  readonly pointageMembreId = signal('');
  readonly periodeType = signal<'mois' | 'semaine'>('mois');
  periodeMois = new Date().toISOString().slice(0, 7);
  periodeSemaine = this.semaineISO(new Date());
  readonly bulletins = signal<any[]>([]);
  readonly bulletinMembreId = signal('');
  readonly erreurBulletin = signal('');
  readonly ajoutBulletinEnCours = signal(false);

  // Obligations administratives du cabinet (12/09/2026, déplacées
  // d'Échéances vers Cabinet — voir CLAUDE.md/HISTORY.md : la consultation
  // était ouverte à quasiment tout le cabinet, ces obligations relèvent de
  // la direction/comptabilité comme le reste de ce module).
  readonly echeancesAdmin = signal<any[]>([]);
  readonly categoriesEcheanceAdmin = signal<{ code: string; libelle: string }[]>([]);
  readonly periodicitesEcheanceAdmin = signal<{ code: string; libelle: string }[]>([]);
  readonly erreurEcheanceAdmin = signal('');
  readonly ajoutEcheanceAdminEnCours = signal(false);
  readonly doublonsEcheanceAdmin = signal<any[]>([]);
  eaCategorie = 'fiscale'; eaLibelle = ''; eaPeriodicite = 'ponctuelle'; eaDate = '';
  // Le même formulaire sert à la création ET à la modification (pas de 2e
  // formulaire dupliqué) : non-null quand une ligne est en cours d'édition.
  readonly eaEnEditionId = signal<string | null>(null);

  private readonly libellesEcheance: Record<string, string> = {
    fin_essai: "Fin de période d'essai", fin_contrat: 'Fin de contrat', visite_medicale: 'Visite médicale',
  };
  libelleEcheance(t: string): string { return this.libellesEcheance[t] ?? t; }

  private readonly libellesTypeConge: Record<string, string> = {
    annuel: 'Annuel', maladie: 'Maladie', maternite: 'Maternité', paternite: 'Paternité',
    sans_solde: 'Sans solde', autre: 'Autre',
  };
  libelleTypeConge(t: string): string { return this.libellesTypeConge[t] ?? t; }

  nomMembre(id: string): string {
    const m = this.membres().find((x) => x.id === id);
    return m ? `${m.prenom} ${m.nom}` : '';
  }

  ngOnInit(): void {
    // Ouvert à tout le monde (GET /api/utilisateurs, aucune permission
    // requise) — voir le commentaire sur `membres` ci-dessus.
    this.api.utilisateurs().subscribe({ next: (u) => this.membres.set(u), error: () => {} });
    // error: () => {} (27/09/2026) — ces deux appels sont gardés par
    // cabinet.consulter côté serveur (403 pour la plupart des rôles) ; sans
    // gestionnaire d'erreur, chaque 403 remontait comme une exception non
    // interceptée dans la console (RxJS) pour tout profil sans cette
    // permission — trouvé en auditant ce module, aucun impact visible pour
    // l'utilisateur (les tableaux restent vides comme prévu) mais du bruit
    // silencieux qui aurait pu masquer une vraie erreur.
    this.api.equipeCabinet().subscribe({ next: (e) => this.equipe.set(e), error: () => {} });
    this.api.echeancesRh().subscribe({ next: (e) => this.echeances.set(e), error: () => {} });
    this.chargerConges();
    this.rechargerPointage();
    this.chargerBulletins();
    if (this.auth.peut('echeances_admin.consulter')) {
      this.api.listesValeurs('categorie_echeance').subscribe({ next: (v) => this.categoriesEcheanceAdmin.set(v), error: () => {} });
      this.api.listesValeurs('periodicite').subscribe({ next: (v) => this.periodicitesEcheanceAdmin.set(v), error: () => {} });
      this.chargerEcheancesAdmin();
    }
  }

  chargerEcheancesAdmin(): void {
    this.api.echeancesAdministratives().subscribe({ next: (e) => this.echeancesAdmin.set(e), error: () => {} });
  }

  libelleCategorieEcheanceAdmin(code: string): string {
    return this.categoriesEcheanceAdmin().find((c) => c.code === code)?.libelle ?? code;
  }

  libellePeriodiciteEcheanceAdmin(code: string): string {
    return this.periodicitesEcheanceAdmin().find((p) => p.code === code)?.libelle ?? code;
  }

  ajouterEcheanceAdmin(): void {
    this.erreurEcheanceAdmin.set('');
    this.doublonsEcheanceAdmin.set([]);
    this.api.verifierDoublonEcheanceAdmin(this.eaLibelle, this.eaCategorie).subscribe({
      next: (d) => { if (d.length) this.doublonsEcheanceAdmin.set(d); else this.ajouterEcheanceAdminReellement(); },
      error: () => this.ajouterEcheanceAdminReellement(),
    });
  }

  ajouterEcheanceAdminQuandMeme(): void {
    this.doublonsEcheanceAdmin.set([]);
    this.ajouterEcheanceAdminReellement();
  }

  private ajouterEcheanceAdminReellement(): void {
    this.ajoutEcheanceAdminEnCours.set(true);
    this.api.creerEcheanceAdmin({
      categorie: this.eaCategorie, libelle: this.eaLibelle,
      periodicite: this.eaPeriodicite, prochaine_date: this.eaDate,
    }).subscribe({
      next: () => {
        this.ajoutEcheanceAdminEnCours.set(false);
        this.eaLibelle = ''; this.eaDate = ''; this.doublonsEcheanceAdmin.set([]);
        this.chargerEcheancesAdmin();
      },
      error: (e) => { this.ajoutEcheanceAdminEnCours.set(false); this.erreurEcheanceAdmin.set(e?.error?.error ?? 'Ajout impossible'); },
    });
  }

  // Menu "⋮" (19/09/2026).
  actionsPourEcheanceAdmin(e: any): ActionMenuItem[] {
    if (!this.auth.peut('echeances_admin.gerer')) return [];
    return [
      { label: 'Marquer traité', action: () => this.traiterEcheanceAdmin(e) },
      { label: 'Modifier', action: () => this.modifierEcheanceAdmin(e) },
      { label: 'Supprimer', action: () => this.supprimerEcheanceAdmin(e), danger: true },
    ];
  }

  // Réutilise le même formulaire que la création — pré-rempli avec les
  // valeurs actuelles de la ligne (gap comblé le 11/09/2026 : aucun moyen
  // de corriger une échéance existante, ex. l'INPS seedée « mensuelle »
  // alors que sa propre observation dit « à ajuster selon l'effectif »).
  modifierEcheanceAdmin(e: any): void {
    this.eaEnEditionId.set(e.id);
    this.eaCategorie = e.categorie;
    this.eaLibelle = e.libelle;
    this.eaPeriodicite = e.periodicite;
    this.eaDate = e.prochaine_date?.slice(0, 10) ?? '';
    this.erreurEcheanceAdmin.set('');
  }

  annulerEditionEcheanceAdmin(): void {
    this.eaEnEditionId.set(null);
    this.eaCategorie = 'fiscale'; this.eaLibelle = ''; this.eaPeriodicite = 'ponctuelle'; this.eaDate = '';
  }

  enregistrerModificationEcheanceAdmin(): void {
    const id = this.eaEnEditionId();
    if (!id) return;
    this.api.modifierEcheanceAdmin(id, {
      categorie: this.eaCategorie, libelle: this.eaLibelle,
      periodicite: this.eaPeriodicite, prochaine_date: this.eaDate,
    }).subscribe({
      next: () => { this.annulerEditionEcheanceAdmin(); this.chargerEcheancesAdmin(); },
      error: (err) => this.erreurEcheanceAdmin.set(err?.error?.error ?? 'Modification impossible'),
    });
  }

  supprimerEcheanceAdmin(e: any): void {
    if (!confirm(`Supprimer l'échéance « ${e.libelle} » ? Cette action est réversible uniquement en la recréant à la main.`)) return;
    this.erreurEcheanceAdmin.set('');
    this.api.supprimerEcheanceAdmin(e.id).subscribe({
      next: () => this.chargerEcheancesAdmin(),
      error: (err) => this.erreurEcheanceAdmin.set(err?.error?.error ?? 'Suppression impossible'),
    });
  }

  // Le montant décaissé est demandé au moment du clic (pas un champ
  // affiché en permanence sur la ligne) — corrige un alignement jugé
  // compressé/mal lisible quand il fallait afficher en continu un champ +
  // 3 liens d'action dans une cellule étroite (12/09/2026).
  traiterEcheanceAdmin(e: any): void {
    this.erreurEcheanceAdmin.set('');
    const saisie = prompt('Montant réellement décaissé (FCFA) — laisser vide si non applicable :', '');
    if (saisie === null) return; // annulé
    const montant = saisie.trim() ? Number(saisie.trim()) : null;
    if (saisie.trim() && (!Number.isFinite(montant) || (montant as number) <= 0)) {
      this.erreurEcheanceAdmin.set('Montant invalide.');
      return;
    }
    this.api.traiterEcheanceAdmin(e.id, montant).subscribe({
      next: () => this.chargerEcheancesAdmin(),
      error: (err) => this.erreurEcheanceAdmin.set(err?.error?.error ?? 'Action impossible'),
    });
  }

  chargerConges(): void {
    this.api.conges().subscribe({ next: (c) => this.conges.set(c) });
  }

  enregistrerPointage(): void {
    this.erreurPointage.set('');
    this.api.pointer({
      date_jour: this.pointageDate || undefined,
      heure_arrivee: this.pointageArrivee || undefined, heure_depart: this.pointageDepart || undefined,
      remplacer: this.pointageCorrection || undefined,
    }).subscribe({
      next: () => { this.reinitialiserPointage(); this.rechargerPointage(); },
      error: (e) => this.erreurPointage.set(e?.error?.error ?? 'Pointage impossible'),
    });
  }

  // Vrai si l'écran affiche le pointage de la personne connectée elle-même
  // (comportement historique) — faux quand un profil autorisé consulte
  // celui d'un autre membre : seul le titulaire peut pointer/corriger le
  // sien (27/09/2026).
  estSoiMemeVue(): boolean {
    const id = this.pointageMembreId();
    return !id || id === this.auth.utilisateur()?.id;
  }

  changerMembrePointage(id: string): void {
    this.pointageMembreId.set(id);
    this.rechargerPointage();
  }

  changerPeriodeType(t: 'mois' | 'semaine'): void {
    this.periodeType.set(t);
    this.rechargerPointage();
  }

  changerPeriodeMois(mois: string): void {
    this.periodeMois = mois;
    this.rechargerPointage();
  }

  changerPeriodeSemaine(semaine: string): void {
    this.periodeSemaine = semaine;
    this.rechargerPointage();
  }

  // Valeur initiale du sélecteur <input type="week"> (format ISO "AAAA-Wnn").
  private semaineISO(d: Date): string {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const jour = (date.getUTCDay() + 6) % 7; // 0 = lundi
    date.setUTCDate(date.getUTCDate() - jour + 3); // jeudi de la semaine ISO
    const jeudiAn1 = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const semaine = 1 + Math.round(((date.getTime() - jeudiAn1.getTime()) / 86400000 - 3 + ((jeudiAn1.getUTCDay() + 6) % 7)) / 7);
    return `${date.getUTCFullYear()}-W${String(semaine).padStart(2, '0')}`;
  }

  // Bornes lundi→dimanche d'une semaine ISO "AAAA-Wnn" (input type="week").
  private bornesSemaine(semaineISO: string): { debut: string; fin: string } | null {
    const m = /^(\d{4})-W(\d{2})$/.exec(semaineISO);
    if (!m) return null;
    const annee = Number(m[1]);
    const semaine = Number(m[2]);
    const jan4 = new Date(Date.UTC(annee, 0, 4));
    const lundiSemaine1 = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000);
    const lundi = new Date(lundiSemaine1.getTime() + (semaine - 1) * 7 * 86400000);
    const dimanche = new Date(lundi.getTime() + 6 * 86400000);
    return { debut: lundi.toISOString().slice(0, 10), fin: dimanche.toISOString().slice(0, 10) };
  }

  private rechargerPointage(): void {
    const filtres: { mois?: string; debut?: string; fin?: string; utilisateur_id?: string } = {};
    if (this.pointageMembreId()) filtres.utilisateur_id = this.pointageMembreId();
    if (this.periodeType() === 'semaine') {
      const bornes = this.bornesSemaine(this.periodeSemaine);
      if (bornes) { filtres.debut = bornes.debut; filtres.fin = bornes.fin; }
    } else {
      filtres.mois = `${this.periodeMois}-01`;
    }
    this.api.presencesMois(filtres).subscribe({ next: (p) => this.presences.set(p) });
  }

  reinitialiserPointage(): void {
    this.pointageDate = this.aujourdhui;
    this.pointageArrivee = '';
    this.pointageDepart = '';
    this.pointageCorrection = false;
  }

  heure(h: string | null): string {
    return h ? h.slice(0, 5) : '—';
  }

  actionsPourPointage(j: any): ActionMenuItem[] {
    if (!this.estSoiMemeVue() || !this.auth.peut('cabinet.presence.pointer')) return [];
    return [
      { label: 'Modifier', action: () => {
        this.erreurPointage.set('');
        this.pointageDate = String(j.date_jour).slice(0, 10);
        this.pointageArrivee = j.heure_arrivee ? j.heure_arrivee.slice(0, 5) : '';
        this.pointageDepart = j.heure_depart ? j.heure_depart.slice(0, 5) : '';
        this.pointageCorrection = true;
      } },
      { label: 'Retirer', danger: true, action: () => {
        const d = String(j.date_jour).slice(0, 10);
        if (!confirm(`Retirer le pointage du ${d.split('-').reverse().join('/')} ?`)) return;
        this.erreurPointage.set('');
        this.api.retirerPointage(d).subscribe({
          next: () => this.rechargerPointage(),
          error: (e) => this.erreurPointage.set(e?.error?.error ?? 'Retrait impossible'),
        });
      } },
    ];
  }

  demander(): void {
    this.erreurConge.set('');
    this.doublonsConge.set([]);
    this.api.verifierDoublonConge(this.nouveauConge.date_debut, this.nouveauConge.date_fin).subscribe({
      next: (d) => { if (d.length) this.doublonsConge.set(d); else this.demanderReellement(); },
      error: () => this.demanderReellement(),
    });
  }

  demanderQuandMeme(): void {
    this.doublonsConge.set([]);
    this.demanderReellement();
  }

  private demanderReellement(): void {
    this.ajoutCongeEnCours.set(true);
    this.api.demanderConge(this.nouveauConge).subscribe({
      next: () => {
        this.ajoutCongeEnCours.set(false);
        this.nouveauConge = { type: 'annuel' };
        this.doublonsConge.set([]);
        this.chargerConges();
      },
      error: (e) => { this.ajoutCongeEnCours.set(false); this.erreurConge.set(e?.error?.error ?? 'Demande impossible.'); },
    });
  }

  decider(c: any, statut: 'approuve' | 'refuse'): void {
    this.erreurConge.set('');
    this.api.decisionConge(c.id, statut).subscribe({
      next: () => this.chargerConges(),
      error: (e) => this.erreurConge.set(e?.error?.error ?? 'Décision impossible'),
    });
  }

  // Menu "⋮" (19/09/2026).
  actionsPourConge(c: any): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];
    if (c.statut === 'demande' && this.auth.peut('cabinet.conge.decision')) {
      items.push({ label: 'Approuver', action: () => this.decider(c, 'approuve') });
      items.push({ label: 'Refuser', action: () => this.decider(c, 'refuse'), danger: true });
    }
    if (c.statut === 'demande' && (c.utilisateur_id === this.auth.utilisateur()?.id || this.auth.peut('cabinet.conge.decision'))) {
      items.push({ label: 'Retirer', action: () => this.retirerConge(c.id), danger: true });
    }
    // Congé déjà approuvé : annulation réservée à qui peut décider (25/09/2026).
    if (c.statut === 'approuve' && this.auth.peut('cabinet.conge.decision')) {
      items.push({ label: 'Annuler le congé', action: () => this.annulerConge(c), danger: true });
    }
    return items;
  }

  annulerConge(c: any): void {
    const motif = window.prompt(`Annuler le congé approuvé de ${c.membre} ? Motif (facultatif) :`, '');
    if (motif === null) return;
    this.erreurConge.set('');
    this.api.annulerConge(c.id, motif || undefined).subscribe({
      next: () => this.chargerConges(),
      error: (e) => this.erreurConge.set(e?.error?.error ?? 'Annulation impossible'),
    });
  }

  retirerConge(id: string): void {
    if (!window.confirm('Retirer cette demande de congé ?')) return;
    this.erreurConge.set('');
    this.api.retirerConge(id).subscribe({
      next: () => this.chargerConges(),
      error: (e) => this.erreurConge.set(e?.error?.error ?? 'Retrait impossible'),
    });
  }

  // Chacun voit toujours SES PROPRES bulletins sans permission particulière
  // (même règle serveur que les rétrocessions/bulletins depuis le
  // 18/08/2026) — voir ceux d'un autre membre exige cabinet.bulletins.consulter.
  chargerBulletins(): void {
    this.api.bulletinsPaie(this.bulletinMembreId() || undefined).subscribe({
      next: (b) => this.bulletins.set(b),
      error: () => this.bulletins.set([]),
    });
  }

  changerMembreBulletin(id: string): void {
    this.bulletinMembreId.set(id);
    this.chargerBulletins();
  }

  archiverBulletin(): void {
    if (!this.nouveauBulletin.utilisateur_id || this.ajoutBulletinEnCours()) return;
    this.erreurBulletin.set('');
    this.ajoutBulletinEnCours.set(true);
    this.api.creerBulletinPaie(this.nouveauBulletin).subscribe({
      next: () => {
        this.ajoutBulletinEnCours.set(false);
        // Bascule la vue sur le membre qui vient de recevoir son bulletin,
        // pour que le résultat de l'archivage soit visible immédiatement —
        // seulement si l'appelant est autorisé à le consulter (un rôle peut
        // avoir cabinet.bulletin.generer sans cabinet.bulletins.consulter,
        // ex. admin_it : basculer la vue afficherait un 403 pour rien).
        const cible = this.nouveauBulletin.utilisateur_id;
        if (cible === this.auth.utilisateur()?.id || this.auth.peut('cabinet.bulletins.consulter')) {
          this.bulletinMembreId.set(cible);
        }
        this.nouveauBulletin = { mois: new Date().toISOString().slice(0, 8) + '01' };
        this.chargerBulletins();
      },
      error: (e) => { this.ajoutBulletinEnCours.set(false); this.erreurBulletin.set(e?.error?.error ?? 'Archivage impossible'); },
    });
  }
}
