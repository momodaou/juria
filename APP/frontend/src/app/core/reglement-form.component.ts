import { Component, EventEmitter, Input, OnChanges, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, MoyenPaiement } from './api.service';

// Formulaire d'un règlement (20/10/2026) : le moyen choisi détermine les
// références demandées, les frais retenus éventuels et les comptes proposés.
// Les champs viennent du catalogue du serveur. Deux sens : « encaissement »
// (règlement reçu d'un client) et « decaissement » (dépense payée par le
// cabinet, où les espèces sortent de la caisse, sans compte). Le modèle est un
// objet que le parent lit à l'envoi : { <cleMode>, references, compte_id, frais_retenus }.
@Component({
  selector: 'app-reglement-form',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="reglement">
      <label>Moyen de paiement
        <select [ngModel]="modele[cleMode]" (ngModelChange)="choisirMoyen($event)" name="rgMoyen">
          @if (!exigerMoyen) { <option value="">— à préciser —</option> }
          @for (x of catalogue; track x.code) { <option [value]="x.code">{{ x.libelle }}</option> }
        </select>
      </label>
      @if (moyen(); as m) {
        @if (!masquerReferences) {
          @for (c of m.champs; track c.cle) {
            <label><span>{{ c.libelle }}@if (c.requis && exigerReferences) { <span class="req"> *</span> }</span>
              <input [type]="c.type === 'date' ? 'date' : 'text'" [(ngModel)]="modele.references[c.cle]" [name]="'rg_' + c.cle" (ngModelChange)="emettre()" />
            </label>
          }
        }
        @if (m.frais) {
          <label>Frais retenus (facultatif)
            <input type="number" min="0" [(ngModel)]="modele.frais_retenus" name="rgFrais" />
          </label>
          @if (modele.frais_retenus > 0) {
            <label>Frais à la charge de
              <select [(ngModel)]="modele.frais_a_charge" name="rgFraisCharge">
                <option value="client">Le client : la facture reste due des frais</option>
                <option value="cabinet">Le cabinet : la facture est soldée</option>
              </select>
            </label>
          }
        }
        @if (comptes().length) {
          <label><span>{{ libelleCompte() }}@if (compteObligatoire()) { <span class="req"> *</span> }</span>
            <select [(ngModel)]="modele.compte_id" name="rgCompte" (ngModelChange)="emettre()">
              <option value="">{{ m.code === 'especes' && sens === 'encaissement' && !carpa ? '— pas encore déposées —' : '— choisir —' }}</option>
              @for (c of comptes(); track c.id) { <option [value]="c.id">{{ c.intitule }}</option> }
            </select>
          </label>
        } @else if (m.code !== 'especes') {
          <p class="hint">Aucun compte enregistré pour ce moyen : il sera enregistré sans compte.</p>
        }
        @if (m.code === 'especes' && sens === 'encaissement' && !carpa) {
          <p class="hint">Les espèces reçues sont déposées en banque : tant qu'aucun compte n'est indiqué, elles restent signalées « à déposer ».</p>
        }
        @if (m.code === 'especes' && sens === 'decaissement') {
          <p class="hint">Les espèces sortent de la caisse : aucun compte à indiquer.</p>
        }
        @if (m.frais && modele.frais_retenus > 0) {
          <p class="hint">{{ modele.frais_a_charge === 'client'
            ? 'Seule la somme réellement reçue (nette des frais) est imputée sur la facture : elle reste due des frais.'
            : 'Le montant payé est imputé en entier sur la facture ; les frais restent à la charge du cabinet.' }}</p>
        }
      }
    </div>
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
  @Input() sens: 'encaissement' | 'decaissement' = 'encaissement';
  // Nom de la propriété qui porte le moyen dans le modèle (« mode » ou « mode_paiement »).
  @Input() cleMode = 'mode';
  // Références requises du moyen : faux tant que l'argent n'est pas sorti (dépense soumise).
  @Input() exigerReferences = true;
  // Références du moyen (n° et date du chèque, identifiant de transaction…) : masquées avant le paiement (validation par les
  // associés, saisie d'une dépense) ; elles se renseignent au décaissement par la personne qui paie.
  @Input() masquerReferences = false;
  // Faux : le moyen peut rester « à préciser » (dépense soumise avant son paiement).
  @Input() exigerMoyen = true;
  // Qui supporte les frais retenus quand rien n'est choisi (d'après la mention de la facture).
  @Input() fraisParDefaut: 'client' | 'cabinet' = 'cabinet';
  // Comptes CARPA uniquement (fonds de tiers) : la liste ne dépend pas du moyen.
  @Input() carpa = false;
  @Output() validite = new EventEmitter<boolean>();

  readonly comptes = signal<{ id: string; intitule: string }[]>([]);

  ngOnChanges(): void {
    if (!this.modele) return;
    if (this.exigerMoyen && !this.modele[this.cleMode]) this.modele[this.cleMode] = this.sens === 'encaissement' ? 'virement' : 'orange_money';
    this.modele.references ??= {};
    this.modele.frais_a_charge ??= this.fraisParDefaut;
    this.chargerComptes();
  }

  moyen(): MoyenPaiement | undefined { return this.catalogue.find((m) => m.code === this.modele?.[this.cleMode]); }

  libelleCompte(): string {
    if (this.carpa) return this.sens === 'decaissement' ? 'Compte CARPA débité' : 'Compte CARPA crédité';
    if (this.sens === 'decaissement') return 'Compte débité';
    return this.moyen()?.code === 'especes' ? 'Compte de dépôt (vide : espèces pas encore déposées)' : 'Compte crédité';
  }

  compteObligatoire(): boolean {
    const m = this.moyen();
    return !!m && (m.code !== 'especes' || this.carpa) && this.comptes().length > 1;
  }

  choisirMoyen(code: string): void {
    this.modele[this.cleMode] = code;
    this.modele.references = {};
    this.modele.frais_retenus = null;
    this.modele.compte_id = '';
    this.chargerComptes();
  }

  private chargerComptes(): void {
    const code = this.modele[this.cleMode];
    if (!code) { this.comptes.set([]); this.emettre(); return; }
    const appel = this.carpa ? this.api.fondsTiersComptes()
      : this.sens === 'decaissement' ? this.api.comptesPourDecaissement(code) : this.api.comptesPourMoyen(code);
    appel.subscribe({
      next: (liste) => {
        this.comptes.set(liste);
        const courant = this.modele.compte_id;
        if (courant && !liste.some((c) => c.id === courant)) this.modele.compte_id = '';
        if (!this.modele.compte_id && !(code === 'especes' && this.sens === 'encaissement' && !this.carpa)) {
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
    if (!m) { this.validite.emit(!this.exigerMoyen); return; }
    const refs = this.modele.references ?? {};
    const refsOk = !this.exigerReferences || m.champs.every((c) => !c.requis || String(refs[c.cle] ?? '').trim() !== '');
    const compteOk = !this.compteObligatoire() || !!this.modele.compte_id;
    this.validite.emit(refsOk && compteOk);
  }
}
