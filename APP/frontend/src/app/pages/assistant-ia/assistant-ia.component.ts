import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

type Capacite = 'resume' | 'chronologie' | 'extraction' | 'contrat' | 'traduction' | 'comparaison';

interface CapaciteInfo {
  code: Capacite;
  titre: string;
  description: string;
  action: string;
}

const CAPACITES: CapaciteInfo[] = [
  { code: 'resume', titre: 'Résumé', description: 'Résume un texte ou une pièce de manière factuelle.', action: 'ia.resume' },
  { code: 'chronologie', titre: 'Chronologie', description: 'Dresse la chronologie des faits datés d’un texte.', action: 'ia.chronologie' },
  { code: 'extraction', titre: 'Extraction de faits', description: 'Extrait parties, montants, dates, engagements.', action: 'ia.extraction_faits' },
  { code: 'contrat', titre: 'Analyse contractuelle', description: 'Identifie les clauses clés et points de vigilance.', action: 'ia.analyse_contrat' },
  { code: 'traduction', titre: 'Traduction', description: 'Traduit un texte juridique vers une autre langue.', action: 'ia.traduction' },
  { code: 'comparaison', titre: 'Comparaison', description: 'Compare deux versions d’un même texte/acte.', action: 'ia.comparaison' },
];

@Component({
  selector: 'app-assistant-ia',
  standalone: true,
  imports: [FormsModule],
  template: `
    <header class="page-head">
      <div>
        <h1>Assistant IA <span class="ia-tag">projet à valider</span></h1>
        <p>Aide à la rédaction et à l'analyse — chaque résultat doit être relu et validé par l'avocat avant tout usage.</p>
      </div>
    </header>

    <div class="cardgrid">
      @for (c of capacitesAutorisees(); track c.code) {
        <button type="button" class="cap" [class.active]="capacite() === c.code" (click)="capacite.set(c.code)">
          <h4>{{ c.titre }}</h4>
          <p>{{ c.description }}</p>
        </button>
      }
    </div>
    @if (!capacitesAutorisees().length) {
      <p class="err">Vous n'êtes autorisé à utiliser aucune capacité de l'Assistant IA.</p>
    }

    <section class="panel">
      <h3>{{ titreCourant() }}</h3>

      @if (capacite() === 'comparaison') {
        <label>Version A</label>
        <textarea class="in ta" [(ngModel)]="texteA" name="texteA"></textarea>
        <label>Version B</label>
        <textarea class="in ta" [(ngModel)]="texteB" name="texteB"></textarea>
      } @else {
        <label>Texte source</label>
        <textarea class="in ta" [(ngModel)]="texte" name="texte" placeholder="Collez ici le texte à traiter…"></textarea>
        @if (capacite() === 'traduction') {
          <label>Langue cible</label>
          <select class="in" style="max-width:220px" [(ngModel)]="langueCible" name="langue">
            <option value="anglais">Anglais</option>
            <option value="francais">Français</option>
            <option value="arabe">Arabe</option>
          </select>
        }
      }

      @if (auth.peut(actionCourante())) {
        <button class="btn" (click)="lancer()" [disabled]="enCours() || !peutLancer()">
          {{ enCours() ? 'Génération…' : 'Lancer' }}
        </button>
      } @else {
        <p class="err">Vous n'êtes pas autorisé à utiliser cette capacité.</p>
      }

      @if (resultat()) {
        <div class="result ok">
          <b>Résultat — projet à valider par l'avocat</b>
          <pre>{{ resultat() }}</pre>
        </div>
      }
      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
    </section>
  `,
  styles: [`
    .ia-tag{background:#eef;border:1px solid #d5d9f5;color:#43489a;border-radius:12px;padding:2px 9px;font-size:11px;font-weight:600;margin-left:8px;vertical-align:middle}
    .cardgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:18px}
    .cap{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px;text-align:left;cursor:pointer;font-family:inherit}
    .cap.active{border-color:var(--gold);box-shadow:0 0 0 2px rgba(176,141,87,.25)}
    .cap h4{font-size:13.5px;color:var(--navy);margin:0 0 4px}
    .cap p{font-size:12px;color:var(--grey);margin:0}
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:14px;font-family:inherit}
    .ta{min-height:130px;resize:vertical}
    label{font-size:12px;color:var(--slate);font-weight:600}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .result{margin-top:16px;border-radius:10px;padding:14px 16px;background:#fffaf0;border:1px solid #f0dcae}
    .result pre{white-space:pre-wrap;font-family:inherit;font-size:13.5px;margin-top:8px}
  `],
})
export class AssistantIaComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly capacites = CAPACITES;
  readonly capacitesAutorisees = computed(() => this.capacites.filter((c) => this.auth.peut(c.action)));
  readonly capacite = signal<Capacite>('resume');
  readonly resultat = signal('');
  readonly erreur = signal('');
  readonly enCours = signal(false);

  texte = '';
  texteA = '';
  texteB = '';
  langueCible = 'anglais';

  ngOnInit(): void {
    // Bascule sur la première capacité réellement autorisée pour ce rôle
    // (le signal démarre sur 'resume', qui peut être hors permission).
    const permises = this.capacitesAutorisees();
    if (permises.length && !permises.some((c) => c.code === this.capacite())) {
      this.capacite.set(permises[0].code);
    }
  }

  titreCourant(): string {
    return this.capacites.find((c) => c.code === this.capacite())?.titre ?? '';
  }

  actionCourante(): string {
    return this.capacites.find((c) => c.code === this.capacite())?.action ?? '';
  }

  peutLancer(): boolean {
    return this.capacite() === 'comparaison' ? !!(this.texteA && this.texteB) : !!this.texte;
  }

  lancer(): void {
    this.enCours.set(true);
    this.erreur.set('');
    this.resultat.set('');

    const gerer = (obs: any, cle: string) => {
      obs.subscribe({
        next: (r: any) => { this.enCours.set(false); this.resultat.set(r[cle]); },
        error: (e: any) => { this.enCours.set(false); this.erreur.set(e?.error?.error ?? 'Erreur du service IA.'); },
      });
    };

    switch (this.capacite()) {
      case 'resume': return gerer(this.api.iaResume({ texte: this.texte }), 'resume');
      case 'chronologie': return gerer(this.api.iaChronologie({ texte: this.texte }), 'chronologie');
      case 'extraction': return gerer(this.api.iaExtractionFaits({ texte: this.texte }), 'faits');
      case 'contrat': return gerer(this.api.iaAnalyseContrat({ texte: this.texte }), 'analyse');
      case 'traduction': return gerer(this.api.iaTraduction({ texte: this.texte, langue_cible: this.langueCible }), 'traduction');
      case 'comparaison': return gerer(this.api.iaComparaison({ texte_a: this.texteA, texte_b: this.texteB }), 'comparaison');
    }
  }
}
