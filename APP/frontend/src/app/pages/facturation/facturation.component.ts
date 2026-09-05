import { Component, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Dossier } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DocumentPreviewService } from '../../core/document-preview.service';
import { ClientPickerComponent } from '../../core/client-picker.component';

@Component({
  selector: 'app-facturation',
  standalone: true,
  imports: [DecimalPipe, DatePipe, FormsModule, ClientPickerComponent],
  template: `
    <header class="page-head"><h1>Facturation</h1></header>

    <section class="panel">
      <h3>Nouvelle facture</h3>
      <div class="form">
        <label>Dossier
          <select [(ngModel)]="dossierId" name="dossier" (ngModelChange)="onDossierChange()">
            <option value="">— choisir —</option>
            <option value="__autre__">Autre (facturer un client sans dossier)</option>
            @for (d of dossiers(); track d.id) {
              <option [value]="d.id">{{ d.numero }} — {{ d.intitule }}</option>
            }
          </select>
        </label>
        @if (dossierId === '__autre__') {
          <label style="min-width:260px">Client
            <app-client-picker [valeur]="factureClientId" (valeurChange)="factureClientId = $event" />
          </label>
        }
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
        <label>Objet (facultatif)
          <input [(ngModel)]="objet" name="objet" placeholder="Pré-rempli depuis l'objet du dossier — modifiable" style="min-width:260px" />
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
        <label>Compte à créditer
          <select [(ngModel)]="compteReglementId" name="compte">
            <option value="">— non précisé —</option>
            @for (c of comptes(); track c.id) {
              <option [value]="c.id">{{ c.intitule }}{{ c.banque ? ' — ' + c.banque : '' }}</option>
            }
          </select>
        </label>
        <label>Mention (facultatif)
          <input [(ngModel)]="mention" name="mention" placeholder="ex. Frais de virement à la charge du client" style="min-width:260px" />
        </label>
        @if (auth.peut('factures.creer')) {
          <button class="btn" (click)="creer()" [disabled]="(dossierId === '__autre__' ? !factureClientId : !dossierId) || !montantHt">Émettre</button>
        }
      </div>
      @if (message()) { <p class="ok-msg">{{ message() }}</p> }
      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
    </section>

    <section class="panel">
      <h3>Facturer un dossier (temps + débours)</h3>
      <p class="desc">Sélectionne un dossier pour lister les temps facturables et les débours décaissés/refacturables pas encore rattachés à une facture, puis coche ce qui doit y figurer. Le montant est calculé automatiquement — uniquement en FCFA (temps et débours sont toujours enregistrés en XOF).</p>
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
        <label>Compte à créditer
          <select [(ngModel)]="compteReglementId" name="compteTemps">
            <option value="">— non précisé —</option>
            @for (c of comptes(); track c.id) {
              <option [value]="c.id">{{ c.intitule }}{{ c.banque ? ' — ' + c.banque : '' }}</option>
            }
          </select>
        </label>
        <label>Mention (facultatif)
          <input [(ngModel)]="mention" name="mentionTemps" placeholder="ex. Frais de virement à la charge du client" style="min-width:260px" />
        </label>
      </div>
      @if (tempsNonFactures().length) {
        <h4>Temps facturables</h4>
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
      }
      @if (deboursARefacturer().length) {
        <h4>Débours décaissés à refacturer</h4>
        <table>
          <tr><th></th><th>Date</th><th>Libellé</th><th>Montant</th></tr>
          @for (d of deboursARefacturer(); track d.id) {
            <tr>
              <td><input type="checkbox" [checked]="deboursSelectionnes().has(d.id)" (change)="basculerDebours(d.id)" /></td>
              <td>{{ d.date_depense | date:'dd/MM/yyyy' }}</td>
              <td>{{ d.libelle }}</td>
              <td>{{ d.montant | number }} FCFA</td>
            </tr>
          }
        </table>
      }
      @if (tempsNonFactures().length || deboursARefacturer().length) {
        <p>
          <strong>Honoraires sélectionnés : {{ totalTempsSelectionnes() | number }} FCFA</strong>
          @if (deboursARefacturer().length) { <strong> — Débours sélectionnés : {{ totalDeboursSelectionnes() | number }} FCFA</strong> }
        </p>
        @if (auth.peut('factures.creer')) {
          <button class="btn" (click)="facturerTemps()" [disabled]="!tempsSelectionnes().size && !deboursSelectionnes().size">Émettre la facture</button>
        }
      } @else if (dossierTempsId) {
        <p class="muted">Rien en attente de facturation pour ce dossier (ni temps facturable, ni débours décaissé refacturable).</p>
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
              <td>
                @if (auth.peut('factures.paiement.ajouter')) {
                  <button class="lien" (click)="encaisser(f)">Marquer payé</button>
                }
              </td>
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
              <td class="actions">
                <button class="lien" (click)="apercuPdf(f)">Aperçu</button>
                <button class="lien" (click)="ouvrirPdf(f)">Télécharger</button>
                @if (auth.peut('factures.annuler') && f.statut === 'emise') {
                  <button class="lien" (click)="commencerEdition(f)">Modifier</button>
                  <button class="lien" (click)="annuler(f)">Annuler</button>
                }
              </td>
            </tr>
            @if (editionId() === f.id) {
              <tr class="edition">
                <td colspan="8">
                  <div class="form">
                    <label>Objet
                      <input [(ngModel)]="edit.objet" [name]="'edObjet' + f.id" style="min-width:220px" />
                    </label>
                    <label>Montant HT
                      <input type="number" [(ngModel)]="edit.montant_ht" [name]="'edHt' + f.id" />
                    </label>
                    <label>Frais
                      <input type="number" [(ngModel)]="edit.montant_frais" [name]="'edFrais' + f.id" />
                    </label>
                    <label>Échéance
                      <input type="date" [(ngModel)]="edit.date_echeance" [name]="'edEch' + f.id" />
                    </label>
                    <label>Mention
                      <input [(ngModel)]="edit.mention" [name]="'edMention' + f.id" style="min-width:220px" />
                    </label>
                  </div>
                  <p class="hint">Correction possible tant qu'aucun paiement n'est encore enregistré sur cette facture.</p>
                  <button class="lien" (click)="enregistrerEdition(f)">Enregistrer</button>
                  <button class="lien" (click)="annulerEdition()">Annuler</button>
                </td>
              </tr>
            }
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
    .ok-msg{color:var(--green);font-size:13px;margin-top:10px}
    .hint{font-weight:400;color:var(--slate);font-size:11px;white-space:normal;max-width:220px}
    .desc{font-size:12px;color:var(--slate);max-width:640px;margin:0 0 10px}
    h4{margin:14px 0 6px;font-size:13px}
    .actions{display:flex;gap:10px;flex-wrap:wrap}
    .edition td{background:var(--light);padding:12px 14px}
  `],
})
export class FacturationComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly preview = inject(DocumentPreviewService);

  readonly dossiers = signal<Dossier[]>([]);
  readonly factures = signal<any[]>([]);
  readonly impayees = signal<any[]>([]);
  readonly comptes = signal<{ id: string; intitule: string; type: string; banque?: string }[]>([]);
  readonly message = signal('');
  readonly erreur = signal('');

  dossierId = '';
  // Choisi quand dossierId === '__autre__' (facturer un client sans dossier,
  // 05/09/2026 — POST /api/factures acceptait déjà client_id seul, cette
  // option manquait côté écran).
  factureClientId: string | null = null;
  mode = 'temps_passe';
  montantHt: number | null = null;
  // Objet propre à la facture (05/09/2026, diagnostic Facturation) — distinct
  // de l'objet du dossier lié, pré-rempli à sa sélection mais éditable.
  objet = '';
  devise = 'XOF';
  tauxApplique: number | null = null;
  // Laissé vide par défaut : le backend applique alors 18% (client Mali) ou
  // 0% (client hors Mali) selon la localisation — voir factures.js.
  tva: number | null = null;
  // Réglage/informations de paiement (28/08/2026, facture PDF enrichie) —
  // mode_reglement/compte_reglement_id/mention existaient déjà au schéma
  // depuis le 17/08/2026 mais n'étaient acceptés par aucune route avant ce
  // jour ; partagés entre les deux formulaires d'émission ci-dessous.
  compteReglementId = '';
  mention = '';

  // Facturer un dossier (temps + débours)
  readonly tempsNonFactures = signal<any[]>([]);
  readonly tempsSelectionnes = signal<Set<string>>(new Set());
  readonly deboursARefacturer = signal<any[]>([]);
  readonly deboursSelectionnes = signal<Set<string>>(new Set());
  dossierTempsId = '';
  modeTemps = 'temps_passe';

  // Correction d'une facture émise avant tout règlement (05/09/2026).
  readonly editionId = signal<string | null>(null);
  edit: any = {};

  ngOnInit(): void {
    this.api.dossiers().subscribe({ next: (d) => this.dossiers.set(d), error: () => {} });
    this.api.comptesBancaires().subscribe({ next: (c) => this.comptes.set(c), error: () => {} });
    this.rafraichir();
  }

  rafraichir(): void {
    this.api.factures().subscribe({ next: (f) => this.factures.set(f), error: () => {} });
    this.api.facturesImpayees().subscribe({ next: (f) => this.impayees.set(f), error: () => {} });
    if (this.dossierTempsId) this.chargerTempsNonFactures();
  }

  chargerTempsNonFactures(): void {
    this.tempsSelectionnes.set(new Set());
    this.deboursSelectionnes.set(new Set());
    if (!this.dossierTempsId) { this.tempsNonFactures.set([]); this.deboursARefacturer.set([]); return; }
    this.api.tempsNonFactures(this.dossierTempsId).subscribe({
      next: (t) => this.tempsNonFactures.set(t),
      error: () => this.tempsNonFactures.set([]),
    });
    this.api.depensesARefacturer(this.dossierTempsId).subscribe({
      next: (d) => this.deboursARefacturer.set(d),
      error: () => this.deboursARefacturer.set([]),
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

  basculerDebours(id: string): void {
    const s = new Set(this.deboursSelectionnes());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.deboursSelectionnes.set(s);
  }

  totalTempsSelectionnes(): number {
    return this.tempsNonFactures()
      .filter((t) => this.tempsSelectionnes().has(t.id))
      .reduce((somme, t) => somme + this.montantTemps(t), 0);
  }

  totalDeboursSelectionnes(): number {
    return this.deboursARefacturer()
      .filter((d) => this.deboursSelectionnes().has(d.id))
      .reduce((somme, d) => somme + Number(d.montant), 0);
  }

  // Injecte compte à créditer / mode de règlement / mention dans un payload
  // de création de facture — partagé par les deux formulaires d'émission.
  private ajouterInfosReglement(payload: any): void {
    if (this.compteReglementId) { payload.compte_reglement_id = this.compteReglementId; payload.mode_reglement = 'virement'; }
    if (this.mention) payload.mention = this.mention;
  }

  facturerTemps(): void {
    this.message.set(''); this.erreur.set('');
    const payload: any = { dossier_id: this.dossierTempsId, mode: this.modeTemps };
    if (this.tempsSelectionnes().size) payload.temps_ids = Array.from(this.tempsSelectionnes());
    if (this.deboursSelectionnes().size) payload.depense_ids = Array.from(this.deboursSelectionnes());
    this.ajouterInfosReglement(payload);
    this.api.creerFacture(payload).subscribe({
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

  // Pré-remplit l'objet de la nouvelle facture depuis celui du dossier
  // choisi — reste un champ libre ensuite (jamais recalculé après ce choix).
  onDossierChange(): void {
    if (this.dossierId === '__autre__') { this.objet = ''; this.factureClientId = null; return; }
    const d = this.dossiers().find((x) => x.id === this.dossierId);
    this.objet = d?.objet || '';
  }

  commencerEdition(f: any): void {
    this.erreur.set('');
    this.editionId.set(f.id);
    this.edit = {
      objet: f.objet || '',
      montant_ht: f.montant_ht,
      montant_frais: f.montant_frais,
      date_echeance: f.date_echeance ? String(f.date_echeance).slice(0, 10) : '',
      mention: f.mention || '',
    };
  }

  annulerEdition(): void {
    this.editionId.set(null);
  }

  enregistrerEdition(f: any): void {
    this.erreur.set('');
    this.api.modifierFacture(f.id, this.edit).subscribe({
      next: () => { this.editionId.set(null); this.rafraichir(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Modification impossible (facture déjà réglée ou annulée ?)'),
    });
  }

  // Support « papier numérique » (25/08/2026) — même patron que l'aperçu de
  // fichier du 21/08 : réutilise le même téléchargement authentifié pour
  // l'aperçu et le téléchargement direct.
  apercuPdf(f: any): void {
    this.preview.ouvrir(`${f.numero}.pdf`, this.api.telechargerFacturePdf(f.id));
  }

  ouvrirPdf(f: any): void {
    this.api.telechargerFacturePdf(f.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      error: () => this.erreur.set('Téléchargement du PDF impossible'),
    });
  }

  creer(): void {
    this.message.set(''); this.erreur.set('');
    const payload: any = {
      mode: this.mode,
      montant_ht: this.montantHt,
      devise: this.devise,
    };
    if (this.dossierId === '__autre__') payload.client_id = this.factureClientId;
    else payload.dossier_id = this.dossierId;
    if (this.objet) payload.objet = this.objet;
    if (this.tva !== null) payload.taux_tva = this.tva;
    if ((this.devise === 'USD' || this.devise === 'GBP') && this.tauxApplique) payload.taux_applique = this.tauxApplique;
    this.ajouterInfosReglement(payload);
    this.api.creerFacture(payload).subscribe({
      next: (f) => {
        this.message.set(`Facture ${f.numero} émise (TTC ${f.montant_ttc} ${f.devise}).`);
        this.montantHt = null; this.tauxApplique = null; this.objet = ''; this.factureClientId = null;
        this.rafraichir();
      },
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
