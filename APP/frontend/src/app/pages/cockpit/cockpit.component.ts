import { Component, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { ApiService, DashboardData } from '../../core/api.service';

@Component({
  selector: 'app-cockpit',
  standalone: true,
  imports: [DecimalPipe, DatePipe],
  template: `
    <header class="page-head">
      <h1>Cockpit</h1>
      <p>Vue d'ensemble du cabinet</p>
    </header>

    @if (data(); as d) {
      <div class="kpis">
        <div class="kpi"><span class="n">{{ d.dossiers_actifs }}</span><span class="l">Dossiers actifs</span></div>
        <div class="kpi red"><span class="n">{{ d.dossiers_urgents }}</span><span class="l">Dossiers urgents</span></div>
        <div class="kpi amber"><span class="n">{{ d.audiences_semaine }}</span><span class="l">Audiences (7 j)</span></div>
        <div class="kpi red"><span class="n">{{ d.impayes_ttc | number }}</span><span class="l">Impayés (FCFA)</span></div>
        <div class="kpi green"><span class="n">{{ d.heures_mois | number:'1.0-0' }}</span><span class="l">Heures (mois)</span></div>
        <div class="kpi red"><span class="n">{{ d.dossiers_sous_seuil_honoraires }}</span><span class="l">Dossiers pro bono sous le seuil de frais</span></div>
      </div>

      <section class="panel">
        <h3>Délais à venir</h3>
        @if (d.delais_a_venir.length) {
          <table>
            <tr><th>Dossier</th><th>Type</th><th>Échéance</th><th>Jours</th></tr>
            @for (e of d.delais_a_venir; track e.id) {
              <tr>
                <td>{{ e.dossier_numero }} — {{ e.intitule }}</td>
                <td>{{ e.type }}</td>
                <td>{{ e.date_echeance | date:'dd/MM/yyyy' }}</td>
                <td>J-{{ e.jours_restants }}</td>
              </tr>
            }
          </table>
        } @else {
          <p class="muted">Aucun délai enregistré.</p>
        }
      </section>
    } @else if (erreur()) {
      <p class="err">{{ erreur() }}</p>
    } @else {
      <p class="muted">Chargement…</p>
    }
  `,
})
export class CockpitComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly data = signal<DashboardData | null>(null);
  readonly erreur = signal('');

  ngOnInit(): void {
    this.api.dashboard().subscribe({
      next: (d) => this.data.set(d),
      error: () => this.erreur.set('Impossible de charger le tableau de bord.'),
    });
  }
}
