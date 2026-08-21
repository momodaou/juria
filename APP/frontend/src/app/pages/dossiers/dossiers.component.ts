import { Component, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, Dossier } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

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
      <div class="filtres">
        <select class="filtre" [(ngModel)]="filtreStatut" (ngModelChange)="charger()">
          <option value="">Tous statuts</option>
          <option value="__actifs__">Actifs (masquer archivés)</option>
          <option value="ouvert">Ouvert</option>
          <option value="en_cours">En cours</option>
          <option value="suspendu">Suspendu</option>
          <option value="clos">Clos</option>
          <option value="archive">Archivé</option>
        </select>
        <select class="filtre" [(ngModel)]="filtreResponsable" (ngModelChange)="charger()">
          <option value="">Tous responsables</option>
          @if (auth.utilisateur(); as moi) { <option value="__moi__">Mes dossiers</option> }
          @for (u of utilisateurs(); track u.id) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
        </select>
      </div>

      @if (dossiers().length) {
        <table>
          <tr><th>N°</th><th>Intitulé</th><th>Client</th><th>Responsable</th><th>Statut</th><th>Phase</th><th>Urgence</th><th>Pro bono</th></tr>
          @for (d of dossiers(); track d.id) {
            <tr>
              <td class="clik" [routerLink]="['/dossiers', d.id]">
                @if (d.couleur_chemise) { <span class="pastille" [style.background]="couleurCss(d.couleur_chemise)" [title]="'Chemise ' + d.couleur_chemise"></span> }
                {{ d.numero }}
              </td>
              <td class="clik" [routerLink]="['/dossiers', d.id]">{{ d.intitule }}</td>
              <td><a class="lien" [routerLink]="['/clients', d.client_id]" (click)="$event.stopPropagation()">{{ d.client }}</a></td>
              <td class="clik" [routerLink]="['/dossiers', d.id]">{{ d.responsable }}</td>
              <td class="clik" [routerLink]="['/dossiers', d.id]"><span class="tag" [class.haute]="d.statut === 'archive'">{{ d.statut }}</span></td>
              <td class="clik" [routerLink]="['/dossiers', d.id]">{{ d.phase }}</td>
              <td class="clik" [routerLink]="['/dossiers', d.id]"><span class="tag" [class.haute]="d.urgence === 'haute'">{{ d.urgence }}</span></td>
              <td class="clik" [routerLink]="['/dossiers', d.id]">
                @if (d.pro_bono) {
                  <span class="tag"
                        [class.ok]="d.statut_honoraires === 'atteint'"
                        [class.attente]="d.statut_honoraires === 'sous_seuil'"
                        [class.haute]="d.statut_honoraires === 'sans_honoraires'"
                        [title]="(d.cumul_xof | number) + ' / ' + (d.honoraires_seuil_xof | number) + ' FCFA'">
                    {{ libelleHonoraires(d.statut_honoraires) }}
                  </span>
                } @else { — }
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
    .lien{color:var(--gold);text-decoration:none;font-size:13px}
    .lien:hover{text-decoration:underline}
    .pastille{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}
    .filtres{display:flex;gap:10px;margin-bottom:14px}
    .filtre{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;max-width:220px}
  `],
})
export class DossiersComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly dossiers = signal<Dossier[]>([]);
  readonly utilisateurs = signal<any[]>([]);
  readonly erreur = signal('');
  recherche = '';
  // Filtres statut/responsable (20/08/2026, diagnostic utilisateur) — le
  // backend les acceptait déjà (?statut=&responsable=), jamais exposés à
  // l'écran : la liste mélangeait systématiquement actifs et archivés,
  // sans moyen de se limiter à ses propres dossiers.
  filtreStatut = '';
  filtreResponsable = '';

  ngOnInit(): void {
    this.charger();
    this.api.utilisateurs().subscribe({ next: (u) => this.utilisateurs.set(u) });
  }

  charger(): void {
    const filtres: { statut?: string; responsable?: string; masquer_archives?: boolean } = {};
    if (this.filtreStatut === '__actifs__') filtres.masquer_archives = true;
    else if (this.filtreStatut) filtres.statut = this.filtreStatut;
    if (this.filtreResponsable === '__moi__') filtres.responsable = this.auth.utilisateur()?.id;
    else if (this.filtreResponsable) filtres.responsable = this.filtreResponsable;

    this.api.dossiers(this.recherche, filtres).subscribe({
      next: (d) => this.dossiers.set(d),
      error: () => this.erreur.set('Impossible de charger les dossiers.'),
    });
  }

  private readonly couleursCss: Record<string, string> = {
    rouge: '#c0392b', jaune: '#d4ac0d', bleu: '#2874a6', vert: '#229954',
    orange: '#d35400', violet: '#7d3c98', gris: '#95a5a6',
  };
  couleurCss(couleur: string): string { return this.couleursCss[couleur] ?? '#ccc'; }

  libelleHonoraires(statut: string | null): string {
    switch (statut) {
      case 'atteint': return 'Seuil atteint';
      case 'sous_seuil': return 'Sous le seuil';
      case 'sans_honoraires': return 'Sans honoraires';
      default: return statut ?? '—';
    }
  }
}
