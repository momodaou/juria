import { Component, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, MoyenPaiement } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ReglementFormComponent } from '../../core/reglement-form.component';
import { DocumentPreviewService } from '../../core/document-preview.service';

// État mensuel des charges (24/10/2026). Fonctionnement du cabinet : l'admin
// générale / le comptable prépare l'état (catalogue + reports + ponctuelles),
// le soumet aux associés, qui approuvent, rejettent ou REPORTENT chaque ligne
// et orientent le moyen de paiement ; l'approbation crée une dépense validée
// (décaissement dans « Dépenses & caisse »). Les salaires restent dans le module RH.
// Pas de zone.js : tout changement passe par un signal ; les formulaires sont
// des objets simples relus à l'envoi, puis l'écran est rechargé.
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const CATEGORIES: [string, string][] = [
  ['loyer', 'Loyer'], ['eau', 'Eau'], ['electricite', 'Électricité'], ['nettoyage', 'Nettoyage'], ['carburant', 'Carburant'],
  ['telephonie', 'Téléphonie'], ['internet', 'Internet'], ['consommables', 'Consommables'], ['fournitures', 'Fournitures'],
  ['deplacement', 'Déplacement'], ['hebergement', 'Hébergement'], ['restauration', 'Restauration'], ['entretien', 'Entretien'],
  ['charges_fiscales_sociales', 'Charges fiscales et sociales'], ['autre', 'Autre'],
];

@Component({
  selector: 'app-etat-charges',
  standalone: true,
  imports: [DecimalPipe, FormsModule, RouterLink, ReglementFormComponent],
  template: `
    <header class="page-head">
      <div>
        <h1>État mensuel des charges</h1>
        <p>Préparé par l’administration, décidé par les associés : approuver, rejeter ou reporter chaque charge. <a class="lien" routerLink="/depenses">← Dépenses &amp; caisse</a></p>
      </div>
      @if (auth.peut('depenses.creer')) {
        <div class="creation">
          <select class="sel" [ngModel]="moisChoisi()" (ngModelChange)="moisChoisi.set(+$event)" name="moisNouveau">
            @for (n of mois12; track n) { <option [ngValue]="n">{{ moisNom(n) }}</option> }
          </select>
          <select class="sel" [ngModel]="anneeChoisie()" (ngModelChange)="anneeChoisie.set(+$event)" name="anneeNouveau">
            @for (a of annees; track a) { <option [ngValue]="a">{{ a }}</option> }
          </select>
          <button class="btn" (click)="creerEtat()" [disabled]="enCours()">+ Nouvel état</button>
        </div>
      }
    </header>
    @if (erreur()) { <p class="err">{{ erreur() }}</p> }

    <section class="panel">
      <h3>États</h3>
      @if (!etats().length) { <p class="hint">Aucun état pour le moment. Choisissez un mois puis « Nouvel état » : il se remplit avec vos charges habituelles et les charges reportées.</p> }
      @else {
        <table>
          <tr><th>Mois</th><th>Statut</th><th>Charges</th><th class="num">Total (FCFA)</th><th>À décider</th><th>Reportées</th><th>En retard</th><th></th></tr>
          @for (e of etats(); track e.id) {
            <tr [class.sel]="detail()?.id === e.id">
              <td><b>{{ libelleMois(e.mois) }}</b></td>
              <td>{{ libelleStatut(e.statut) }}</td>
              <td>{{ e.nb_lignes }}</td>
              <td class="num">{{ e.total | number }}</td>
              <td>{{ e.nb_a_decider }}</td>
              <td>{{ e.nb_reportees }}</td>
              <td>@if (e.nb_en_retard) { <span class="retard">{{ e.nb_en_retard }}</span> }</td>
              <td class="actions"><button class="lien" (click)="ouvrir(e.id)">{{ detail()?.id === e.id ? 'Affiché' : 'Ouvrir' }}</button></td>
            </tr>
          }
        </table>
      }
    </section>

    @if (detail(); as d) {
      <section class="panel">
        <h3>{{ libelleMois(d.mois) }} — {{ libelleStatut(d.statut) }}</h3>
        @if (d.en_retard) {
          <p class="alerte">⚠ {{ d.en_retard }} charge(s) reportée(s) depuis {{ seuil }} mois ou plus : à traiter en priorité.</p>
        }
        <div class="kpis">
          <div class="kpi"><div class="n">{{ d.totaux.total | number }}</div><div class="l">Total hors rejetées (FCFA)</div></div>
          <div class="kpi green"><div class="n">{{ d.totaux.approuve | number }}</div><div class="l">Approuvé (FCFA)</div></div>
          <div class="kpi amber"><div class="n">{{ d.totaux.reporte | number }}</div><div class="l">Reporté (FCFA)</div></div>
          <div class="kpi red"><div class="n">{{ d.totaux.rejete | number }}</div><div class="l">Rejeté (FCFA)</div></div>
          <div class="kpi"><div class="n">{{ d.totaux.a_decider | number }}</div><div class="l">À décider (FCFA)</div></div>
        </div>

        <div class="barre">
          <button class="btn ghost sm" (click)="apercu(d)">👁 Aperçu / PDF</button>
          @if (d.statut === 'en_preparation' && auth.peut('depenses.creer')) {
            <button class="btn sm" (click)="action(d.id, 'soumettre')" [disabled]="enCours() || !d.lignes.length">Soumettre aux associés</button>
          }
          @if (d.statut === 'soumis' && auth.peut('depenses.creer') && !decisionsPrises(d)) {
            <button class="btn ghost sm" (click)="action(d.id, 'rouvrir')" [disabled]="enCours()">Rouvrir pour modifier</button>
          }
          @if (d.statut === 'soumis' && auth.peut('depenses.decision')) {
            <button class="btn sm" (click)="action(d.id, 'cloturer')" [disabled]="enCours() || aDecider(d)">Clôturer l’état</button>
          }
        </div>

        <table>
          <tr><th>Charge</th><th>Période couverte</th><th class="num">Montant (FCFA)</th><th>Moyen / compte</th><th>Décision</th><th></th></tr>
          @for (l of d.lignes; track l.id) {
            <tr [class.retard-ligne]="l.retard_mois >= seuil && l.decision === 'en_attente'">
              <td>
                <b>{{ l.libelle }}</b>
                @if (l.type !== 'fixe') { <span class="tag">ponctuelle</span> }
                @if (l.report_de) { <span class="tag report">reportée · retard {{ l.retard_mois }} mois</span> }
                @if (l.observation) { <div class="obs">{{ l.observation }}</div> }
              </td>
              <td>{{ periode(l) }}</td>
              <td class="num">{{ l.montant | number }}</td>
              <td>{{ moyen(l) }}</td>
              <td>
                @switch (l.decision) {
                  @case ('approuvee') {
                    <span class="ok">Approuvée</span>
                    @if (l.depense_statut === 'validee') { <div class="obs"><a class="lien" routerLink="/depenses" [queryParams]="{ statut: 'validee' }">À décaisser →</a></div> }
                    @else if (l.depense_statut) { <div class="obs">dépense {{ libelleDepense(l.depense_statut) }}</div> }
                  }
                  @case ('rejetee') { <span class="ko">Rejetée</span><div class="obs">{{ l.motif }}</div> }
                  @case ('reportee') { <span class="rep">Reportée</span>@if (l.motif) { <div class="obs">{{ l.motif }}</div> } }
                  @default { }
                }
              </td>
              <td class="actions">
                @if (d.statut === 'en_preparation' && auth.peut('depenses.creer')) {
                  <button class="lien" (click)="editer(l)">Modifier</button>
                  @if (!l.report_de) { <button class="lien" (click)="supprimer(d.id, l.id)">Retirer</button> }
                }
                @if (d.statut === 'soumis' && l.decision === 'en_attente' && auth.peut('depenses.decision')) {
                  <button class="lien" (click)="editer(l)">Décider…</button>
                }
              </td>
            </tr>
            @if (edition()?.id === l.id) {
              <tr class="edit">
                <td colspan="6">
                  @if (d.statut === 'en_preparation') {
                    <div class="champs">
                      <div class="large"><label>Libellé</label><input class="in" [(ngModel)]="form.libelle" name="el" /></div>
                      <div><label>Catégorie</label>
                        <select class="in" [(ngModel)]="form.categorie" name="ec">@for (c of categories; track c[0]) { <option [value]="c[0]">{{ c[1] }}</option> }</select></div>
                      <div><label>Type</label>
                        <select class="in" [(ngModel)]="form.type" name="et"><option value="fixe">Fixe</option><option value="ponctuelle">Ponctuelle</option></select></div>
                      <div><label>Période — début</label><input class="in" type="date" [(ngModel)]="form.periode_debut" name="ed" /></div>
                      <div><label>Période — fin</label><input class="in" type="date" [(ngModel)]="form.periode_fin" name="ef" /></div>
                      <div class="large"><label>Observation (ex. 3 mois d’arriéré)</label><input class="in" [(ngModel)]="form.observation" name="eo" /></div>
                    </div>
                  }
                  <div class="champs">
                    <div><label>Montant (FCFA)</label><input class="in" type="number" min="0" [(ngModel)]="form.montant" name="em" /></div>
                    @if (d.statut === 'soumis') {
                      <div class="large"><label>Motif (obligatoire pour rejeter)</label><input class="in" [(ngModel)]="form.motif" name="emo" /></div>
                    }
                  </div>
                  <div class="reglement-bloc">
                    <app-reglement-form sens="decaissement" cleMode="mode_paiement" [exigerReferences]="false" [exigerMoyen]="false"
                                        [modele]="form" [catalogue]="catalogue()"></app-reglement-form>
                  </div>
                  @if (d.statut === 'soumis') {
                    <div class="btns">
                      <button class="btn sm" (click)="decider(d.id, l.id, 'approuvee')" [disabled]="enCours()">Approuver</button>
                      <button class="btn ghost sm" (click)="decider(d.id, l.id, 'reportee')" [disabled]="enCours()">Reporter au mois suivant</button>
                      <button class="btn ghost danger sm" (click)="decider(d.id, l.id, 'rejetee')" [disabled]="enCours() || !form.motif">Rejeter</button>
                      <button class="lien" (click)="edition.set(null)">Annuler</button>
                    </div>
                  } @else {
                    <div class="btns">
                      <button class="btn sm" (click)="enregistrerLigne(d.id, l.id)" [disabled]="enCours() || !form.libelle">Enregistrer</button>
                      <button class="lien" (click)="edition.set(null)">Annuler</button>
                    </div>
                  }
                </td>
              </tr>
            }
          }
        </table>

        @if (d.statut === 'en_preparation' && auth.peut('depenses.creer')) {
          <h4 class="sous-titre">Ajouter une charge ponctuelle</h4>
          <div class="champs">
            <div class="large"><label>Libellé</label><input class="in" [(ngModel)]="ajout.libelle" name="al" /></div>
            <div><label>Catégorie</label>
              <select class="in" [(ngModel)]="ajout.categorie" name="ac">@for (c of categories; track c[0]) { <option [value]="c[0]">{{ c[1] }}</option> }</select></div>
            <div><label>Montant (FCFA)</label><input class="in" type="number" min="0" [(ngModel)]="ajout.montant" name="am" /></div>
            <div class="large"><label>Observation</label><input class="in" [(ngModel)]="ajout.observation" name="ao" /></div>
          </div>
          <div class="reglement-bloc">
            <app-reglement-form sens="decaissement" cleMode="mode_paiement" [exigerReferences]="false" [exigerMoyen]="false"
                                [modele]="ajout" [catalogue]="catalogue()"></app-reglement-form>
          </div>
          <button class="btn" (click)="ajouterLigne(d.id)" [disabled]="enCours() || !ajout.libelle">Ajouter à l’état</button>
        }
        @if (d.statut === 'clos') { <p class="hint">État clos. Les charges approuvées sont à décaisser dans « Dépenses &amp; caisse » ; les charges reportées reviennent dans l’état du mois suivant.</p> }
      </section>
    }

    <section class="panel">
      <h3>Charges habituelles <button class="lien" (click)="catalogueOuvert.set(!catalogueOuvert())">{{ catalogueOuvert() ? 'Masquer' : 'Afficher' }}</button></h3>
      <p class="intro">Ce catalogue sert uniquement à pré-remplir chaque nouvel état : il ne déclenche jamais de paiement. Les salaires restent dans le module RH.</p>
      @if (catalogueOuvert()) {
        <table>
          <tr><th>Charge</th><th>Périodicité</th><th class="num">Montant habituel</th><th>Moyen proposé</th><th></th></tr>
          @for (m of modeles(); track m.id) {
            <tr>
              <td><b>{{ m.libelle }}</b> @if (m.montant_variable) { <span class="tag">montant variable</span> }</td>
              <td>{{ libellePeriodicite(m) }}</td>
              <td class="num">{{ m.montant_habituel | number }}</td>
              <td>{{ moyen(m) }}</td>
              <td class="actions">
                @if (auth.peut('depenses.creer')) {
                  <button class="lien" (click)="editerModele(m)">Modifier</button>
                  <button class="lien" (click)="retirerModele(m.id)">Retirer</button>
                }
              </td>
            </tr>
          }
        </table>
        @if (auth.peut('depenses.creer')) {
          <h4 class="sous-titre">{{ modeleEnEdition() ? 'Modifier la charge' : 'Ajouter une charge habituelle' }}</h4>
          <div class="champs">
            <div class="large"><label>Libellé</label><input class="in" [(ngModel)]="modele.libelle" name="ml" /></div>
            <div><label>Catégorie</label>
              <select class="in" [(ngModel)]="modele.categorie" name="mc">@for (c of categories; track c[0]) { <option [value]="c[0]">{{ c[1] }}</option> }</select></div>
            <div><label>Type</label>
              <select class="in" [(ngModel)]="modele.type" name="mt"><option value="fixe">Fixe</option><option value="ponctuelle">Ponctuelle récurrente</option></select></div>
            <div><label>Montant habituel (FCFA)</label><input class="in" type="number" min="0" [(ngModel)]="modele.montant_habituel" name="mm" /></div>
            <div><label>Périodicité</label>
              <select class="in" [(ngModel)]="modele.periodicite" name="mp">
                <option value="mensuelle">Mensuelle</option><option value="trimestrielle">Trimestrielle</option><option value="annuelle">Annuelle</option>
              </select></div>
            @if (modele.periodicite !== 'mensuelle') {
              <div><label>{{ modele.periodicite === 'annuelle' ? 'Mois d’échéance' : '1er mois du cycle' }}</label>
                <select class="in" [(ngModel)]="modele.mois_echeance" name="me">@for (n of mois12; track n) { <option [ngValue]="n">{{ moisNom(n) }}</option> }</select></div>
            }
            <div class="large cases"><label><input type="checkbox" [(ngModel)]="modele.montant_variable" name="mv" /> Le montant change d’un mois à l’autre</label></div>
          </div>
          <div class="reglement-bloc">
            <app-reglement-form sens="decaissement" cleMode="mode_paiement" [exigerReferences]="false" [exigerMoyen]="false"
                                [modele]="modele" [catalogue]="catalogue()"></app-reglement-form>
          </div>
          <div class="btns">
            <button class="btn" (click)="enregistrerModele()" [disabled]="enCours() || !modele.libelle">{{ modeleEnEdition() ? 'Enregistrer' : 'Ajouter au catalogue' }}</button>
            @if (modeleEnEdition()) { <button class="lien" (click)="nouveauModele()">Annuler</button> }
          </div>
        }
      }
    </section>
  `,
  styles: [`
    :host{display:block;padding-bottom:90px}
    .creation{display:flex;gap:8px;align-items:center}
    .sel,.in{font-family:inherit;border:1px solid var(--line);border-radius:8px;background:#fff;color:#22303f}
    .sel{padding:8px 10px;font-size:var(--fs-base)}
    .in{display:block;width:100%;box-sizing:border-box;padding:9px 12px;margin:4px 0 0;font-size:var(--fs-base)}
    label{display:block;font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .btn{font-family:inherit;background:var(--gold);color:#1b2436;border:1px solid var(--gold);border-radius:8px;padding:9px 16px;font-size:var(--fs-base);font-weight:600;cursor:pointer;text-decoration:none}
    .btn.sm{padding:7px 13px}
    .btn.ghost{background:#fff;border-color:var(--line);color:var(--slate)}
    .btn.danger{color:var(--red);border-color:var(--red)}
    .btn:disabled{opacity:.55;cursor:not-allowed}
    .barre{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:18px 0 20px}
    .btns{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:16px}
    .kpis{margin-bottom:0}
    .kpi{padding:12px 16px}
    .kpi .n{font-size:var(--fs-2xl)}
    table{width:100%}
    td.num{text-align:right;white-space:nowrap;padding-right:18px}
    th.num{text-align:right;padding-right:18px}
    td.actions{white-space:nowrap;text-align:right;padding-right:48px}
    tr.sel td{background:rgba(176,141,87,.16)}
    tr.sel td:first-child{box-shadow:inset 3px 0 0 var(--gold);font-weight:700}
    tr.retard-ligne td{background:rgba(179,38,30,.06)}
    tr.edit > td{background:#FAFAF7;padding:18px 20px 20px;border-bottom:1px solid var(--line)}
    .tag{display:inline-block;margin-left:8px;padding:2px 9px;border-radius:12px;background:#eceff3;color:#5a6675;font-size:var(--fs-xs);font-weight:600}
    .tag.report{background:#fbf1dc;color:#9a6c12}
    .obs{font-size:var(--fs-sm);color:var(--grey);margin-top:3px}
    .ok{color:var(--green);font-weight:700}.ko{color:var(--red);font-weight:700}.rep{color:#9a6c12;font-weight:700}.att{color:var(--grey)}
    .retard{display:inline-block;min-width:22px;text-align:center;padding:1px 7px;border-radius:12px;background:var(--red);color:#fff;font-weight:700;font-size:var(--fs-xs)}
    .alerte{background:rgba(179,38,30,.08);border:1px solid rgba(179,38,30,.35);color:var(--red);padding:10px 14px;border-radius:8px;font-weight:600;font-size:var(--fs-base);margin:0 0 16px}
    .champs{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px 18px;margin-bottom:14px}
    .champs .large{grid-column:1 / -1}
    .champs .cases label{display:flex;align-items:center;gap:8px;font-weight:400;font-size:var(--fs-base)}
    .reglement-bloc{margin:2px 0 4px}
    .sous-titre{margin:26px 0 14px;padding-top:18px;border-top:1px solid var(--line);color:var(--navy);font-size:var(--fs-md);font-weight:700}
    .intro{margin:0 0 16px;color:var(--grey);font-size:var(--fs-base)}
    .hint{color:var(--grey);font-size:var(--fs-base);margin:12px 0 0}
    .panel h3 .lien{margin-left:12px;font-size:var(--fs-sm)}
  `],
})
export class EtatChargesComponent implements OnInit {
  readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly preview = inject(DocumentPreviewService);

  readonly seuil = 2;
  readonly categories = CATEGORIES;
  readonly mois12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  readonly etats = signal<any[]>([]);
  readonly detail = signal<any | null>(null);
  readonly modeles = signal<any[]>([]);
  readonly catalogue = signal<MoyenPaiement[]>([]);
  readonly erreur = signal('');
  readonly enCours = signal(false);
  readonly moisChoisi = signal(new Date().getMonth() + 1);
  readonly anneeChoisie = signal(new Date().getFullYear());
  readonly annees = [0, 1, 2].map((i) => new Date().getFullYear() - 1 + i);
  readonly edition = signal<any | null>(null);
  readonly catalogueOuvert = signal(false);
  readonly modeleEnEdition = signal<string | null>(null);

  form: any = {};
  ajout: any = this.ligneVide();
  modele: any = this.modeleVide();

  ngOnInit(): void {
    this.api.moyensDecaissement().subscribe({ next: (m) => this.catalogue.set(m), error: () => {} });
    this.charger();
    this.chargerModeles();
  }

  private ligneVide(): any { return { libelle: '', categorie: 'autre', montant: null, observation: '', mode_paiement: '', compte_id: '', references: {} }; }
  private modeleVide(): any {
    return { libelle: '', categorie: 'autre', type: 'fixe', montant_habituel: null, montant_variable: false, periodicite: 'mensuelle', mois_echeance: 1, mode_paiement: '', compte_id: '', references: {} };
  }

  libelleMois(m: string): string { const [a, n] = (m || '').split('-'); return `${MOIS[+n - 1] ?? ''} ${a}`; }
  moisNom(n: number): string { return MOIS[n - 1]; }
  libelleStatut(s: string): string { return s === 'en_preparation' ? 'en préparation' : s === 'soumis' ? 'soumis aux associés' : 'clos'; }
  libelleDepense(s: string): string { return ({ soumise: 'soumise', validee: 'à décaisser', rejetee: 'rejetée', decaissee: 'décaissée' } as any)[s] ?? s; }
  libellePeriodicite(m: any): string {
    return m.periodicite === 'mensuelle' ? 'Mensuelle'
      : m.periodicite === 'annuelle' ? `Annuelle (${MOIS[m.mois_echeance - 1]})` : `Trimestrielle (dès ${MOIS[m.mois_echeance - 1]})`;
  }
  periode(l: any): string {
    if (!l.periode_debut) return '';
    const deb = this.libelleMois(l.periode_debut.slice(0, 7));
    const fin = l.periode_fin ? this.libelleMois(l.periode_fin.slice(0, 7)) : deb;
    return deb === fin ? deb : `${deb} → ${fin}`;
  }
  moyen(l: any): string {
    const m = this.catalogue().find((x) => x.code === l.mode_paiement)?.libelle ?? l.mode_paiement ?? '';
    return [m, l.compte_intitule].filter(Boolean).join(' — ') || '—';
  }
  decisionsPrises(d: any): boolean { return d.lignes.some((l: any) => l.decision !== 'en_attente'); }
  aDecider(d: any): boolean { return d.lignes.some((l: any) => l.decision === 'en_attente'); }

  charger(): void { this.api.etatsCharges().subscribe({ next: (l) => this.etats.set(l), error: () => this.erreur.set('Impossible de charger les états.') }); }
  chargerModeles(): void { this.api.modelesCharges().subscribe({ next: (l) => this.modeles.set(l), error: () => {} }); }

  ouvrir(id: string): void {
    this.edition.set(null);
    this.api.etatCharges(id).subscribe({ next: (e) => this.detail.set(e), error: () => this.erreur.set('Impossible d’ouvrir cet état.') });
  }
  private rafraichir(): void { const id = this.detail()?.id; this.charger(); if (id) this.ouvrir(id); }
  private echec(e: any): void { this.erreur.set(e?.error?.error ?? 'Opération impossible.'); this.enCours.set(false); }
  private fini(): void { this.erreur.set(''); this.enCours.set(false); this.rafraichir(); }

  creerEtat(): void {
    this.enCours.set(true);
    this.api.creerEtatCharges(`${this.anneeChoisie()}-${String(this.moisChoisi()).padStart(2, '0')}`).subscribe({
      next: (e) => { this.erreur.set(''); this.enCours.set(false); this.charger(); this.detail.set(e); this.edition.set(null); },
      error: (e) => this.echec(e),
    });
  }

  apercu(d: any): void { this.preview.ouvrir(`Etat des charges ${d.mois.slice(0, 7)}.pdf`, this.api.telechargerEtatChargesPdf(d.id)); }

  action(id: string, a: 'soumettre' | 'rouvrir' | 'cloturer'): void {
    this.enCours.set(true);
    this.api.actionEtatCharges(id, a).subscribe({ next: () => this.fini(), error: (e) => this.echec(e) });
  }

  editer(l: any): void {
    this.form = { libelle: l.libelle, categorie: l.categorie, type: l.type, montant: Number(l.montant), observation: l.observation ?? '',
      periode_debut: l.periode_debut ?? '', periode_fin: l.periode_fin ?? '', mode_paiement: l.mode_paiement ?? '', compte_id: l.compte_id ?? '', references: {}, motif: '' };
    this.edition.set(l);
  }
  private charge(): any {
    const f = this.form;
    return { libelle: f.libelle, categorie: f.categorie, type: f.type, montant: Number(f.montant), observation: f.observation || null,
      periode_debut: f.periode_debut || null, periode_fin: f.periode_fin || null, mode_paiement: f.mode_paiement || null, compte_id: f.compte_id || null };
  }
  enregistrerLigne(etatId: string, ligneId: string): void {
    this.enCours.set(true);
    this.api.modifierLigneCharge(etatId, ligneId, this.charge()).subscribe({ next: () => { this.edition.set(null); this.fini(); }, error: (e) => this.echec(e) });
  }
  decider(etatId: string, ligneId: string, decision: string): void {
    this.enCours.set(true);
    const f = this.form;
    this.api.decisionLigneCharge(etatId, ligneId, { decision, motif: f.motif || null, montant: Number(f.montant),
      mode_paiement: f.mode_paiement || null, compte_id: f.compte_id || null }).subscribe({
      next: () => { this.edition.set(null); this.fini(); }, error: (e) => this.echec(e) });
  }
  supprimer(etatId: string, ligneId: string): void {
    if (!confirm('Retirer cette charge de l’état ?')) return;
    this.api.supprimerLigneCharge(etatId, ligneId).subscribe({ next: () => this.fini(), error: (e) => this.echec(e) });
  }
  ajouterLigne(etatId: string): void {
    const a = this.ajout;
    this.enCours.set(true);
    this.api.ajouterLigneCharge(etatId, { libelle: a.libelle, categorie: a.categorie, type: 'ponctuelle', montant: Number(a.montant || 0),
      observation: a.observation || null, mode_paiement: a.mode_paiement || null, compte_id: a.compte_id || null }).subscribe({
      next: () => { this.ajout = this.ligneVide(); this.fini(); }, error: (e) => this.echec(e) });
  }

  nouveauModele(): void { this.modele = this.modeleVide(); this.modeleEnEdition.set(null); }
  editerModele(m: any): void {
    this.modele = { libelle: m.libelle, categorie: m.categorie, type: m.type, montant_habituel: Number(m.montant_habituel), montant_variable: m.montant_variable,
      periodicite: m.periodicite, mois_echeance: m.mois_echeance ?? 1, mode_paiement: m.mode_paiement ?? '', compte_id: m.compte_id ?? '', references: {} };
    this.modeleEnEdition.set(m.id);
  }
  enregistrerModele(): void {
    const m = this.modele;
    this.enCours.set(true);
    this.api.enregistrerModeleCharge({ libelle: m.libelle, categorie: m.categorie, type: m.type, montant_habituel: Number(m.montant_habituel || 0),
      montant_variable: !!m.montant_variable, periodicite: m.periodicite, mois_echeance: m.periodicite === 'mensuelle' ? null : Number(m.mois_echeance),
      mode_paiement: m.mode_paiement || null, compte_id: m.compte_id || null }, this.modeleEnEdition() ?? undefined).subscribe({
      next: () => { this.nouveauModele(); this.erreur.set(''); this.enCours.set(false); this.chargerModeles(); }, error: (e) => this.echec(e) });
  }
  retirerModele(id: string): void {
    if (!confirm('Retirer cette charge du catalogue ? Les états déjà préparés ne changent pas.')) return;
    this.api.retirerModeleCharge(id).subscribe({ next: () => this.chargerModeles(), error: (e) => this.echec(e) });
  }
}
