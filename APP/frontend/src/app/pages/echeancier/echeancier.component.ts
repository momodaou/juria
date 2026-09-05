import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Dossier } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-echeancier',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <header class="page-head"><h1>Échéancier &amp; délais</h1></header>

    <section class="panel">
      <p class="muted" style="margin-bottom:12px">Filet de sécurité : chaque délai déclenche des alertes automatiques J-30, J-15, J-7, J-1 et jour J.</p>
      @if (auth.peut('evenements.creer')) {
        <div class="add">
          <select [(ngModel)]="nvDossier" name="d">
            <option value="">Dossier…</option>
            @for (d of dossiers(); track d.id) { <option [value]="d.id">{{ d.numero }} — {{ d.intitule }}</option> }
          </select>
          <select [(ngModel)]="nvType" name="t">
            <option value="audience">Audience</option>
            <option value="delai_procedure">Délai de procédure</option>
            <option value="delai_recours">Délai de recours</option>
            <option value="depot">Dépôt</option>
            <option value="prescription">Prescription</option>
            <option value="echeance_contractuelle">Échéance contractuelle</option>
          </select>
          <input [(ngModel)]="nvTitre" name="ti" placeholder="Intitulé" />
          <input type="date" [(ngModel)]="nvDate" name="da" />
          <button class="btn" (click)="ajouter()" [disabled]="!nvDossier || !nvDate">Ajouter</button>
        </div>
      }
      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
    </section>

    <section class="panel">
      <h3>Prochaines échéances</h3>
      @if (evenements().length) {
        <table>
          <tr><th>Échéance</th><th>Dossier</th><th>Type</th><th>Intitulé</th><th>Responsable</th><th>Alerte</th></tr>
          @for (e of evenements(); track e.id) {
            <tr>
              <td>{{ e.date_echeance | date:'dd/MM/yyyy' }}</td>
              <td>{{ e.dossier_numero }}</td>
              <td>{{ e.type }}</td>
              <td>{{ e.titre || '—' }}</td>
              <td>{{ e.responsable || '—' }}</td>
              <td><span class="tag" [class.haute]="e.jours_restants <= 7" [class.moy]="e.jours_restants > 7 && e.jours_restants <= 15">{{ badge(e) }}</span></td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucune échéance enregistrée.</p> }
    </section>

    <section class="panel">
      <h3>Plan d'action — tâches</h3>
      @if (auth.peut('taches.creer')) {
        <div class="add">
          <input [(ngModel)]="ntTitre" name="nt" placeholder="Nouvelle tâche" style="flex:1;min-width:200px" />
          <input type="date" [(ngModel)]="ntEch" name="ne" />
          <button class="btn" (click)="ajouterTache()" [disabled]="!ntTitre">Ajouter</button>
        </div>
      }
      @if (taches().length) {
        <table>
          <tr><th>Tâche</th><th>Dossier</th><th>Échéance</th><th>Statut</th><th></th></tr>
          @for (t of taches(); track t.id) {
            <tr>
              <td>{{ t.titre }}</td>
              <td>{{ t.dossier_numero || '—' }}</td>
              <td>{{ t.echeance ? (t.echeance | date:'dd/MM/yyyy') : '—' }}</td>
              <td><span class="tag" [class.done]="t.statut === 'termine'">{{ t.statut }}</span></td>
              <td>@if (t.statut !== 'termine' && auth.peut('taches.statut.modifier')) { <button class="lien" (click)="terminer(t)">Marquer fait</button> }</td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucune tâche.</p> }
    </section>
  `,
  styles: [`
    .add{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
    .add select,.add input{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .tag.moy{background:#fbf1dc;color:#9a6c12}
    .tag.done{background:#e3f5ec;color:#157a4f}
  `],
})
export class EcheancierComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);

  readonly evenements = signal<any[]>([]);
  readonly taches = signal<any[]>([]);
  readonly dossiers = signal<Dossier[]>([]);
  readonly erreur = signal('');

  nvDossier = ''; nvType = 'audience'; nvTitre = ''; nvDate = '';
  ntTitre = ''; ntEch = '';

  ngOnInit(): void {
    this.api.dossiers().subscribe({ next: (d) => this.dossiers.set(d), error: () => {} });
    this.charger();
  }

  charger(): void {
    this.api.evenements().subscribe({ next: (e) => this.evenements.set(e), error: () => {} });
    this.api.taches().subscribe({ next: (t) => this.taches.set(t), error: () => {} });
  }

  badge(e: any): string {
    const j = e.jours_restants;
    if (j < 0) return 'dépassé';
    if (j === 0) return 'jour J';
    return 'J-' + j;
  }

  ajouter(): void {
    this.api.creerEvenement({ dossier_id: this.nvDossier, type: this.nvType, titre: this.nvTitre, date_echeance: this.nvDate }).subscribe({
      next: () => { this.nvTitre = ''; this.nvDate = ''; this.charger(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Ajout impossible'),
    });
  }

  ajouterTache(): void {
    this.api.creerTache({ titre: this.ntTitre, echeance: this.ntEch || null }).subscribe({
      next: () => { this.ntTitre = ''; this.ntEch = ''; this.charger(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Ajout impossible'),
    });
  }

  terminer(t: any): void {
    this.api.majTache(t.id, 'termine').subscribe({ next: () => this.charger(), error: () => {} });
  }
}
