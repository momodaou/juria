import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { DocumentPreviewService } from '../../core/document-preview.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-biblio',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <header class="page-head">
      <div>
        <h1>Bibliothèque</h1>
        <p>Jurisprudence, textes OHADA/nationaux, veille législative, modèles, consultations, checklists.</p>
      </div>
      @if (auth.peut('biblio.creer')) {
        <button class="btn" (click)="afficherForm.set(!afficherForm())">
          {{ afficherForm() ? 'Annuler' : '+ Nouvelle ressource' }}
        </button>
      }
    </header>

    @if (afficherForm()) {
      <section class="panel">
        <h3>Nouvelle ressource</h3>
        <div class="grid2">
          <div>
            <label>Type</label>
            <select class="in" [(ngModel)]="form.type" name="type">
              <option value="jurisprudence">Jurisprudence</option>
              <option value="texte_loi">Texte de loi</option>
              <option value="veille">Veille législative</option>
              <option value="modele">Modèle</option>
              <option value="consultation">Consultation (anonymisée)</option>
              <option value="checklist">Checklist</option>
            </select>
          </div>
          <div>
            <label>Source</label>
            <select class="in" [(ngModel)]="form.source" name="source">
              <option value="OHADA">OHADA</option>
              <option value="National">National</option>
              <option value="Interne">Interne</option>
            </select>
          </div>
          <div class="col2"><label>Titre</label><input class="in" [(ngModel)]="form.titre" name="titre" /></div>
          <div><label>Référence</label><input class="in" [(ngModel)]="form.reference" name="reference" placeholder="Ex. CCJA 045/2020" /></div>
          <div><label>Matière</label><input class="in" [(ngModel)]="form.matiere" name="matiere" placeholder="Ex. Sûretés" /></div>
          <div><label>Date de publication</label><input class="in" type="date" [(ngModel)]="form.date_publication" name="date" /></div>
          <div><label>Fichier associé (optionnel)</label><input type="file" (change)="onFichierChoisi($event)" /></div>
          <div class="col2"><label>Résumé</label><textarea class="in ta" [(ngModel)]="form.resume" name="resume"></textarea></div>
        </div>
        <button class="btn" (click)="creer()" [disabled]="!form.titre || creation()">
          {{ creation() ? 'Ajout…' : 'Ajouter à la bibliothèque' }}
        </button>
        @if (erreur()) { <p class="err">{{ erreur() }}</p> }
      </section>
    }

    <section class="panel">
      <div class="filtres">
        <select class="in filtre" [(ngModel)]="filtreType" (ngModelChange)="charger()">
          <option value="">Tous types</option>
          <option value="jurisprudence">Jurisprudence</option>
          <option value="texte_loi">Texte de loi</option>
          <option value="veille">Veille législative</option>
          <option value="modele">Modèle</option>
          <option value="consultation">Consultation</option>
          <option value="checklist">Checklist</option>
        </select>
        <input class="search" placeholder="Rechercher (titre, référence)…"
               [(ngModel)]="recherche" (ngModelChange)="charger()" />
      </div>

      @if (ressources().length) {
        <table>
          <tr><th>Type</th><th>Titre</th><th>Référence</th><th>Source</th><th>Matière</th><th>Date</th><th></th></tr>
          @for (r of ressources(); track r.id) {
            <tr>
              <td><span class="tag">{{ libelleType(r.type) }}</span></td>
              <td>{{ r.titre }}</td>
              <td>{{ r.reference || '—' }}</td>
              <td>{{ r.source }}</td>
              <td>{{ r.matiere || '—' }}</td>
              <td>{{ r.date_publication ? (r.date_publication | date:'dd/MM/yyyy') : '—' }}</td>
              <td>
                @if (r.a_fichier) {
                  <button class="lien" (click)="apercu(r)">Aperçu</button>
                  <button class="lien" (click)="telecharger(r.id)">Télécharger</button>
                }
                @if (auth.peut('biblio.supprimer')) {
                  <button class="lien" (click)="supprimer(r.id)">Supprimer</button>
                }
              </td>
            </tr>
          }
        </table>
      } @else {
        <p class="muted">Aucune ressource.</p>
      }
    </section>
  `,
  styles: [`
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:14px;font-family:inherit}
    .ta{min-height:70px;resize:vertical}
    label{font-size:12px;color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:680px}
    .col2{grid-column:1 / -1}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .filtres{display:flex;gap:10px;margin-bottom:14px}
    .filtre{width:auto;margin:0;max-width:200px}
    .lien{background:none;border:none;color:var(--gold);cursor:pointer;font-size:12.5px;padding:0;margin-right:10px;text-decoration:none}
  `],
})
export class BiblioComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly preview = inject(DocumentPreviewService);
  readonly ressources = signal<any[]>([]);
  readonly afficherForm = signal(false);
  readonly creation = signal(false);
  readonly erreur = signal('');

  recherche = '';
  filtreType = '';
  form: any = { type: 'jurisprudence', source: 'OHADA' };
  fichierChoisi: File | null = null;

  private readonly libelles: Record<string, string> = {
    jurisprudence: 'Jurisprudence', texte_loi: 'Texte de loi', veille: 'Veille',
    modele: 'Modèle', consultation: 'Consultation', checklist: 'Checklist',
  };
  libelleType(t: string): string { return this.libelles[t] ?? t; }

  // Aperçu sans ouverture classique (21/08/2026, demande utilisateur).
  apercu(r: any): void {
    this.preview.ouvrir(r.titre, this.api.telechargerFichierBiblio(r.id));
  }

  telecharger(id: string): void {
    this.api.telechargerFichierBiblio(id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      error: () => this.erreur.set('Téléchargement impossible.'),
    });
  }

  ngOnInit(): void {
    this.charger();
  }

  charger(): void {
    this.api.biblio({ type: this.filtreType, q: this.recherche }).subscribe({ next: (r) => this.ressources.set(r) });
  }

  onFichierChoisi(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.fichierChoisi = input.files?.[0] ?? null;
  }

  creer(): void {
    this.creation.set(true);
    this.erreur.set('');
    this.api.creerRessourceBiblio(this.form, this.fichierChoisi).subscribe({
      next: () => {
        this.creation.set(false);
        this.afficherForm.set(false);
        this.form = { type: 'jurisprudence', source: 'OHADA' };
        this.fichierChoisi = null;
        this.charger();
      },
      error: (e) => { this.creation.set(false); this.erreur.set(e?.error?.error ?? 'Ajout impossible.'); },
    });
  }

  supprimer(id: string): void {
    this.api.supprimerRessourceBiblio(id).subscribe({ next: () => this.charger() });
  }
}
