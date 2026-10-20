import { Component, EventEmitter, Input, OnChanges, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, MoyenPaiement } from './api.service';

// Formulaire d'un règlement reçu (20/10/2026) : le moyen choisi détermine les
// références demandées, les frais retenus éventuels et les comptes proposés.
// Les champs viennent du catalogue du serveur (moyens-paiement). Le modèle est
// un objet que le parent lit à l'envoi : { mode, references, compte_id, frais_retenus }.
@Component({
  selector: 'app-reglement-form',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (moyen(); as m) {
      <div class="reglement">
        <label>Moyen de paiement
          <select [ngModel]="modele.mode" (ngModelChange)="choisirMoyen($event)" name="rgMoyen">
            @for (x of catalogue; track x.code) { <option [value]="x.code">{{ x.libelle }}</option> }
          </select>
        </label>
        @for (c of m.champs; track c.cle) {
          <label>{{ c.libelle }}@if (c.requis) { <span class="req"> *</span> }
            <input [type]="c.type === 'date' ? 'date' : 'text'" [(ngModel)]="modele.references[c.cle]" [name]="'rg_' + c.cle" (ngModelChange)="emettre()" />
          </label>
        }
        @if (m.frais) {
          <label>Frais retenus (facultatif)
            <input type="number" min="0" [(ngModel)]="modele.frais_retenus" name="rgFrais" />
          </label>
        }
        @if (comptes().length) {
          <label>{{ m.code === 'especes' ? 'Compte de dépôt (vide : espèces pas encore déposées)' : 'Compte crédité' }}@if (m.code !== 'especes' && comptes().length > 1) { <span class="req"> *</span> }
            <select [(ngModel)]="modele.compte_id" name="rgCompte" (ngModelChange)="emettre()">
              <option value="">{{ m.code === 'especes' ? '— pas encore déposées —' : '— choisir —' }}</option>
              @for (c of comptes(); track c.id) { <option [value]="c.id">{{ c.intitule }}</option> }
            </select>
          </label>
        } @else if (m.code !== 'especes') {
          <p class="hint">Aucun compte enregistré pour ce moyen : le règlement sera enregistré sans compte.</p>
        }
        @if (m.code === 'especes') {
          <p class="hint">Les espèces reçues sont déposées en banque : tant qu'aucun compte n'est indiqué, elles restent signalées « à déposer ».</p>
        }
        @if (m.frais && modele.frais_retenus) {
          <p class="hint">Le montant payé reste imputé sur la facture ; les frais retenus donnent le montant réellement reçu.</p>
        }
      </div>
    }
  `,
  styles: [`
    :host{display:block;grid-column:1 / -1}
    .reglement{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:flex-end}
    label{display:flex;flex-direction:column;gap:4px;font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    input,select{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:var(--fs-base);font-weight:400;color:var(--ink,inherit)}
    .req{color:#b13a36}
    .hint{flex-basis:100%;margin:0;color:var(--slate);font-size:var(--fs-sm)}
  `],
})
export class ReglementFormComponent implements OnChanges {
  private readonly api = inject(ApiService);
  @Input({ required: true }) modele!: any;
  @Input() catalogue: MoyenPaiement[] = [];
  @Input() compteParDefaut: string | null = null;
  @Output() validite = new EventEmitter<boolean>();

  readonly comptes = signal<{ id: string; intitule: string }[]>([]);

  ngOnChanges(): void {
    if (!this.modele) return;
    if (!this.modele.mode) this.modele.mode = 'virement';
    this.modele.references ??= {};
    this.chargerComptes();
  }

  moyen(): MoyenPaiement | undefined { return this.catalogue.find((m) => m.code === this.modele?.mode); }

  choisirMoyen(code: string): void {
    this.modele.mode = code;
    this.modele.references = {};
    this.modele.frais_retenus = null;
    this.modele.compte_id = '';
    this.chargerComptes();
  }

  private chargerComptes(): void {
    const code = this.modele.mode;
    this.api.comptesPourMoyen(code).subscribe({
      next: (liste) => {
        this.comptes.set(liste);
        const courant = this.modele.compte_id;
        if (courant && !liste.some((c) => c.id === courant)) this.modele.compte_id = '';
        if (!this.modele.compte_id && code !== 'especes') {
          if (liste.length === 1) this.modele.compte_id = liste[0].id;
          else if (this.compteParDefaut && liste.some((c) => c.id === this.compteParDefaut)) this.modele.compte_id = this.compteParDefaut;
        }
        this.emettre();
      },
      error: () => { this.comptes.set([]); this.emettre(); },
    });
  }

  emettre(): void {
    const m = this.moyen();
    if (!m) { this.validite.emit(false); return; }
    const refs = this.modele.references ?? {};
    const refsOk = m.champs.every((c) => !c.requis || String(refs[c.cle] ?? '').trim() !== '');
    const compteOk = m.code === 'especes' || this.comptes().length <= 1 || !!this.modele.compte_id;
    this.validite.emit(refsOk && compteOk);
  }
}
