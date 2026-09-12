import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-cabinet',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule],
  template: `
    <header class="page-head">
      <div>
        <h1>Cabinet (RH)</h1>
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
            <td>{{ m.role }}</td>
            <td>{{ m.dossiers_actifs }}</td>
            <td>{{ m.heures_mois | number }} h</td>
          </tr>
        }
      </table>
    </section>

    <section class="panel">
      <h3>Mon pointage — {{ presences()?.total_heures ?? 0 }} h ce mois ({{ presences()?.jours_pointes ?? 0 }} jours)</h3>
      @if (auth.peut('cabinet.presence.pointer')) {
        <div class="upload">
          <input class="sel" type="time" [(ngModel)]="pointageArrivee" name="arr" placeholder="Arrivée" />
          <input class="sel" type="time" [(ngModel)]="pointageDepart" name="dep" placeholder="Départ" />
          <button class="btn sm" (click)="enregistrerPointage()">Enregistrer</button>
        </div>
      }
      @if (presences()?.jours?.length) {
        <table>
          <tr><th>Date</th><th>Arrivée</th><th>Départ</th><th>Heures</th></tr>
          @for (j of presences().jours; track j.date_jour) {
            <tr><td>{{ j.date_jour | date:'dd/MM/yyyy' }}</td><td>{{ j.heure_arrivee || '—' }}</td><td>{{ j.heure_depart || '—' }}</td><td>{{ j.heures || '—' }}</td></tr>
          }
        </table>
      }
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
          <button class="btn sm" (click)="demander()" [disabled]="!nouveauConge.date_debut || !nouveauConge.date_fin">Demander</button>
        </div>
      }
      @if (conges().length) {
        <table>
          <tr><th>Membre</th><th>Type</th><th>Du</th><th>Au</th><th>Statut</th><th></th></tr>
          @for (c of conges(); track c.id) {
            <tr>
              <td>{{ c.membre }}</td><td>{{ c.type }}</td>
              <td>{{ c.date_debut | date:'dd/MM/yyyy' }}</td><td>{{ c.date_fin | date:'dd/MM/yyyy' }}</td>
              <td><span class="tag" [class.ok]="c.statut==='approuve'" [class.haute]="c.statut==='refuse'">{{ c.statut }}</span></td>
              <td>
                @if (c.statut === 'demande' && auth.peut('cabinet.conge.decision')) {
                  <button class="lien" (click)="decider(c, 'approuve')">Approuver</button>
                  <button class="lien" (click)="decider(c, 'refuse')">Refuser</button>
                }
              </td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucune demande.</p> }
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
              <button class="btn sm" (click)="ajouterEcheanceAdmin()" [disabled]="!eaLibelle || !eaDate">Ajouter</button>
            }
          </div>
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
                <td>
                  @if (auth.peut('echeances_admin.gerer')) {
                    <button class="lien" (click)="traiterEcheanceAdmin(e)">Marquer traité</button>
                    <button class="lien" (click)="modifierEcheanceAdmin(e)">Modifier</button>
                    <button class="lien" (click)="supprimerEcheanceAdmin(e)">Supprimer</button>
                  }
                </td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucune échéance administrative enregistrée.</p> }
      </section>
    }

    @if (auth.peut('cabinet.bulletin.generer')) {
      <section class="panel">
        <h3>Bulletins de paie (option légère — archivage indicatif)</h3>
        <div class="upload">
          <select class="sel" [(ngModel)]="nouveauBulletin.utilisateur_id" name="bulUser">
            <option value="">Membre…</option>
            @for (m of equipe(); track m.id) { <option [value]="m.id">{{ m.prenom }} {{ m.nom }}</option> }
          </select>
          <input class="sel" type="date" [(ngModel)]="nouveauBulletin.mois" name="bulMois" />
          <input class="sel" type="number" [(ngModel)]="nouveauBulletin.salaire_brut" name="bulBrut" placeholder="Brut" />
          <input class="sel" type="number" [(ngModel)]="nouveauBulletin.salaire_net" name="bulNet" placeholder="Net" />
          <button class="btn sm" (click)="archiverBulletin()">Archiver</button>
        </div>
      </section>
    }
  `,
  styles: [`
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
  readonly equipe = signal<any[]>([]);
  readonly echeances = signal<any[]>([]);
  readonly conges = signal<any[]>([]);
  readonly presences = signal<any>(null);

  pointageArrivee = '';
  pointageDepart = '';
  nouveauConge: any = { type: 'annuel' };
  nouveauBulletin: any = { mois: new Date().toISOString().slice(0, 8) + '01' };

  // Obligations administratives du cabinet (12/09/2026, déplacées
  // d'Échéances vers Cabinet — voir CLAUDE.md/HISTORY.md : la consultation
  // était ouverte à quasiment tout le cabinet, ces obligations relèvent de
  // la direction/comptabilité comme le reste de ce module).
  readonly echeancesAdmin = signal<any[]>([]);
  readonly categoriesEcheanceAdmin = signal<{ code: string; libelle: string }[]>([]);
  readonly periodicitesEcheanceAdmin = signal<{ code: string; libelle: string }[]>([]);
  readonly erreurEcheanceAdmin = signal('');
  eaCategorie = 'fiscale'; eaLibelle = ''; eaPeriodicite = 'ponctuelle'; eaDate = '';
  // Le même formulaire sert à la création ET à la modification (pas de 2e
  // formulaire dupliqué) : non-null quand une ligne est en cours d'édition.
  readonly eaEnEditionId = signal<string | null>(null);

  private readonly libellesEcheance: Record<string, string> = {
    fin_essai: "Fin de période d'essai", fin_contrat: 'Fin de contrat', visite_medicale: 'Visite médicale',
  };
  libelleEcheance(t: string): string { return this.libellesEcheance[t] ?? t; }

  ngOnInit(): void {
    this.api.equipeCabinet().subscribe({ next: (e) => this.equipe.set(e) });
    this.api.echeancesRh().subscribe({ next: (e) => this.echeances.set(e) });
    this.chargerConges();
    this.api.presencesMois().subscribe({ next: (p) => this.presences.set(p) });
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
    this.api.creerEcheanceAdmin({
      categorie: this.eaCategorie, libelle: this.eaLibelle,
      periodicite: this.eaPeriodicite, prochaine_date: this.eaDate,
    }).subscribe({
      next: () => { this.eaLibelle = ''; this.eaDate = ''; this.chargerEcheancesAdmin(); },
      error: (e) => this.erreurEcheanceAdmin.set(e?.error?.error ?? 'Ajout impossible'),
    });
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
    this.api.pointer({ heure_arrivee: this.pointageArrivee || undefined, heure_depart: this.pointageDepart || undefined })
      .subscribe({ next: () => this.api.presencesMois().subscribe({ next: (p) => this.presences.set(p) }) });
  }

  demander(): void {
    this.api.demanderConge(this.nouveauConge).subscribe({
      next: () => { this.nouveauConge = { type: 'annuel' }; this.chargerConges(); },
    });
  }

  decider(c: any, statut: 'approuve' | 'refuse'): void {
    this.api.decisionConge(c.id, statut).subscribe({ next: () => this.chargerConges() });
  }

  archiverBulletin(): void {
    if (!this.nouveauBulletin.utilisateur_id) return;
    this.api.creerBulletinPaie(this.nouveauBulletin).subscribe({
      next: () => { this.nouveauBulletin = { mois: new Date().toISOString().slice(0, 8) + '01' }; },
    });
  }
}
