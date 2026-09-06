import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
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
// Niveau de sens par tuile (06/09/2026, suite à une maquette de comparaison
// validée par l'utilisateur — voir HISTORY.md) : remplace la réutilisation
// ad hoc de rouge/ambre/vert sur des tuiles de gravité différente (ex.
// rouge servait à la fois à "urgent" et à "pro bono sous le seuil"). 4
// niveaux fixes (critique/vigilance/positif/info, classes .kpi.tier-* dans
// styles.css), indépendants des couleurs déjà prises par .kpi.red/.green/
// .amber ailleurs dans l'appli (Dépenses & caisse) — assignés directement
// en classe sur chaque bouton du template ci-dessous, pas via une table de
// correspondance séparée (la seule vraie source, c'est le markup).

const PERMISSION_TUILE: Record<string, string | null> = {
  actifs: null, urgents: null, audiences: null, impayes: 'factures.consulter',
  heures: 'cabinet.consulter', probono: null, conges: 'cabinet.consulter',
  dormants: null, realisation: 'factures.consulter',
  // 6 indicateurs de performance (04/09/2026, demande explicite de
  // l'utilisateur suite au benchmark du 03/09/2026) — tous financiers,
  // tous gardés par factures.consulter comme le reste.
  ca_mois: 'factures.consulter', impayes_aging: 'factures.consulter',
  recouvrement: 'factures.consulter', ca_pole: 'factures.consulter',
  top_clients: 'factures.consulter', productivite: 'factures.consulter',
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
  ca_mois: {
    titre: 'CA du mois — détail des factures',
    cols: [
      { key: 'numero', label: 'Facture' }, { key: 'client', label: 'Client' },
      { key: 'montant_ht', label: 'Montant HT', format: 'num' }, { key: 'date_emission', label: 'Émise le', format: 'date' },
    ],
    sorts: [
      { label: 'Montant (décroissant)', key: 'montant_ht', dir: 'desc' },
      { label: 'Émise le (plus récente)', key: 'date_emission', dir: 'desc' },
      { label: 'Client (A → Z)', key: 'client', dir: 'asc' },
    ],
  },
  impayes_aging: {
    titre: 'Ancienneté des impayés',
    cols: [
      { key: 'tranche', label: 'Tranche' }, { key: 'nb_factures', label: 'Nb. factures', format: 'num' },
      { key: 'montant', label: 'Montant (FCFA)', format: 'num' },
    ],
    sorts: [
      { label: 'Montant (décroissant)', key: 'montant', dir: 'desc' },
      { label: 'Nombre de factures (décroissant)', key: 'nb_factures', dir: 'desc' },
    ],
  },
  recouvrement: {
    titre: 'Recouvrement du mois — par client',
    cols: [
      { key: 'client', label: 'Client' }, { key: 'facture', label: 'Facturé', format: 'num' },
      { key: 'encaisse', label: 'Encaissé', format: 'num' }, { key: 'ecart', label: 'Écart', format: 'num' },
    ],
    sorts: [
      { label: 'Facturé (décroissant)', key: 'facture', dir: 'desc' },
      { label: 'Écart (le plus élevé)', key: 'ecart', dir: 'desc' },
      { label: 'Client (A → Z)', key: 'client', dir: 'asc' },
    ],
  },
  ca_pole: {
    titre: 'CA par pôle — ce mois',
    cols: [
      { key: 'pole', label: 'Pôle' }, { key: 'ca', label: 'CA (FCFA)', format: 'num' }, { key: 'pct', label: 'Part (%)', format: 'num' },
    ],
    sorts: [{ label: 'CA (décroissant)', key: 'ca', dir: 'desc' }],
  },
  top_clients: {
    titre: 'Top clients par facturation (12 derniers mois)',
    cols: [{ key: 'client', label: 'Client' }, { key: 'ca', label: 'CA (FCFA)', format: 'num' }],
    sorts: [
      { label: 'CA (décroissant)', key: 'ca', dir: 'desc' },
      { label: 'Client (A → Z)', key: 'client', dir: 'asc' },
    ],
  },
  productivite: {
    titre: 'Productivité — valeur du temps facturé, par collaborateur',
    cols: [
      { key: 'nom', label: 'Collaborateur' }, { key: 'heures_facturees', label: 'Heures facturées', format: 'num' },
      { key: 'valeur', label: 'Valeur (FCFA)', format: 'num' },
    ],
    sorts: [
      { label: 'Valeur (décroissant)', key: 'valeur', dir: 'desc' },
      { label: 'Heures facturées (décroissant)', key: 'heures_facturees', dir: 'desc' },
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
      <div class="tier-legende">
        <span class="chip"><span class="dot" style="background:var(--red)"></span>Critique — bloquant</span>
        <span class="chip"><span class="dot" style="background:var(--amber)"></span>Vigilance — à surveiller</span>
        <span class="chip"><span class="dot" style="background:var(--green)"></span>Positif — indicateur sain</span>
        <span class="chip"><span class="dot" style="background:var(--info)"></span>Informatif — pas d'alerte</span>
      </div>
      <div class="kpis">
        <button type="button" class="kpi tier-info" [class.active]="ouvert() === 'actifs'" (click)="clic('actifs')">
          <span class="tico" [innerHTML]="icons['actifs']"></span>
          <span class="n">{{ d.dossiers_actifs }}</span><span class="l">Dossiers actifs</span>
          @if (peutVoirDetail('actifs')) { <span class="hint voir"><span [innerHTML]="icons['chevron']"></span>Détail</span> }
        </button>
        <button type="button" class="kpi tier-critique" [class.active]="ouvert() === 'urgents'" (click)="clic('urgents')">
          <span class="tico" [innerHTML]="icons['urgents']"></span>
          <span class="n">{{ d.dossiers_urgents }}</span><span class="l">Dossiers urgents</span>
          @if (peutVoirDetail('urgents')) { <span class="hint voir"><span [innerHTML]="icons['chevron']"></span>Détail</span> }
        </button>
        <button type="button" class="kpi tier-info" [class.active]="ouvert() === 'audiences'" (click)="clic('audiences')">
          <span class="tico" [innerHTML]="icons['audiences']"></span>
          <span class="n">{{ d.audiences_semaine }}</span><span class="l">Audiences (7 j)</span>
          @if (peutVoirDetail('audiences')) { <span class="hint voir"><span [innerHTML]="icons['chevron']"></span>Détail</span> }
        </button>
        @if (d.impayes_ttc !== null) {
          <button type="button" class="kpi tier-vigilance" [class.active]="ouvert() === 'impayes'" (click)="clic('impayes')">
            <span class="tico" [innerHTML]="icons['impayes']"></span>
            <span class="n">{{ d.impayes_ttc | number }}</span><span class="l">Impayés (FCFA)</span>
            <span class="hint voir"><span [innerHTML]="icons['chevron']"></span>Détail</span>
          </button>
        }
        <button type="button" class="kpi tier-info" [class.active]="ouvert() === 'heures'" (click)="clic('heures')">
          <span class="tico" [innerHTML]="icons['heures']"></span>
          <span class="n">{{ d.heures_mois | number:'1.0-0' }}</span><span class="l">Heures (mois)</span>
          @if (peutVoirDetail('heures')) { <span class="hint voir"><span [innerHTML]="icons['chevron']"></span>Détail</span> }
        </button>
        <button type="button" class="kpi tier-vigilance" [class.active]="ouvert() === 'probono'" (click)="clic('probono')">
          <span class="tico" [innerHTML]="icons['probono']"></span>
          <span class="n">{{ d.dossiers_sous_seuil_honoraires }}</span><span class="l">Dossiers pro bono sous le seuil de frais</span>
          @if (peutVoirDetail('probono')) { <span class="hint voir"><span [innerHTML]="icons['chevron']"></span>Détail</span> }
        </button>
        @if (d.conges_attente !== null) {
          <button type="button" class="kpi tier-vigilance" [class.active]="ouvert() === 'conges'" (click)="clic('conges')">
            <span class="tico" [innerHTML]="icons['conges']"></span>
            <span class="n">{{ d.conges_attente }}</span><span class="l">Congés en attente</span>
            <span class="hint voir"><span [innerHTML]="icons['chevron']"></span>Détail</span>
          </button>
        }
        <button type="button" class="kpi tier-vigilance" [class.active]="ouvert() === 'dormants'" (click)="clic('dormants')">
          <span class="tico" [innerHTML]="icons['dormants']"></span>
          <span class="n">{{ d.dossiers_dormants }}</span><span class="l">Dossiers dormants</span>
          @if (peutVoirDetail('dormants')) { <span class="hint voir"><span [innerHTML]="icons['chevron']"></span>Détail</span> }
        </button>
        @if (d.taux_realisation !== null) {
          <button type="button" class="kpi tier-info" [class.active]="ouvert() === 'realisation'" (click)="clic('realisation')">
            <span class="tico" [innerHTML]="icons['realisation']"></span>
            <span class="n">{{ d.taux_realisation }} %</span><span class="l">Taux de réalisation</span>
            <span class="hint voir"><span [innerHTML]="icons['chevron']"></span>Détail</span>
          </button>
        }
        @if (d.ca_mois !== null) {
          <button type="button" class="kpi tier-positif" [class.active]="ouvert() === 'ca_mois'" (click)="clic('ca_mois')">
            <span class="tico" [innerHTML]="icons['ca_mois']"></span>
            <span class="n">{{ d.ca_mois | number }}</span><span class="l">CA du mois (FCFA)</span>
            @if (d.ca_tendance_pct !== null) {
              <span class="trend" [class.up]="d.ca_tendance_pct >= 0" [class.down]="d.ca_tendance_pct < 0">
                {{ d.ca_tendance_pct >= 0 ? '▲' : '▼' }} {{ d.ca_tendance_pct }} % vs mois dernier
              </span>
            }
            <span class="hint voir"><span [innerHTML]="icons['chevron']"></span>Détail</span>
          </button>
        }
        @if (d.impayes_60j_plus !== null) {
          <button type="button" class="kpi tier-critique" [class.active]="ouvert() === 'impayes_aging'" (click)="clic('impayes_aging')">
            <span class="tico" [innerHTML]="icons['impayes_aging']"></span>
            <span class="n">{{ d.impayes_60j_plus | number }}</span><span class="l">Impayés +60 jours (FCFA)</span>
            <span class="hint voir"><span [innerHTML]="icons['chevron']"></span>Détail</span>
          </button>
        }
        @if (d.taux_recouvrement !== null) {
          <button type="button" class="kpi tier-positif" [class.active]="ouvert() === 'recouvrement'" (click)="clic('recouvrement')">
            <span class="tico" [innerHTML]="icons['recouvrement']"></span>
            <span class="n">{{ d.taux_recouvrement }} %</span><span class="l">Taux de recouvrement (mois)</span>
            <span class="hint voir"><span [innerHTML]="icons['chevron']"></span>Détail</span>
          </button>
        }
        @if (d.ca_pole_dominant_pct !== null) {
          <button type="button" class="kpi tier-info" [class.active]="ouvert() === 'ca_pole'" (click)="clic('ca_pole')">
            <span class="tico" [innerHTML]="icons['ca_pole']"></span>
            <span class="n">{{ d.ca_pole_dominant_pct }} % <span class="pole">{{ d.ca_pole_dominant_nom }}</span></span><span class="l">CA par pôle (mois)</span>
            <span class="hint voir"><span [innerHTML]="icons['chevron']"></span>Détail</span>
          </button>
        }
        @if (d.concentration_top5_pct !== null) {
          <button type="button" class="kpi tier-info" [class.active]="ouvert() === 'top_clients'" (click)="clic('top_clients')">
            <span class="tico" [innerHTML]="icons['top_clients']"></span>
            <span class="n">{{ d.concentration_top5_pct }} %</span><span class="l">Concentration clients (top 5, 12 mois)</span>
            <span class="hint voir"><span [innerHTML]="icons['chevron']"></span>Détail</span>
          </button>
        }
        @if (d.productivite_mois !== null) {
          <button type="button" class="kpi tier-positif" [class.active]="ouvert() === 'productivite'" (click)="clic('productivite')">
            <span class="tico" [innerHTML]="icons['productivite']"></span>
            <span class="n">{{ d.productivite_mois | number }}</span><span class="l">Productivité — temps facturé (FCFA)</span>
            <span class="hint voir"><span [innerHTML]="icons['chevron']"></span>Détail</span>
          </button>
        }
      </div>

      @if (ouvert(); as o) {
        <section class="panel detail">
          <div class="detail-head">
            <h3>{{ CONFIG[o].titre }}</h3>
            <button type="button" class="fermer" (click)="fermer()"><span [innerHTML]="icons['close']"></span>Fermer</button>
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
    .kpi .hint{font-size:10.5px;color:var(--gold);margin-top:8px;font-weight:600}
    .kpi .hint.voir{display:flex;align-items:center;gap:4px}
    .kpi .trend{font-size:11px;font-weight:600;margin-top:3px}
    .kpi .trend.up{color:var(--green)}
    .kpi .trend.down{color:var(--red)}
    .kpi .n .pole{font-size:14px;color:var(--slate);font-weight:600;vertical-align:1px}
    .detail .detail-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
    .detail h3{margin:0}
    .fermer{display:flex;align-items:center;gap:6px;background:none;border:1px solid var(--line);color:var(--grey);border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;font-family:inherit}
    .fermer:hover{border-color:var(--grey)}
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
  private readonly sanitizer = inject(DomSanitizer);
  readonly data = signal<DashboardData | null>(null);
  readonly erreur = signal('');

  private icon(svg: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  }

  // Une icône par tuile, même alphabet graphique que le menu latéral
  // (viewBox 24x24, trait 1.8 sans remplissage) — 4 réutilisent tel quel le
  // SVG du menu (dossiers/facturation/rôle d'audience/clients) pour que le
  // lien visuel avec le module correspondant soit explicite.
  readonly icons: Record<string, SafeHtml> = {
    actifs: this.icon(
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>',
    ),
    urgents: this.icon(
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7"/><line x1="12" y1="13" x2="12" y2="9"/><line x1="12" y1="13" x2="15" y2="15"/><line x1="8" y1="4" x2="6" y2="6"/><line x1="16" y1="4" x2="18" y2="6"/></svg>',
    ),
    audiences: this.icon(
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21c4-2.4 7-5.2 7-9.5V5.5L12 3 5 5.5v6c0 4.3 3 7.1 7 9.5Z"/><path d="M9 12l2 2 4-4"/></svg>',
    ),
    impayes: this.icon(
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5h9l3 3V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z"/><line x1="8.5" y1="8" x2="15.5" y2="8"/><line x1="8.5" y1="12" x2="15.5" y2="12"/><line x1="8.5" y1="16" x2="12.5" y2="16"/></svg>',
    ),
    heures: this.icon(
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><line x1="12" y1="12" x2="12" y2="7"/><line x1="12" y1="12" x2="15.5" y2="13.5"/></svg>',
    ),
    probono: this.icon(
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20C6 15.5 3 12 3 8.3 3 5.6 5.1 3.5 7.7 3.5c1.7 0 3.2.9 4.3 2.4 1.1-1.5 2.6-2.4 4.3-2.4 2.6 0 4.7 2.1 4.7 4.8 0 3.7-3 7.2-9 11.7Z"/></svg>',
    ),
    conges: this.icon(
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="7.5" y1="2.5" x2="7.5" y2="6.5"/><line x1="16.5" y1="2.5" x2="16.5" y2="6.5"/><path d="M8.5 15l2 2 4.5-4.5"/></svg>',
    ),
    dormants: this.icon(
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 1 0 10.5 10.5Z"/></svg>',
    ),
    realisation: this.icon(
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16a8 8 0 0 1 16 0"/><line x1="12" y1="16" x2="16.2" y2="10.4"/></svg>',
    ),
    ca_mois: this.icon(
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,17 9,11 13,14 20,6"/><polyline points="14.5,6 20,6 20,11.5"/></svg>',
    ),
    impayes_aging: this.icon(
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="18" y2="3"/><line x1="6" y1="21" x2="18" y2="21"/><path d="M7 3c0 5 4 6 5 6s5-1 5-6"/><path d="M7 21c0-5 4-6 5-6s5 1 5 6"/></svg>',
    ),
    recouvrement: this.icon(
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 11.5a7.5 7.5 0 0 1 13-5.2"/><polyline points="17.5,3.3 17.5,6.8 14,6.8"/><path d="M19.5 12.5a7.5 7.5 0 0 1-13 5.2"/><polyline points="6.5,20.7 6.5,17.2 10,17.2"/></svg>',
    ),
    ca_pole: this.icon(
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="3" x2="12" y2="12"/><line x1="12" y1="12" x2="19.3" y2="7.5"/></svg>',
    ),
    top_clients: this.icon(
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10.5" r="2.25"/><path d="M5.5 17c.6-2.1 2.2-3.2 3.5-3.2s2.9 1.1 3.5 3.2"/><line x1="14.5" y1="9" x2="18.5" y2="9"/><line x1="14.5" y1="12.5" x2="18.5" y2="12.5"/></svg>',
    ),
    productivite: this.icon(
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v4c0 1.7 3.1 3 7 3s7-1.3 7-3V7"/><path d="M5 11v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"/></svg>',
    ),
    chevron: this.icon(
      '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9,5 16,12 9,19"/></svg>',
    ),
    close: this.icon(
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    ),
  };

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
