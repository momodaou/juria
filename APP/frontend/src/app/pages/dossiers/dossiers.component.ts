import { Component, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, Dossier } from '../../core/api.service';

@Component({
  selector: 'app-dossiers',
  standalone: true,
  imports: [FormsModule, RouterLink, DecimalPipe],
  template: `
    <header class="page-head">
      <h1>Dossiers</h1>
      <input class="search" placeholder="Rechercher un dossier…"
             [(ngModel)]="recherche" (ngModelChange)="charger()" />
    </header>

    <section class="panel">
      @if (dossiers().length) {
        <table>
          <tr><th>N°</th><th>Intitulé</th><th>Client</th><th>Responsable</th><th>Phase</th><th>Urgence</th><th>Honoraires</th></tr>
          @for (d of dossiers(); track d.id) {
            <tr class="clik" [routerLink]="['/dossiers', d.id]">
              <td>{{ d.numero }}</td>
              <td>{{ d.intitule }}{{ d.pro_bono ? ' · Pro bono' : '' }}</td>
              <td>{{ d.client }}</td>
              <td>{{ d.responsable }}</td>
              <td>{{ d.phase }}</td>
              <td><span class="tag" [class.haute]="d.urgence === 'haute'">{{ d.urgence }}</span></td>
              <td>
                <span class="tag"
                      [class.ok]="d.statut_honoraires === 'atteint'"
                      [class.attente]="d.statut_honoraires === 'sous_seuil'"
                      [class.haute]="d.statut_honoraires === 'sans_honoraires'"
                      [title]="d.statut_honoraires !== 'abonnement' ? (d.cumul_xof | number) + ' / ' + (d.honoraires_seuil_xof | number) + ' FCFA' : ''">
                  {{ libelleHonoraires(d.statut_honoraires) }}
                </span>
              </td>
            </tr>
          }
        </table>
      } @else if (erreur()) {
        <p class="err">{{ erreur() }}</p>
      } @else {
        <p class="muted">Aucun dossier.</p>
      }
    </section>
  `,
  styles: [`
    .tag.ok{background:#e3f5ec;color:#157a4f}
    .tag.attente{background:#fbf1dc;color:#9a6c12}
  `],
})
export class DossiersComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly dossiers = signal<Dossier[]>([]);
  readonly erreur = signal('');
  recherche = '';

  ngOnInit(): void {
    this.charger();
  }

  charger(): void {
    this.api.dossiers(this.recherche).subscribe({
      next: (d) => this.dossiers.set(d),
      error: () => this.erreur.set('Impossible de charger les dossiers.'),
    });
  }

  libelleHonoraires(statut: string): string {
    switch (statut) {
      case 'atteint': return 'Seuil atteint';
      case 'sous_seuil': return 'Sous le seuil';
      case 'sans_honoraires': return 'Sans honoraires';
      case 'abonnement': return 'Abonnement';
      default: return statut;
    }
  }
}
