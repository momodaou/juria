import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-depenses',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule],
  template: `
    <header class="page-head">
      <div>
        <h1>Dépenses &amp; caisse</h1>
        <p>Charges du cabinet, petite caisse, vignettes de plaidoirie — circuit soumise → validée → décaissée.</p>
      </div>
      <button class="btn" (click)="afficherForm.set(!afficherForm())">
        {{ afficherForm() ? 'Annuler' : '+ Nouvelle dépense' }}
      </button>
    </header>

    <div class="kpis">
      <div class="kpi">
        <div class="n">{{ caisse()?.dotation ?? 0 | number }}</div>
        <div class="l">Dotation petite caisse ({{ moisCourant.slice(0,7) }})</div>
      </div>
      <div class="kpi amber">
        <div class="n">{{ caisse()?.depense ?? 0 | number }}</div>
        <div class="l">Dépensé ce mois</div>
      </div>
      <div class="kpi" [class.red]="(caisse()?.solde ?? 0) < 0" [class.green]="(caisse()?.solde ?? 0) >= 0">
        <div class="n">{{ caisse()?.solde ?? 0 | number }}</div>
        <div class="l">Solde caisse</div>
      </div>
      <div class="kpi blue">
        <div class="n">{{ stockVignettes() }}</div>
        <div class="l">Vignettes en stock</div>
      </div>
    </div>

    @if (afficherForm()) {
      <section class="panel">
        <h3>Nouvelle dépense</h3>
        <div class="grid2">
          <div>
            <label>Type</label>
            <select class="in" [(ngModel)]="form.type" name="type">
              <option value="ponctuelle">Ponctuelle</option>
              <option value="fixe">Fixe (charge récurrente)</option>
            </select>
          </div>
          <div>
            <label>Catégorie</label>
            <select class="in" [(ngModel)]="form.categorie" name="categorie">
              <option value="loyer">Loyer</option><option value="eau">Eau</option>
              <option value="electricite">Électricité</option><option value="nettoyage">Nettoyage</option>
              <option value="carburant">Carburant</option><option value="telephonie">Téléphonie</option>
              <option value="internet">Internet</option><option value="consommables">Consommables</option>
              <option value="fournitures">Fournitures</option><option value="deplacement">Déplacement</option>
              <option value="hebergement">Hébergement</option><option value="restauration">Restauration</option>
              <option value="entretien">Entretien</option><option value="vignette_plaidoirie">Vignette de plaidoirie</option>
              <option value="frais_procedure">Frais de procédure</option><option value="autre">Autre</option>
            </select>
          </div>
          <div class="col2"><label>Libellé</label><input class="in" [(ngModel)]="form.libelle" name="libelle" /></div>
          <div><label>Montant (FCFA)</label><input class="in" type="number" [(ngModel)]="form.montant" name="montant" /></div>
          <div><label>Date</label><input class="in" type="date" [(ngModel)]="form.date_depense" name="date" /></div>
          <div>
            <label>Compte</label>
            <select class="in" [(ngModel)]="form.compte_id" name="compte">
              <option value="">—</option>
              @for (c of comptes(); track c.id) { <option [value]="c.id">{{ c.intitule }}</option> }
            </select>
          </div>
          <div>
            <label>Mode de paiement</label>
            <select class="in" [(ngModel)]="form.mode_paiement" name="mode">
              <option value="">—</option>
              <option value="virement">Virement</option><option value="especes">Espèces</option>
              <option value="cheque">Chèque</option><option value="orange_money">Orange Money</option>
              <option value="wave">Wave</option><option value="moov_money">Moov Money</option>
            </select>
          </div>
          <div class="col2 checks">
            <label><input type="checkbox" [(ngModel)]="form.petite_caisse" name="pc" /> Sur petite caisse</label>
            <label><input type="checkbox" [(ngModel)]="form.justificatif" name="just" /> Justificatif disponible</label>
            <label><input type="checkbox" [(ngModel)]="form.refacturable_client" name="refact" /> Débours refacturable au client</label>
          </div>
        </div>
        <button class="btn" (click)="creer()" [disabled]="!form.libelle || !form.montant">Soumettre</button>
        @if (erreur()) { <p class="err">{{ erreur() }}</p> }
      </section>
    }

    <section class="panel">
      <div class="filtres">
        <select class="in filtre" [(ngModel)]="filtreStatut" (ngModelChange)="charger()">
          <option value="">Tous statuts</option>
          <option value="soumise">Soumise</option>
          <option value="validee">Validée</option>
          <option value="rejetee">Rejetée</option>
          <option value="decaissee">Décaissée</option>
        </select>
        <select class="in filtre" [(ngModel)]="filtreType" (ngModelChange)="charger()">
          <option value="">Tous types</option>
          <option value="fixe">Fixe</option>
          <option value="ponctuelle">Ponctuelle</option>
        </select>
      </div>
      @if (depenses().length) {
        <table>
          <tr><th>Date</th><th>Libellé</th><th>Catégorie</th><th>Montant</th><th>Dossier</th><th>Statut</th><th></th></tr>
          @for (d of depenses(); track d.id) {
            <tr>
              <td>{{ d.date_depense | date:'dd/MM/yyyy' }}</td>
              <td>{{ d.libelle }} @if (d.petite_caisse) { <span class="tag">petite caisse</span> }</td>
              <td>{{ d.categorie }}</td>
              <td>{{ d.montant | number }} FCFA</td>
              <td>{{ d.dossier_numero || '—' }}</td>
              <td><span class="tag" [class.ok]="d.statut==='decaissee'" [class.haute]="d.statut==='rejetee'">{{ d.statut }}</span></td>
              <td>
                @if (d.statut === 'soumise' && auth.peut('depenses.decision')) {
                  <button class="lien" (click)="decision(d, 'validee')">Valider</button>
                  <button class="lien" (click)="decision(d, 'rejetee')">Rejeter</button>
                }
                @if (d.statut === 'validee' && auth.peut('depenses.decaisser')) { <button class="lien" (click)="decaisser(d)">Décaisser</button> }
              </td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucune dépense.</p> }
    </section>

    @if (auth.peut('depenses.petite_caisse.doter')) {
      <section class="panel">
        <h3>Petite caisse — dotation mensuelle</h3>
        <div class="upload">
          <input class="sel" type="date" [(ngModel)]="dotationMois" name="dotationMois" />
          <input class="sel" type="number" [(ngModel)]="dotationMontant" name="dotationMontant" placeholder="Montant (FCFA)" />
          <button class="btn sm" (click)="definirDotation()">Enregistrer</button>
        </div>
      </section>
    }

    <section class="panel">
      <h3>Vignettes de plaidoirie</h3>
      <div class="upload">
        <select class="sel" [(ngModel)]="vignetteMouvement" name="vmouv">
          <option value="achat">Achat</option>
          <option value="utilisation">Utilisation</option>
        </select>
        <input class="sel" type="number" [(ngModel)]="vignetteQuantite" name="vqte" placeholder="Quantité" />
        <button class="btn sm" (click)="mouvementVignette()">Enregistrer</button>
      </div>
    </section>
  `,
  styles: [`
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:14px}
    .sel{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px}
    label{font-size:12px;color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:680px}
    .col2{grid-column:1 / -1}
    .checks{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
    .checks label{font-weight:400}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn.sm{padding:8px 12px;font-size:13px}
    .btn:disabled{opacity:.6}
    .filtres{display:flex;gap:10px;margin-bottom:14px}
    .filtre{width:auto;margin:0;max-width:180px}
    .lien{background:none;border:none;color:var(--gold);cursor:pointer;font-size:12.5px;padding:0;margin-right:10px}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    .tag.haute{background:#fbe6e5;color:#b13a36}
    .upload{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  `],
})
export class DepensesComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly depenses = signal<any[]>([]);
  readonly comptes = signal<any[]>([]);
  readonly caisse = signal<any | null>(null);
  readonly stockVignettes = signal(0);
  readonly afficherForm = signal(false);
  readonly erreur = signal('');

  filtreStatut = '';
  filtreType = '';
  form: any = { type: 'ponctuelle', categorie: 'autre' };
  moisCourant = new Date().toISOString().slice(0, 8) + '01';
  dotationMois = this.moisCourant;
  dotationMontant: number | null = null;
  vignetteMouvement: 'achat' | 'utilisation' = 'achat';
  vignetteQuantite: number | null = null;

  ngOnInit(): void {
    this.charger();
    this.api.comptesBancaires().subscribe({ next: (c) => this.comptes.set(c) });
    this.chargerCaisse();
    this.api.stockVignettes().subscribe({ next: (v) => this.stockVignettes.set(v.stock) });
  }

  charger(): void {
    this.api.depenses({ statut: this.filtreStatut, type: this.filtreType }).subscribe({ next: (d) => this.depenses.set(d) });
  }

  chargerCaisse(): void {
    this.api.petiteCaisse(this.moisCourant).subscribe({ next: (c) => this.caisse.set(c) });
  }

  creer(): void {
    this.erreur.set('');
    this.api.creerDepense(this.form).subscribe({
      next: () => {
        this.afficherForm.set(false);
        this.form = { type: 'ponctuelle', categorie: 'autre' };
        this.charger();
        this.chargerCaisse();
      },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Soumission impossible.'),
    });
  }

  decision(d: any, statut: 'validee' | 'rejetee'): void {
    this.api.decisionDepense(d.id, { statut }).subscribe({
      next: () => this.charger(),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Décision impossible (rôle gérant requis).'),
    });
  }

  decaisser(d: any): void {
    this.api.decaisserDepense(d.id).subscribe({
      next: () => { this.charger(); this.chargerCaisse(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Décaissement impossible.'),
    });
  }

  definirDotation(): void {
    if (!this.dotationMontant) return;
    this.api.definirDotationCaisse(this.dotationMois, this.dotationMontant).subscribe({
      next: () => { this.dotationMontant = null; this.chargerCaisse(); },
    });
  }

  mouvementVignette(): void {
    if (!this.vignetteQuantite) return;
    this.api.mouvementVignettes({ mouvement: this.vignetteMouvement, quantite: this.vignetteQuantite }).subscribe({
      next: () => { this.vignetteQuantite = null; this.api.stockVignettes().subscribe({ next: (v) => this.stockVignettes.set(v.stock) }); },
    });
  }
}
