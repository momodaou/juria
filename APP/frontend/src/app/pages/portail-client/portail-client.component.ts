import { Component, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Dossier } from '../../core/api.service';

@Component({
  selector: 'app-portail-client',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule],
  template: `
    <header class="page-head">
      <div>
        <h1>Portail client <span class="soon">phase 4 — aperçu</span></h1>
        <p>Simulation de ce qu'un client verrait depuis un extranet dédié (authentification client séparée, non développée).</p>
      </div>
    </header>

    <section class="panel">
      <label>Choisir un dossier à prévisualiser</label>
      <input class="in" [(ngModel)]="dossierRecherche" name="dossierRecherche"
             (ngModelChange)="rechercherDossiers()" placeholder="Rechercher un dossier…" />
      @if (dossierResultats().length) {
        <div class="suggestions">
          @for (d of dossierResultats(); track d.id) {
            <button type="button" class="chip" (click)="choisirDossier(d)">{{ d.numero }} — {{ d.intitule }}</button>
          }
        </div>
      }
    </section>

    @if (dossier(); as d) {
      <div class="apercu-frame">
        <div class="apercu-banner">Aperçu extranet — vue simulée du client</div>

        <div class="dcard">
          <h2>{{ d.intitule }}</h2>
          <div class="sub">Dossier {{ d.numero }} — {{ d.statut }} ({{ d.phase }})</div>
        </div>

        <section class="panel">
          <h3>Documents partagés</h3>
          @if (documents().length) {
            <table>
              <tr><th>Nom</th><th>Catégorie</th><th>Statut</th><th>Date</th></tr>
              @for (doc of documents(); track doc.id) {
                <tr><td>{{ doc.nom }}</td><td>{{ doc.categorie }}</td><td>{{ doc.statut }}</td><td>{{ doc.cree_le | date:'dd/MM/yyyy' }}</td></tr>
              }
            </table>
          } @else { <p class="muted">Aucun document.</p> }
        </section>

        <section class="panel">
          <h3>Factures</h3>
          @if (factures().length) {
            <table>
              <tr><th>N°</th><th>Montant TTC</th><th>Statut</th><th>Échéance</th></tr>
              @for (f of factures(); track f.id) {
                <tr><td>{{ f.numero }}</td><td>{{ f.montant_ttc | number }} FCFA</td><td>{{ f.statut }}</td><td>{{ f.date_echeance ? (f.date_echeance | date:'dd/MM/yyyy') : '—' }}</td></tr>
              }
            </table>
          } @else { <p class="muted">Aucune facture.</p> }
        </section>

        <section class="panel">
          <h3>Messagerie <span class="soon">à venir</span></h3>
          <p class="muted">La messagerie sécurisée cabinet ↔ client n'est pas encore développée. Elle nécessitera un compte
            client dédié (authentification séparée de celle du cabinet) et une table de messages, non prévus dans le
            schéma actuel — à concevoir avec le reste du portail.</p>
        </section>
      </div>
    } @else {
      <p class="muted">Sélectionnez un dossier ci-dessus pour prévisualiser sa vue extranet.</p>
    }
  `,
  styles: [`
    .in{display:block;width:100%;max-width:480px;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:14px}
    label{font-size:12px;color:var(--slate);font-weight:600}
    .suggestions{display:flex;flex-wrap:wrap;gap:6px;margin-top:-6px}
    .chip{background:#fff;border:1px solid var(--line);border-radius:12px;padding:5px 11px;font-size:12.5px;cursor:pointer}
    .soon{background:#f0ecf9;border:1px solid #ddd3f0;color:#5b3fa0;border-radius:12px;padding:2px 9px;font-size:10.5px;font-weight:700;margin-left:8px;vertical-align:middle}
    .apercu-frame{border:2px dashed var(--line);border-radius:12px;padding:18px;margin-top:18px}
    .apercu-banner{text-align:center;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--grey);margin-bottom:14px}
  `],
})
export class PortailClientComponent {
  private readonly api = inject(ApiService);
  readonly dossierResultats = signal<Dossier[]>([]);
  readonly dossier = signal<any | null>(null);
  readonly documents = signal<any[]>([]);
  readonly factures = signal<any[]>([]);

  dossierRecherche = '';

  rechercherDossiers(): void {
    if (this.dossierRecherche.length < 2) { this.dossierResultats.set([]); return; }
    this.api.dossiers(this.dossierRecherche).subscribe({ next: (d) => this.dossierResultats.set(d) });
  }

  choisirDossier(d: Dossier): void {
    this.dossierResultats.set([]);
    this.dossierRecherche = '';
    this.api.dossier(d.id).subscribe({ next: (full) => this.dossier.set(full) });
    this.api.dossierDocuments(d.id).subscribe({ next: (docs) => this.documents.set(docs) });
    this.api.factures('', { dossier_id: d.id }).subscribe({ next: (f) => this.factures.set(f) });
  }
}
