import { Component, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Dossier } from '../../core/api.service';

@Component({
  selector: 'app-facturation',
  standalone: true,
  imports: [DecimalPipe, DatePipe, FormsModule],
  template: `
    <header class="page-head"><h1>Facturation</h1></header>

    <section class="panel">
      <h3>Nouvelle facture</h3>
      <div class="form">
        <label>Dossier
          <select [(ngModel)]="dossierId" name="dossier">
            <option value="">— choisir —</option>
            @for (d of dossiers(); track d.id) {
              <option [value]="d.id">{{ d.numero }} — {{ d.intitule }}</option>
            }
          </select>
        </label>
        <label>Mode
          <select [(ngModel)]="mode" name="mode">
            <option value="temps_passe">Temps passé</option>
            <option value="forfait">Forfait</option>
            <option value="success_fee">Success fee</option>
            <option value="abonnement">Abonnement</option>
            <option value="consultation">Consultation</option>
          </select>
        </label>
        <label>Montant HT (FCFA)
          <input type="number" [(ngModel)]="montantHt" name="ht" />
        </label>
        <label>TVA %
          <input type="number" [(ngModel)]="tva" name="tva" />
        </label>
        <button class="btn" (click)="creer()" [disabled]="!dossierId || !montantHt">Émettre</button>
      </div>
      @if (message()) { <p class="ok-msg">{{ message() }}</p> }
      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
    </section>

    <section class="panel">
      <h3>Factures impayées</h3>
      @if (impayees().length) {
        <table>
          <tr><th>N°</th><th>Client</th><th>Reste dû (FCFA)</th><th>Échéance</th><th>Encaisser</th></tr>
          @for (f of impayees(); track f.id) {
            <tr>
              <td>{{ f.numero }}</td><td>{{ f.client }}</td>
              <td>{{ f.reste | number }}</td>
              <td>{{ f.date_echeance ? (f.date_echeance | date:'dd/MM/yyyy') : '—' }}</td>
              <td><button class="lien" (click)="encaisser(f)">Marquer payé</button></td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucun impayé.</p> }
    </section>

    <section class="panel">
      <h3>Toutes les factures</h3>
      @if (factures().length) {
        <table>
          <tr><th>N°</th><th>Client</th><th>Mode</th><th>HT</th><th>TTC</th><th>Statut</th></tr>
          @for (f of factures(); track f.id) {
            <tr>
              <td>{{ f.numero }}</td><td>{{ f.client }}</td><td>{{ f.mode }}</td>
              <td>{{ f.montant_ht | number }}</td><td>{{ f.montant_ttc | number }}</td>
              <td><span class="tag" [class.haute]="f.statut !== 'payee'">{{ f.statut }}</span></td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucune facture.</p> }
    </section>
  `,
  styles: [`
    .form{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end}
    .form label{display:flex;flex-direction:column;font-size:12px;color:var(--slate);font-weight:600;gap:4px}
    .form input,.form select{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;min-width:150px}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .lien{background:none;border:none;color:var(--gold);cursor:pointer;font-size:13px;padding:0}
    .ok-msg{color:var(--green);font-size:13px;margin-top:10px}
  `],
})
export class FacturationComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly dossiers = signal<Dossier[]>([]);
  readonly factures = signal<any[]>([]);
  readonly impayees = signal<any[]>([]);
  readonly message = signal('');
  readonly erreur = signal('');

  dossierId = '';
  mode = 'temps_passe';
  montantHt: number | null = null;
  tva = 18;

  ngOnInit(): void {
    this.api.dossiers().subscribe({ next: (d) => this.dossiers.set(d), error: () => {} });
    this.rafraichir();
  }

  rafraichir(): void {
    this.api.factures().subscribe({ next: (f) => this.factures.set(f), error: () => {} });
    this.api.facturesImpayees().subscribe({ next: (f) => this.impayees.set(f), error: () => {} });
  }

  creer(): void {
    this.message.set(''); this.erreur.set('');
    this.api.creerFacture({
      dossier_id: this.dossierId,
      mode: this.mode,
      montant_ht: this.montantHt,
      taux_tva: this.tva,
    }).subscribe({
      next: (f) => { this.message.set(`Facture ${f.numero} émise (TTC ${f.montant_ttc} FCFA).`); this.montantHt = null; this.rafraichir(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Émission impossible'),
    });
  }

  encaisser(f: any): void {
    this.api.ajouterPaiement(f.id, { montant: f.reste, mode: 'virement' }).subscribe({
      next: () => this.rafraichir(),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Paiement impossible'),
    });
  }
}
