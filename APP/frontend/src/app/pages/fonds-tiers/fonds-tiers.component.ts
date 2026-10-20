import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, MoyenPaiement } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ClientPickerComponent } from '../../core/client-picker.component';
import { MenuActionsComponent, ActionMenuItem } from '../../core/menu-actions.component';
import { ReglementFormComponent } from '../../core/reglement-form.component';

type TypeMouvement = 'reception' | 'reversement' | 'imputation';

// Fonds de tiers — compte CARPA du cabinet (20/10/2026) : sommes reçues pour le
// compte de clients et destinées à les désintéresser. Ce ne sont pas des
// honoraires : une réception n'est jamais un paiement de facture, elle n'entre
// pas dans le chiffre d'affaires. Le solde est calculé sur les mouvements.
@Component({
  selector: 'app-fonds-tiers',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, ClientPickerComponent, MenuActionsComponent, ReglementFormComponent],
  template: `
    <header class="page-head">
      <div>
        <h1>Fonds de tiers (CARPA)</h1>
        <p>Sommes reçues sur le compte CARPA pour le compte de clients, à leur reverser. Ce ne sont pas des honoraires : elles ne comptent pas dans le chiffre d'affaires.</p>
      </div>
      @if (auth.peut('fonds_tiers.enregistrer')) {
        <button class="btn" (click)="ouvrir('reception')">+ Enregistrer une réception</button>
      }
    </header>

    <div class="kpis">
      <div class="kpi"><div class="n">{{ totalDetenu() | number }}</div><div class="l">FCFA détenus pour des clients</div></div>
      <div class="kpi"><div class="n">{{ clientsConcernes() }}</div><div class="l">Clients avec un solde</div></div>
    </div>

    @if (action(); as a) {
      <section class="panel">
        <h3>{{ a === 'reception' ? 'Enregistrer une réception' : a === 'reversement' ? 'Reverser au client' : 'Imputer des honoraires sur les fonds' }}</h3>
        @if (a === 'imputation') {
          <p class="muted">À faire avec l'accord du client : la somme quitte la CARPA pour le compte de fonctionnement et règle une facture.</p>
        }
        <div class="grid2">
          <div class="col2"><label>Client</label>
            <app-client-picker [valeur]="form.client_id" [nomInitial]="form.client_nom" (valeurChange)="choisirClient($event)" />
          </div>
          <div><label>Dossier (facultatif)</label>
            <select class="in" [(ngModel)]="form.dossier_id" name="ftDossier">
              <option value="">— aucun —</option>
              @for (d of dossiersClient(); track d.id) { <option [value]="d.id">{{ d.numero }} — {{ d.intitule }}</option> }
            </select>
          </div>
          <div><label>Montant (FCFA)</label><input class="in" type="number" min="1" [(ngModel)]="form.montant" name="ftMontant" /></div>
          <div><label>Date</label><input class="in" type="date" [(ngModel)]="form.date_mouvement" name="ftDate" /></div>
          @if (a !== 'imputation') {
            <div><label>{{ a === 'reception' ? 'Payeur (qui a versé les fonds)' : 'Bénéficiaire' }}</label><input class="in" [(ngModel)]="form.tiers" name="ftTiers" /></div>
            <app-reglement-form [sens]="a === 'reception' ? 'encaissement' : 'decaissement'" [carpa]="true" [modele]="rg"
                                [catalogue]="a === 'reception' ? catReception() : catReversement()" (validite)="rgValide.set($event)"></app-reglement-form>
          } @else {
            <div class="col2"><label>Facture à régler</label>
              <select class="in" [(ngModel)]="form.facture_id" name="ftFacture">
                <option value="">— choisir —</option>
                @for (f of facturesClient(); track f.id) { <option [value]="f.id">{{ f.numero }} — reste {{ f.reliquat | number }} FCFA</option> }
              </select>
            </div>
            <div><label>Compte de fonctionnement qui reçoit</label>
              <select class="in" [(ngModel)]="form.compte_id" name="ftCompte">
                <option value="">— choisir —</option>
                @for (c of comptesFonct(); track c.id) { <option [value]="c.id">{{ c.intitule }}</option> }
              </select>
            </div>
            <div><label>N° de l'opération (facultatif)</label><input class="in" [(ngModel)]="form.numero_operation" name="ftOp" /></div>
          }
          <div class="col2"><label>Motif / note (facultatif)</label><input class="in" [(ngModel)]="form.motif" name="ftMotif" /></div>
        </div>
        <div class="btns">
          <button class="btn" (click)="enregistrer()" [disabled]="!peutEnregistrer() || enCours()">{{ enCours() ? 'Enregistrement…' : 'Enregistrer' }}</button>
          <button class="lien" (click)="fermer()">Annuler</button>
        </div>
        @if (erreur()) { <p class="err">{{ erreur() }}</p> }
      </section>
    }
    @if (message()) { <p class="ok-msg">{{ message() }}</p> }

    <section class="panel">
      <h3>Soldes par client</h3>
      @if (soldes().length) {
        <div class="table-scroll">
          <table>
            <tr><th>Client</th><th>Dossier</th><th>Reçu</th><th>Reversé / imputé</th><th>Solde</th><th>Dernier mouvement</th><th></th></tr>
            @for (l of soldes(); track l.client_id + '|' + (l.dossier_id ?? '')) {
              <tr>
                <td>{{ l.client }}</td>
                <td>{{ l.dossier_numero ? l.dossier_numero + ' — ' + l.dossier_intitule : '—' }}</td>
                <td>{{ l.recu | number }}</td>
                <td>{{ l.sorti | number }}</td>
                <td><b>{{ l.solde | number }}</b> FCFA</td>
                <td>{{ l.dernier | date:'dd/MM/yyyy' }}</td>
                <td><app-menu-actions [actions]="actionsPour(l)" /></td>
              </tr>
            }
          </table>
        </div>
      } @else { <p class="muted">Aucun fonds de tiers enregistré.</p> }
    </section>

    <section class="panel">
      <h3>Mouvements @if (filtreClient()) { <button class="lien" (click)="voirTous()">Voir tous les clients</button> }</h3>
      @if (mouvements().length) {
        <div class="table-scroll">
          <table>
            <tr><th>Date</th><th>Type</th><th>Client / dossier</th><th>Montant</th><th>Moyen et compte</th><th>Tiers / facture</th><th>Par</th><th></th></tr>
            @for (m of mouvements(); track m.id) {
              <tr [class.annule]="m.statut === 'annule'">
                <td>{{ m.date_mouvement | date:'dd/MM/yyyy' }}</td>
                <td>{{ libelleType(m.type) }}@if (m.statut === 'annule') { <span class="tag haute" [title]="m.annule_motif || ''">Annulé</span> }</td>
                <td>{{ m.client }}@if (m.dossier_numero) { <br /><span class="muted">{{ m.dossier_numero }}</span> }</td>
                <td>{{ m.type === 'reception' ? '+' : '−' }}{{ m.montant | number }}</td>
                <td>{{ m.mode ? libelleMoyen(m.mode) : '—' }}@if (m.compte) { <br /><span class="muted">{{ m.compte }}</span> }@if (resume(m)) { <br /><span class="muted">{{ resume(m) }}</span> }</td>
                <td>{{ m.facture_numero ? 'Facture ' + m.facture_numero : (m.tiers || '—') }}@if (m.motif) { <br /><span class="muted">{{ m.motif }}</span> }</td>
                <td>{{ m.auteur || '—' }}</td>
                <td>@if (m.statut === 'valide' && auth.peut('fonds_tiers.reverser')) { <button class="lien" (click)="annuler(m)">Annuler</button> }</td>
              </tr>
            }
          </table>
        </div>
      } @else { <p class="muted">Aucun mouvement.</p> }
    </section>
  `,
  styles: [`
    .kpis{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:16px}
    .kpi{background:var(--panel,#fff);border:1px solid var(--line);border-left:4px solid var(--gold);border-radius:10px;padding:14px 20px;min-width:220px}
    .kpi .n{font-size:var(--fs-xl);font-weight:600}
    .kpi .l{color:var(--slate);font-size:var(--fs-sm)}
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md)}
    label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:760px}
    .col2{grid-column:1 / -1}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .btns{display:flex;gap:12px;align-items:center;margin-top:12px}
    tr.annule td{opacity:.55;text-decoration:line-through}
    tr.annule td:last-child{text-decoration:none}
    .tag.haute{background:#fbe6e5;color:#b13a36;margin-left:6px}
    .ok-msg{color:#157a4f;font-weight:600}
  `],
})
export class FondsTiersComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);

  readonly soldes = signal<any[]>([]);
  readonly mouvements = signal<any[]>([]);
  readonly filtreClient = signal<string | null>(null);
  readonly catReception = signal<MoyenPaiement[]>([]);
  readonly catReversement = signal<MoyenPaiement[]>([]);
  readonly comptesFonct = signal<{ id: string; intitule: string }[]>([]);
  readonly dossiersClient = signal<any[]>([]);
  readonly facturesClient = signal<any[]>([]);
  readonly action = signal<TypeMouvement | null>(null);
  readonly enCours = signal(false);
  readonly erreur = signal('');
  readonly message = signal('');
  readonly rgValide = signal(false);
  form: any = {};
  rg: any = {};

  readonly totalDetenu = computed(() => this.soldes().reduce((s, l) => s + l.solde, 0));
  readonly clientsConcernes = computed(() => new Set(this.soldes().filter((l) => l.solde > 0).map((l) => l.client_id)).size);

  ngOnInit(): void {
    this.charger();
    this.api.fondsTiersMoyens('reception').subscribe({ next: (m) => this.catReception.set(m), error: () => {} });
    this.api.fondsTiersMoyens('reversement').subscribe({ next: (m) => this.catReversement.set(m), error: () => {} });
    this.api.comptesBancaires().subscribe({ next: (c) => this.comptesFonct.set(c.filter((x) => x.type === 'fonctionnement')), error: () => {} });
  }

  charger(): void {
    this.api.fondsTiersSoldes().subscribe({ next: (s) => this.soldes.set(s), error: () => {} });
    this.api.fondsTiersMouvements(this.filtreClient() ?? undefined).subscribe({ next: (m) => this.mouvements.set(m), error: () => {} });
  }

  private readonly libellesType: Record<string, string> = { reception: 'Réception', reversement: 'Reversement', imputation: "Imputation d'honoraires" };
  libelleType(t: string): string { return this.libellesType[t] ?? t; }
  libelleMoyen(code: string): string {
    return [...this.catReception(), ...this.catReversement()].find((m) => m.code === code)?.libelle ?? code;
  }
  resume(m: any): string {
    const refs = m.references_paiement ?? {};
    return Object.keys(refs).filter((k) => k !== 'origine').map((k) => refs[k]).join(' · ');
  }

  actionsPour(l: any): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];
    if (this.auth.peut('fonds_tiers.enregistrer')) items.push({ label: 'Enregistrer une réception', action: () => this.ouvrir('reception', l) });
    if (this.auth.peut('fonds_tiers.reverser') && l.solde > 0) {
      items.push({ label: 'Reverser au client', action: () => this.ouvrir('reversement', l) });
      items.push({ label: 'Imputer des honoraires', action: () => this.ouvrir('imputation', l) });
    }
    items.push({ label: 'Voir les mouvements', action: () => { this.filtreClient.set(l.client_id); this.charger(); } });
    return items;
  }

  voirTous(): void { this.filtreClient.set(null); this.charger(); }

  ouvrir(type: TypeMouvement, ligne?: any): void {
    this.erreur.set(''); this.message.set('');
    this.form = { client_id: ligne?.client_id ?? '', client_nom: ligne?.client ?? '', dossier_id: ligne?.dossier_id ?? '', montant: null, date_mouvement: '', tiers: '', motif: '', facture_id: '', compte_id: '', numero_operation: '' };
    this.rg = { mode: '', references: {}, compte_id: '' };
    this.rgValide.set(false);
    this.dossiersClient.set([]); this.facturesClient.set([]);
    if (ligne?.client_id) this.chargerClient(ligne.client_id);
    this.action.set(type);
  }
  fermer(): void { this.action.set(null); }

  choisirClient(id: string | null): void {
    this.form.client_id = id ?? '';
    this.form.dossier_id = ''; this.form.facture_id = '';
    this.dossiersClient.set([]); this.facturesClient.set([]);
    if (id) this.chargerClient(id);
  }
  private chargerClient(id: string): void {
    this.api.dossiers('', { client_id: id }).subscribe({ next: (d) => this.dossiersClient.set(d), error: () => {} });
    this.api.factures('', { client_id: id }).subscribe({
      next: (f) => this.facturesClient.set(f.filter((x) => x.statut !== 'annulee' && Number(x.reliquat) > 0 && x.devise === 'XOF')),
      error: () => {},
    });
  }

  peutEnregistrer(): boolean {
    const f = this.form;
    if (!f.client_id || !(Number(f.montant) > 0)) return false;
    return this.action() === 'imputation' ? !!f.facture_id && !!f.compte_id : this.rgValide();
  }

  enregistrer(): void {
    const type = this.action();
    if (!type || this.enCours()) return;
    const f = this.form;
    const base: any = { client_id: f.client_id, dossier_id: f.dossier_id || undefined, montant: Number(f.montant), date_mouvement: f.date_mouvement || undefined, motif: f.motif || undefined };
    let appel;
    if (type === 'imputation') {
      appel = this.api.enregistrerFondsTiers('imputations', { ...base, facture_id: f.facture_id, compte_id: f.compte_id, numero_operation: f.numero_operation || undefined });
    } else {
      const corps = { ...base, tiers: f.tiers || undefined, mode: this.rg.mode, compte_id: this.rg.compte_id || undefined, references: this.rg.references };
      appel = this.api.enregistrerFondsTiers(type === 'reception' ? 'receptions' : 'reversements', corps);
    }
    this.erreur.set(''); this.enCours.set(true);
    appel.subscribe({
      next: (r) => {
        this.enCours.set(false);
        this.message.set(`${this.libelleType(type)} enregistré(e) — solde : ${Number(r.solde).toLocaleString('fr-FR')} FCFA.`);
        this.action.set(null);
        this.charger();
      },
      error: (e) => { this.enCours.set(false); this.erreur.set(e?.error?.error ?? 'Enregistrement impossible.'); },
    });
  }

  annuler(m: any): void {
    const motif = window.prompt('Motif de l’annulation (obligatoire) :');
    if (!motif) return;
    this.erreur.set(''); this.message.set('');
    this.api.annulerFondsTiers(m.id, motif).subscribe({
      next: () => { this.message.set('Mouvement annulé.'); this.charger(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Annulation impossible.'),
    });
  }
}
