import { Component, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Dossier } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

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
        <label>Montant HT
          <input type="number" [(ngModel)]="montantHt" name="ht" />
        </label>
        <label>Devise
          <select [(ngModel)]="devise" name="devise">
            <option value="XOF">FCFA (XOF)</option>
            <option value="EUR">Euro (EUR) — parité fixe 655,957</option>
            <option value="USD">Dollar (USD) — taux à saisir</option>
            <option value="GBP">Livre (GBP) — taux à saisir</option>
          </select>
        </label>
        @if (devise === 'USD' || devise === 'GBP') {
          <label>Taux vers XOF
            <input type="number" step="0.0001" [(ngModel)]="tauxApplique" name="taux" placeholder="ex. 610" />
          </label>
        }
        <label>TVA %
          <input type="number" [(ngModel)]="tva" name="tva" />
          <span class="hint">Par défaut : 18 % (client Mali) / 0 % (client hors Mali) — laisser vide pour appliquer ce défaut.</span>
        </label>
        <button class="btn" (click)="creer()" [disabled]="!dossierId || !montantHt">Émettre</button>
      </div>
      @if (message()) { <p class="ok-msg">{{ message() }}</p> }
      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
    </section>

    <section class="panel">
      <h3>Facturer les temps</h3>
      <p class="desc">Sélectionne un dossier pour lister les temps facturables pas encore rattachés à une facture, puis coche ceux à inclure. Le montant HT est calculé automatiquement (durée × taux horaire) — uniquement en FCFA (le taux horaire est toujours enregistré en XOF).</p>
      <div class="form">
        <label>Dossier
          <select [(ngModel)]="dossierTempsId" name="dossierTemps" (ngModelChange)="chargerTempsNonFactures()">
            <option value="">— choisir —</option>
            @for (d of dossiers(); track d.id) {
              <option [value]="d.id">{{ d.numero }} — {{ d.intitule }}</option>
            }
          </select>
        </label>
        <label>Mode
          <select [(ngModel)]="modeTemps" name="modeTemps">
            <option value="temps_passe">Temps passé</option>
            <option value="forfait">Forfait</option>
          </select>
        </label>
      </div>
      @if (tempsNonFactures().length) {
        <table>
          <tr><th></th><th>Date</th><th>Auteur</th><th>Durée</th><th>Taux horaire</th><th>Montant HT</th><th>Description</th></tr>
          @for (t of tempsNonFactures(); track t.id) {
            <tr>
              <td><input type="checkbox" [checked]="tempsSelectionnes().has(t.id)" (change)="basculerTemps(t.id)" /></td>
              <td>{{ t.date_saisie | date:'dd/MM/yyyy' }}</td>
              <td>{{ t.auteur }}</td>
              <td>{{ t.duree_minutes }} min</td>
              <td>{{ t.taux_horaire | number }} FCFA/h</td>
              <td>{{ montantTemps(t) | number }} FCFA</td>
              <td>{{ t.description || '—' }}</td>
            </tr>
          }
        </table>
        <p><strong>Total sélectionné : {{ totalTempsSelectionnes() | number }} FCFA</strong></p>
        <button class="btn" (click)="facturerTemps()" [disabled]="!tempsSelectionnes().size">Émettre la facture</button>
      } @else if (dossierTempsId) {
        <p class="muted">Aucun temps facturable en attente pour ce dossier.</p>
      }
    </section>

    <section class="panel">
      <h3>Factures impayées</h3>
      @if (impayees().length) {
        <table>
          <tr><th>N°</th><th>Client</th><th>Reste dû</th><th>Échéance</th><th>Encaisser</th></tr>
          @for (f of impayees(); track f.id) {
            <tr>
              <td>{{ f.numero }}</td><td>{{ f.client }}</td>
              <td>{{ f.reste | number }} {{ f.devise }}</td>
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
          <tr><th>N°</th><th>Client</th><th>Mode</th><th>HT</th><th>TTC</th><th>Contre-valeur FCFA</th><th>Statut</th><th></th></tr>
          @for (f of factures(); track f.id) {
            <tr>
              <td>{{ f.numero }}</td><td>{{ f.client }}</td><td>{{ f.mode }}</td>
              <td>{{ f.montant_ht | number }} {{ f.devise }}</td>
              <td>{{ f.montant_ttc | number }} {{ f.devise }}</td>
              <td>{{ f.devise !== 'XOF' ? (f.montant_ttc_xof | number) + ' FCFA' : '—' }}</td>
              <td><span class="tag" [class.haute]="f.statut !== 'payee'">{{ f.statut }}</span></td>
              <td>
                @if (auth.peut('factures.annuler') && f.statut === 'emise') {
                  <button class="lien" (click)="annuler(f)">Annuler</button>
                }
              </td>
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
    .hint{font-weight:400;color:var(--slate);font-size:11px;white-space:normal;max-width:220px}
    .desc{font-size:12px;color:var(--slate);max-width:640px;margin:0 0 10px}
  `],
})
export class FacturationComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);

  readonly dossiers = signal<Dossier[]>([]);
  readonly factures = signal<any[]>([]);
  readonly impayees = signal<any[]>([]);
  readonly message = signal('');
  readonly erreur = signal('');

  dossierId = '';
  mode = 'temps_passe';
  montantHt: number | null = null;
  devise = 'XOF';
  tauxApplique: number | null = null;
  // Laissé vide par défaut : le backend applique alors 18% (client Mali) ou
  // 0% (client hors Mali) selon la localisation — voir factures.js.
  tva: number | null = null;

  // Facturer les temps
  readonly tempsNonFactures = signal<any[]>([]);
  readonly tempsSelectionnes = signal<Set<string>>(new Set());
  dossierTempsId = '';
  modeTemps = 'temps_passe';

  ngOnInit(): void {
    this.api.dossiers().subscribe({ next: (d) => this.dossiers.set(d), error: () => {} });
    this.rafraichir();
  }

  rafraichir(): void {
    this.api.factures().subscribe({ next: (f) => this.factures.set(f), error: () => {} });
    this.api.facturesImpayees().subscribe({ next: (f) => this.impayees.set(f), error: () => {} });
    if (this.dossierTempsId) this.chargerTempsNonFactures();
  }

  chargerTempsNonFactures(): void {
    this.tempsSelectionnes.set(new Set());
    if (!this.dossierTempsId) { this.tempsNonFactures.set([]); return; }
    this.api.tempsNonFactures(this.dossierTempsId).subscribe({
      next: (t) => this.tempsNonFactures.set(t),
      error: () => this.tempsNonFactures.set([]),
    });
  }

  montantTemps(t: any): number {
    return Math.round((Number(t.duree_minutes) / 60) * Number(t.taux_horaire));
  }

  basculerTemps(id: string): void {
    const s = new Set(this.tempsSelectionnes());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.tempsSelectionnes.set(s);
  }

  totalTempsSelectionnes(): number {
    return this.tempsNonFactures()
      .filter((t) => this.tempsSelectionnes().has(t.id))
      .reduce((somme, t) => somme + this.montantTemps(t), 0);
  }

  facturerTemps(): void {
    this.message.set(''); this.erreur.set('');
    this.api.creerFacture({
      dossier_id: this.dossierTempsId,
      mode: this.modeTemps,
      temps_ids: Array.from(this.tempsSelectionnes()),
    }).subscribe({
      next: (f) => { this.message.set(`Facture ${f.numero} émise (TTC ${f.montant_ttc} ${f.devise}).`); this.rafraichir(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Émission impossible'),
    });
  }

  annuler(f: any): void {
    if (!confirm(`Annuler la facture ${f.numero} ? Cette action est irréversible.`)) return;
    this.erreur.set('');
    this.api.annulerFacture(f.id).subscribe({
      next: () => this.rafraichir(),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Annulation impossible'),
    });
  }

  creer(): void {
    this.message.set(''); this.erreur.set('');
    const payload: any = {
      dossier_id: this.dossierId,
      mode: this.mode,
      montant_ht: this.montantHt,
      devise: this.devise,
    };
    if (this.tva !== null) payload.taux_tva = this.tva;
    if ((this.devise === 'USD' || this.devise === 'GBP') && this.tauxApplique) payload.taux_applique = this.tauxApplique;
    this.api.creerFacture(payload).subscribe({
      next: (f) => { this.message.set(`Facture ${f.numero} émise (TTC ${f.montant_ttc} ${f.devise}).`); this.montantHt = null; this.tauxApplique = null; this.rafraichir(); },
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
