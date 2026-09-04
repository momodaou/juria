import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, DashboardData } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

// Colonne d'un tableau de détail — 'format' pilote à la fois l'affichage
// (alignement, pipe) et le comparateur de tri (voir lignesTriees()).
interface Colonne { key: string; label: string; format?: 'num' | 'date'; }
interface TriSpec { label: string; key: string; dir: 'asc' | 'desc'; }
interface TuileConfig { titre: string; cols: Colonne[]; sorts: TriSpec[]; }

// Cockpit interactif (04/09/2026) — après une maquette cliquable (Artifact,
// données fictives) pour valider le principe avec l'utilisateur : chaque
// tuile s'ouvre sur son détail (GET /api/dashboard/detail/:type), triable
// via un menu déroulant, tri fait côté client (résultats déjà plafonnés
// côté serveur, pas besoin d'un tri SQL). 3 tuiles ajoutées par rapport à
// la version du 17/08/2026 (congés en attente, dossiers dormants, taux de
// réalisation) — les deux premières comblent les gaps « tâches perso »/
// « rentabilité » de la spec d'origine du Cockpit, jamais construits.
//
// Confidentialité : chaque tuile financière/RH suit exactement la même
// permission que l'écran dont elle tire ses données (factures.consulter,
// cabinet.consulter) — jamais un concept de permission propre au Cockpit.
// Les tuiles elles-mêmes disparaissent (via @if sur la valeur null renvoyée
// par le serveur) et, pour "Heures (mois)" dont le total reste public mais
// pas le détail par personne, seul le clic est désactivé (peutVoirDetail()).
const PERMISSION_TUILE: Record<string, string | null> = {
  actifs: null, urgents: null, audiences: null, impayes: 'factures.consulter',
  heures: 'cabinet.consulter', probono: null, conges: 'cabinet.consulter',
  dormants: null, realisation: 'factures.consulter',
};

const CONFIG: Record<string, TuileConfig> = {
  actifs: {
    titre: 'Dossiers actifs',
    cols: [
      { key: 'numero', label: 'Référence' }, { key: 'intitule', label: 'Intitulé' },
      { key: 'client', label: 'Client' }, { key: 'pole', label: 'Pôle' },
      { key: 'date_ouverture', label: 'Ouvert le', format: 'date' },
    ],
    sorts: [
      { label: 'Ouvert le (plus récent)', key: 'date_ouverture', dir: 'desc' },
      { label: 'Ouvert le (plus ancien)', key: 'date_ouverture', dir: 'asc' },
      { label: 'Client (A → Z)', key: 'client', dir: 'asc' },
    ],
  },
  urgents: {
    titre: 'Dossiers urgents',
    cols: [
      { key: 'numero', label: 'Référence' }, { key: 'client', label: 'Client' },
      { key: 'responsable', label: 'Responsable' },
      { key: 'date_echeance', label: 'Échéance', format: 'date' },
      { key: 'jours_restants', label: 'Jours restants', format: 'num' },
    ],
    sorts: [
      { label: 'Jours restants (le plus urgent)', key: 'jours_restants', dir: 'asc' },
      { label: 'Échéance', key: 'date_echeance', dir: 'asc' },
      { label: 'Responsable (A → Z)', key: 'responsable', dir: 'asc' },
    ],
  },
  audiences: {
    titre: 'Audiences (7 jours)',
    cols: [
      { key: 'dossier', label: 'Dossier' }, { key: 'titre', label: 'Nature' },
      { key: 'date_echeance', label: 'Date', format: 'date' },
    ],
    sorts: [{ label: 'Date (la plus proche)', key: 'date_echeance', dir: 'asc' }],
  },
  impayes: {
    titre: 'Impayés',
    cols: [
      { key: 'numero', label: 'Facture' }, { key: 'client', label: 'Client' },
      { key: 'montant_ttc', label: 'Montant TTC', format: 'num' },
      { key: 'jours_retard', label: 'Jours de retard', format: 'num' },
    ],
    sorts: [
      { label: 'Montant (décroissant)', key: 'montant_ttc', dir: 'desc' },
      { label: 'Retard (le plus long)', key: 'jours_retard', dir: 'desc' },
      { label: 'Client (A → Z)', key: 'client', dir: 'asc' },
    ],
  },
  heures: {
    titre: 'Heures (mois) — par collaborateur',
    cols: [{ key: 'nom', label: 'Collaborateur' }, { key: 'heures', label: 'Heures', format: 'num' }],
    sorts: [
      { label: 'Heures (décroissant)', key: 'heures', dir: 'desc' },
      { label: 'Collaborateur (A → Z)', key: 'nom', dir: 'asc' },
    ],
  },
  probono: {
    titre: 'Pro bono sous le seuil',
    cols: [
      { key: 'numero', label: 'Référence' }, { key: 'client', label: 'Client' },
      { key: 'responsable', label: 'Responsable' }, { key: 'frais', label: 'Frais engagés', format: 'num' },
    ],
    sorts: [
      { label: 'Frais engagés (croissant)', key: 'frais', dir: 'asc' },
      { label: 'Responsable (A → Z)', key: 'responsable', dir: 'asc' },
    ],
  },
  conges: {
    titre: 'Congés en attente',
    cols: [
      { key: 'demandeur', label: 'Demandeur' }, { key: 'type', label: 'Type' },
      { key: 'date_debut', label: 'Du', format: 'date' }, { key: 'date_fin', label: 'Au', format: 'date' },
      { key: 'soumis', label: 'Soumis le', format: 'date' },
    ],
    sorts: [
      { label: 'Date de début (la plus proche)', key: 'date_debut', dir: 'asc' },
      { label: 'Soumis le (le plus ancien)', key: 'soumis', dir: 'asc' },
    ],
  },
  dormants: {
    titre: 'Dossiers dormants (30 j sans mouvement)',
    cols: [
      { key: 'numero', label: 'Référence' }, { key: 'intitule', label: 'Intitulé' },
      { key: 'responsable', label: 'Responsable' },
      { key: 'dernier_mouvement', label: 'Dernier mouvement', format: 'date' },
      { key: 'jours_inactivite', label: "Jours d'inactivité", format: 'num' },
    ],
    sorts: [
      { label: "Jours d'inactivité (décroissant)", key: 'jours_inactivite', dir: 'desc' },
      { label: 'Responsable (A → Z)', key: 'responsable', dir: 'asc' },
    ],
  },
  realisation: {
    titre: 'Taux de réalisation — par collaborateur',
    cols: [
      { key: 'nom', label: 'Collaborateur' }, { key: 'heures_saisies', label: 'Heures saisies', format: 'num' },
      { key: 'heures_facturees', label: 'Heures facturées', format: 'num' }, { key: 'taux', label: 'Taux (%)', format: 'num' },
    ],
    sorts: [
      { label: 'Taux (décroissant)', key: 'taux', dir: 'desc' },
      { label: 'Taux (croissant)', key: 'taux', dir: 'asc' },
      { label: 'Collaborateur (A → Z)', key: 'nom', dir: 'asc' },
    ],
  },
};

@Component({
  selector: 'app-cockpit',
  standalone: true,
  imports: [DecimalPipe, DatePipe, FormsModule],
  template: `
    <header class="page-head">
      <h1>Tableau de bord</h1>
      <p>Vue d'ensemble du cabinet</p>
    </header>

    @if (data(); as d) {
      <div class="kpis">
        <button type="button" class="kpi" [class.active]="ouvert() === 'actifs'" (click)="clic('actifs')">
          <span class="n">{{ d.dossiers_actifs }}</span><span class="l">Dossiers actifs</span>
          @if (peutVoirDetail('actifs')) { <span class="hint">▸ voir le détail</span> }
        </button>
        <button type="button" class="kpi red" [class.active]="ouvert() === 'urgents'" (click)="clic('urgents')">
          <span class="n">{{ d.dossiers_urgents }}</span><span class="l">Dossiers urgents</span>
          @if (peutVoirDetail('urgents')) { <span class="hint">▸ voir le détail</span> }
        </button>
        <button type="button" class="kpi amber" [class.active]="ouvert() === 'audiences'" (click)="clic('audiences')">
          <span class="n">{{ d.audiences_semaine }}</span><span class="l">Audiences (7 j)</span>
          @if (peutVoirDetail('audiences')) { <span class="hint">▸ voir le détail</span> }
        </button>
        @if (d.impayes_ttc !== null) {
          <button type="button" class="kpi red" [class.active]="ouvert() === 'impayes'" (click)="clic('impayes')">
            <span class="n">{{ d.impayes_ttc | number }}</span><span class="l">Impayés (FCFA)</span>
            <span class="hint">▸ voir le détail</span>
          </button>
        }
        <button type="button" class="kpi green" [class.active]="ouvert() === 'heures'" (click)="clic('heures')">
          <span class="n">{{ d.heures_mois | number:'1.0-0' }}</span><span class="l">Heures (mois)</span>
          @if (peutVoirDetail('heures')) { <span class="hint">▸ voir le détail</span> }
        </button>
        <button type="button" class="kpi red" [class.active]="ouvert() === 'probono'" (click)="clic('probono')">
          <span class="n">{{ d.dossiers_sous_seuil_honoraires }}</span><span class="l">Dossiers pro bono sous le seuil de frais</span>
          @if (peutVoirDetail('probono')) { <span class="hint">▸ voir le détail</span> }
        </button>
        @if (d.conges_attente !== null) {
          <button type="button" class="kpi" [class.active]="ouvert() === 'conges'" (click)="clic('conges')">
            <span class="n">{{ d.conges_attente }}</span><span class="l">Congés en attente</span>
            <span class="hint">▸ voir le détail</span>
          </button>
        }
        <button type="button" class="kpi" [class.active]="ouvert() === 'dormants'" (click)="clic('dormants')">
          <span class="n">{{ d.dossiers_dormants }}</span><span class="l">Dossiers dormants</span>
          @if (peutVoirDetail('dormants')) { <span class="hint">▸ voir le détail</span> }
        </button>
        @if (d.taux_realisation !== null) {
          <button type="button" class="kpi amber" [class.active]="ouvert() === 'realisation'" (click)="clic('realisation')">
            <span class="n">{{ d.taux_realisation }} %</span><span class="l">Taux de réalisation</span>
            <span class="hint">▸ voir le détail</span>
          </button>
        }
      </div>

      @if (ouvert(); as o) {
        <section class="panel detail">
          <div class="detail-head">
            <h3>{{ CONFIG[o].titre }}</h3>
            <button type="button" class="lien" (click)="fermer()">✕ Fermer</button>
          </div>
          <div class="controls">
            <label>Trier par
              <select class="in" [ngModel]="triIndex()" (ngModelChange)="triIndex.set($event)" name="tri">
                @for (s of CONFIG[o].sorts; track $index) { <option [value]="$index">{{ s.label }}</option> }
              </select>
            </label>
          </div>
          @if (chargementDetail()) {
            <p class="muted">Chargement…</p>
          } @else if (lignesTriees().length) {
            <table>
              <tr>@for (c of CONFIG[o].cols; track c.key) { <th>{{ c.label }}</th> }</tr>
              @for (r of lignesTriees(); track $index) {
                <tr>
                  @for (c of CONFIG[o].cols; track c.key) {
                    <td [class.num]="c.format === 'num'">
                      @switch (c.format) {
                        @case ('date') { {{ r[c.key] ? (r[c.key] | date:'dd/MM/yyyy') : '—' }} }
                        @case ('num') { {{ (r[c.key] !== null && r[c.key] !== undefined) ? (r[c.key] | number) : '—' }} }
                        @default { {{ r[c.key] ?? '—' }} }
                      }
                    </td>
                  }
                </tr>
              }
            </table>
          } @else {
            <p class="muted">Aucun élément.</p>
          }
        </section>
      }

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
  styles: [`
    .kpi{cursor:pointer;font-family:inherit;text-align:left;transition:box-shadow .15s}
    .kpi:hover{box-shadow:0 3px 10px rgba(31,42,68,.10)}
    .kpi.active{background:var(--light);box-shadow:inset 0 0 0 2px var(--gold)}
    .kpi .hint{font-size:10.5px;color:var(--gold);margin-top:6px;font-weight:600}
    .detail .detail-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
    .detail h3{margin:0}
    .lien{background:none;border:1px solid var(--line);color:var(--grey);border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer}
    .lien:hover{border-color:var(--grey)}
    .controls{margin:14px 0;padding-top:12px;border-top:1px solid var(--line)}
    .controls label{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--grey);font-weight:600;text-transform:uppercase;letter-spacing:.03em;max-width:280px}
    .controls select{font-family:inherit;font-size:13px;font-weight:500;text-transform:none;letter-spacing:0;padding:7px 10px}
    td.num, th.num{text-align:right;font-variant-numeric:tabular-nums}
  `],
})
export class CockpitComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly data = signal<DashboardData | null>(null);
  readonly erreur = signal('');

  readonly CONFIG = CONFIG;
  readonly ouvert = signal<string | null>(null);
  readonly lignesDetail = signal<any[]>([]);
  readonly chargementDetail = signal(false);
  // Doit être un signal (pas une propriété simple) : lignesTriees() est un
  // computed() et ne se recalcule que si un signal qu'il lit change — une
  // propriété normale mise à jour par [(ngModel)] ne le déclenche jamais.
  // Bug trouvé le 04/09/2026 (« la table de tri ne semble pas fonctionner »).
  readonly triIndex = signal(0);

  readonly lignesTriees = computed(() => {
    const o = this.ouvert();
    if (!o) return [];
    const cfg = CONFIG[o];
    const sort = cfg.sorts[this.triIndex()] ?? cfg.sorts[0];
    const col = cfg.cols.find((c) => c.key === sort.key);
    const rows = [...this.lignesDetail()];
    rows.sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      let cmp: number;
      if (av === null || av === undefined) cmp = bv === null || bv === undefined ? 0 : 1;
      else if (bv === null || bv === undefined) cmp = -1;
      else if (col?.format === 'num') cmp = Number(av) - Number(bv);
      else if (col?.format === 'date') cmp = new Date(av).getTime() - new Date(bv).getTime();
      else cmp = String(av).localeCompare(String(bv), 'fr');
      return sort.dir === 'desc' ? -cmp : cmp;
    });
    return rows;
  });

  ngOnInit(): void {
    this.api.dashboard().subscribe({
      next: (d) => this.data.set(d),
      error: () => this.erreur.set('Impossible de charger le tableau de bord.'),
    });
  }

  peutVoirDetail(type: string): boolean {
    const perm = PERMISSION_TUILE[type];
    return !perm || this.auth.peut(perm);
  }

  clic(type: string): void {
    if (!this.peutVoirDetail(type)) return;
    if (this.ouvert() === type) { this.fermer(); return; }
    this.ouvert.set(type);
    this.triIndex.set(0);
    this.chargementDetail.set(true);
    this.api.dashboardDetail(type).subscribe({
      next: (rows) => { this.lignesDetail.set(rows); this.chargementDetail.set(false); },
      error: () => { this.lignesDetail.set([]); this.chargementDetail.set(false); },
    });
  }

  fermer(): void {
    this.ouvert.set(null);
    this.lignesDetail.set([]);
  }
}
