import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, Dossier } from '../../core/api.service';

@Component({
  selector: 'app-dossiers',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <header class="page-head">
      <h1>Dossiers</h1>
      <input class="search" placeholder="Rechercher un dossier…"
             [(ngModel)]="recherche" (ngModelChange)="charger()" />
    </header>

    <section class="panel">
      @if (dossiers().length) {
        <table>
          <tr><th>N°</th><th>Intitulé</th><th>Client</th><th>Responsable</th><th>Phase</th><th>Urgence</th></tr>
          @for (d of dossiers(); track d.id) {
            <tr class="clik" [routerLink]="['/dossiers', d.id]">
              <td>{{ d.numero }}</td>
              <td>{{ d.intitule }}</td>
              <td>{{ d.client }}</td>
              <td>{{ d.responsable }}</td>
              <td>{{ d.phase }}</td>
              <td><span class="tag" [class.haute]="d.urgence === 'haute'">{{ d.urgence }}</span></td>
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
}
