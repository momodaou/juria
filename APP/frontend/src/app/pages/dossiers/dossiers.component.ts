import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { skip } from 'rxjs';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService, Dossier } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { LibellePipe } from '../../core/libelles';

@Component({
  selector: 'app-dossiers',
  standalone: true,
  imports: [LibellePipe, FormsModule, RouterLink, DecimalPipe, DatePipe],
  template: `
    <header class="page-head">
      <h1>Dossiers</h1>
      <input class="search" placeholder="Rechercher un dossier…"
             [(ngModel)]="recherche" (ngModelChange)="charger()" />
    </header>

    @if (filtreClientNom()) {
      <p class="bandeau-filtre">Filtré sur le client <b>{{ filtreClientNom() }}</b> — <a class="lien" routerLink="." [queryParams]="{}">voir tous les dossiers</a></p>
    }

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
        <select class="filtre" [ngModel]="filtreHonoraires()" (ngModelChange)="filtreHonoraires.set($event)" name="filtreHonoraires">
          <option value="">Tous honoraires</option>
          <option value="pro_bono">Pro bono</option>
          <option value="facture">Facturé</option>
          <option value="a_facturer">À facturer</option>
          <option value="a_relancer">À facturer en retard (30 j et plus)</option>
          <option value="en_attente">En attente de facturation</option>
          <option value="toujours_pas">Toujours pas facturé</option>
          <option value="abonnement">Abonnement</option>
          <option value="success_fee">Success fee</option>
        </select>
        <select class="filtre" [(ngModel)]="filtreResponsable" (ngModelChange)="charger()">
          <option value="">Tous responsables</option>
          @if (auth.utilisateur(); as moi) { <option value="__moi__">Mes dossiers</option> }
          @for (u of utilisateurs(); track u.id) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
        </select>
      </div>

      @if (affiches().length) {
        <p class="muted infos-liste">
          <span>{{ dossiers().length }} sur {{ total() }} dossier(s)</span>
          <span>Tri : {{ libelleTri() }}</span>
          @if (tri() !== 'activite') { <button type="button" class="lien" (click)="revenirTriParDefaut()">Revenir au tri par dernière activité</button> }
        </p>
        <div class="table-scroll">
        <table>
          <tr>
            <th class="nowrap" [attr.aria-sort]="ariaTri('numero')"><button type="button" class="th-tri" (click)="trier('numero')">N°{{ fleche('numero') }}</button></th>
            <th [attr.aria-sort]="ariaTri('intitule')"><button type="button" class="th-tri" (click)="trier('intitule')">Intitulé{{ fleche('intitule') }}</button></th>
            <th [attr.aria-sort]="ariaTri('client')"><button type="button" class="th-tri" (click)="trier('client')">Client{{ fleche('client') }}</button></th>
            <th [attr.aria-sort]="ariaTri('matiere')"><button type="button" class="th-tri" (click)="trier('matiere')">Matière{{ fleche('matiere') }}</button></th>
            <th>Position du client</th>
            <th [attr.aria-sort]="ariaTri('responsable')"><button type="button" class="th-tri" (click)="trier('responsable')">Responsable{{ fleche('responsable') }}</button></th>
            <th [attr.aria-sort]="ariaTri('ouverture')"><button type="button" class="th-tri" (click)="trier('ouverture')">Ouvert le{{ fleche('ouverture') }}</button></th>
            <th [attr.aria-sort]="ariaTri('statut')"><button type="button" class="th-tri" (click)="trier('statut')">État du dossier{{ fleche('statut') }}</button></th>
            <th [attr.aria-sort]="ariaTri('phase')"><button type="button" class="th-tri" (click)="trier('phase')">Phase{{ fleche('phase') }}</button></th>
            <th [attr.aria-sort]="ariaTri('urgence')"><button type="button" class="th-tri" (click)="trier('urgence')">Urgence{{ fleche('urgence') }}</button></th>
            <th class="col-honoraires">Honoraires</th>
          </tr>
          @for (d of affiches(); track d.id) {
            <tr>
              <td class="clik nowrap" [routerLink]="['/dossiers', d.id]">
                @if (d.couleur_chemise) { <span class="pastille" [style.background]="couleurCss(d.couleur_chemise)" [title]="'Chemise ' + d.couleur_chemise"></span> }
                {{ d.numero }}
              </td>
              <td class="clik" [routerLink]="['/dossiers', d.id]">{{ d.intitule }}</td>
              <td><a class="lien" [routerLink]="['/clients', d.client_id]" (click)="$event.stopPropagation()">{{ d.client }}</a></td>
              <td class="clik" [routerLink]="['/dossiers', d.id]">{{ matiereCourte(d.matiere) }}</td>
              <td class="clik" [routerLink]="['/dossiers', d.id]">{{ libelleStatutPartie(d.instance_statut_partie, d.instance_degre, d.instance_statut_partie_precision) || '—' }}</td>
              <td class="clik" [routerLink]="['/dossiers', d.id]">{{ d.responsable }}</td>
              <td class="clik" [routerLink]="['/dossiers', d.id]">{{ d.date_ouverture | date:'dd/MM/yyyy' }}</td>
              <td class="clik" [routerLink]="['/dossiers', d.id]"><span class="tag" [class.haute]="d.statut === 'archive'">{{ d.statut | libelle:'statutDossier' }}</span></td>
              <td class="clik" [routerLink]="['/dossiers', d.id]">{{ d.phase | libelle:'phase' }}</td>
              <td class="clik" [routerLink]="['/dossiers', d.id]"><span class="tag" [class.haute]="d.urgence === 'haute'">{{ d.urgence }}</span></td>
              <td class="clik col-honoraires" [routerLink]="['/dossiers', d.id]">
                @if (etatHonoraires(d); as h) {
                  <span class="tag honoraires" [class.ok]="h.classe === 'ok'" [class.attente]="h.classe === 'attente'" [class.haute]="h.classe === 'haute'" [title]="h.titre">{{ h.libelle }}</span>
                } @else { — }
              </td>
            </tr>
          }
        </table>
        </div>
        @if (dossiers().length < total()) {
          <p class="plus"><button type="button" class="btn ghost" [disabled]="chargementPlus()" (click)="afficherPlus()">Afficher plus ({{ total() - dossiers().length }} restant(s))</button></p>
        }
      } @else if (erreur()) {
        <p class="err">{{ erreur() }}</p>
      } @else {
        <p class="muted">{{ dossiers().length ? 'Aucun dossier ne correspond à ce filtre « Honoraires ».' : 'Aucun dossier.' }}</p>
      }
    </section>
  `,
  styles: [`
    /* 24/10/2026 — une pastille ne se coupe jamais sur deux lignes (« En attente de / facturation » était déformée sur écran étroit) : la colonne s'élargit, le tableau défile au besoin. */
    .tag{display:inline-block;white-space:nowrap;vertical-align:middle}
    /* 24/10/2026 (suite) — la pastille Honoraires reste compacte : largeur plafonnée, texte sur 1 ou 2 lignes DANS un seul bloc arrondi, aligné à gauche. */
    /* Même largeur pour toutes les pastilles, texte centré : bords nets à gauche et à droite, 1 ou 2 lignes (retour de l'utilisateur, 24/10/2026). */
    /* L'intitulé et le contenu de la colonne sont centrés ensemble (les pastilles ont le texte centré). */
    .col-honoraires{text-align:center}
    .tag.honoraires{display:block;box-sizing:border-box;width:140px;white-space:normal;line-height:1.3;padding:4px 10px;border-radius:12px;text-align:center}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    .tag.attente{background:#fbf1dc;color:#9a6c12}
    .lien:hover{text-decoration:underline}
    .pastille{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}
    .filtres{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}
    .th-tri{background:none;border:none;padding:0;margin:0;font:inherit;color:inherit;text-transform:inherit;letter-spacing:inherit;cursor:pointer;text-align:left;white-space:nowrap}
    .th-tri:hover{text-decoration:underline}
    .infos-liste{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 18px;margin:0 0 8px;font-size:var(--fs-sm)}
    .plus{text-align:center;margin:14px 0 0}
    .filtre{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:var(--fs-base);max-width:220px}
    .bandeau-filtre{background:var(--light);border-radius:8px;padding:9px 14px;font-size:var(--fs-base);color:var(--slate);margin-bottom:14px}
  `],
})
export class DossiersComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly dossiers = signal<Dossier[]>([]);
  readonly total = signal(0);
  readonly chargementPlus = signal(false);
  // Tri (18/11/2026) : côté serveur (la liste est limitée à 200). Mémorisé dans l'adresse (?tri=&sens=).
  readonly tri = signal('activite');
  readonly sens = signal<'asc' | 'desc'>('desc');
  private static readonly TRIS: Record<string, { libelle: string; premier: 'asc' | 'desc' }> = {
    activite: { libelle: 'dernière activité', premier: 'desc' }, numero: { libelle: 'N°', premier: 'asc' },
    intitule: { libelle: 'intitulé', premier: 'asc' }, client: { libelle: 'client', premier: 'asc' }, matiere: { libelle: 'matière', premier: 'asc' },
    responsable: { libelle: 'responsable', premier: 'asc' }, ouverture: { libelle: 'date d’ouverture', premier: 'desc' },
    statut: { libelle: 'état du dossier', premier: 'asc' }, phase: { libelle: 'phase', premier: 'asc' }, urgence: { libelle: 'urgence', premier: 'desc' },
  };
  private lireTri(p: { get(k: string): string | null }): void {
    const t = p.get('tri') ?? 'activite';
    const cle = DossiersComponent.TRIS[t] ? t : 'activite';
    this.tri.set(cle);
    const s = p.get('sens');
    this.sens.set(s === 'asc' || s === 'desc' ? s : DossiersComponent.TRIS[cle].premier);
  }
  trier(cle: string): void {
    const sens = this.tri() === cle ? (this.sens() === 'asc' ? 'desc' : 'asc') : DossiersComponent.TRIS[cle].premier;
    this.router.navigate([], { queryParams: { tri: cle, sens }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  revenirTriParDefaut(): void {
    this.router.navigate([], { queryParams: { tri: null, sens: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  // « Indéterminée — à qualifier » → « Indéterminée » : la colonne reste étroite.
  matiereCourte(m?: string | null): string { return m ? m.split(' — ')[0] : '—'; }
  fleche(cle: string): string { return this.tri() === cle ? (this.sens() === 'asc' ? ' ▲' : ' ▼') : ''; }
  ariaTri(cle: string): string | null { return this.tri() === cle ? (this.sens() === 'asc' ? 'ascending' : 'descending') : null; }
  libelleTri(): string {
    const t = DossiersComponent.TRIS[this.tri()];
    const asc = this.sens() === 'asc';
    const detail = this.tri() === 'ouverture' || this.tri() === 'activite' ? (asc ? 'plus ancien d’abord' : 'plus récent d’abord')
      : this.tri() === 'urgence' ? (asc ? 'moins urgent d’abord' : 'plus urgent d’abord')
      : this.tri() === 'numero' ? (asc ? 'plus ancien d’abord' : 'plus récent d’abord') : (asc ? 'A → Z' : 'Z → A');
    return `${t.libelle} (${detail})`;
  }
  // 24/10/2026 — filtre « Honoraires » (signal : un computed ne se réévalue pas sur une propriété ngModel).
  readonly filtreHonoraires = signal('');
  readonly affiches = computed(() => {
    const f = this.filtreHonoraires();
    if (f === 'a_relancer') return this.dossiers().filter((d) => ['en_attente', 'toujours_pas'].includes(this.etatHonoraires(d)?.code ?? ''));
    return f ? this.dossiers().filter((d) => this.etatHonoraires(d)?.code === f) : this.dossiers();
  });
  readonly utilisateurs = signal<any[]>([]);
  readonly erreur = signal('');
  recherche = '';
  // Filtres statut/responsable (20/08/2026, diagnostic utilisateur) — le
  // backend les acceptait déjà (?statut=&responsable=), jamais exposés à
  // l'écran : la liste mélangeait systématiquement actifs et archivés,
  // sans moyen de se limiter à ses propres dossiers.
  filtreStatut = '';
  filtreResponsable = '';
  // Navigation inter-modules (06/09/2026) : arrivée depuis "Voir tous les
  // dossiers" sur la fiche client (?client=<id>&clientLabel=<nom>).
  readonly filtreClientId = signal<string | null>(null);
  readonly filtreClientNom = signal<string | null>(null);

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.lireTri(params);
    this.filtreClientId.set(params.get('client'));
    this.filtreClientNom.set(params.get('clientLabel'));
    // Lien de la notification « dossiers à facturer » : ?honoraires=a_relancer (en attente + toujours pas facturé).
    const h = params.get('honoraires');
    if (h && ['a_relancer', 'en_attente', 'toujours_pas', 'a_facturer'].includes(h)) this.filtreHonoraires.set(h);
    this.charger();
    // Les liens « voir tout… » mènent à la même page sans filtre : la page est réutilisée et seule l'adresse change. On suit donc
    // l'adresse (hors première émission, déjà lue ci-dessus) au lieu de ne la lire qu'une fois (15/11/2026).
    let dernierHonoraires = h;
    this.route.queryParamMap.pipe(skip(1)).subscribe((p) => {
      this.lireTri(p);
      this.filtreClientId.set(p.get('client'));
      this.filtreClientNom.set(p.get('clientLabel'));
      // le filtre « honoraires » n'est touché que si le paramètre change (il peut aussi se choisir à la main)
      const nouveau = p.get('honoraires');
      if (nouveau !== dernierHonoraires) {
        dernierHonoraires = nouveau;
        this.filtreHonoraires.set(nouveau && ['a_relancer', 'en_attente', 'toujours_pas', 'a_facturer'].includes(nouveau) ? nouveau : '');
      }
      this.charger();
    });
    this.api.utilisateurs().subscribe({ next: (u) => this.utilisateurs.set(u) });
  }

  private filtresServeur(): { statut?: string; responsable?: string; masquer_archives?: boolean; client_id?: string } {
    const filtres: { statut?: string; responsable?: string; masquer_archives?: boolean; client_id?: string } = {};
    if (this.filtreStatut === '__actifs__') filtres.masquer_archives = true;
    else if (this.filtreStatut) filtres.statut = this.filtreStatut;
    if (this.filtreResponsable === '__moi__') filtres.responsable = this.auth.utilisateur()?.id;
    else if (this.filtreResponsable) filtres.responsable = this.filtreResponsable;
    const clientId = this.filtreClientId();
    if (clientId) filtres.client_id = clientId;
    return filtres;
  }

  private numeroChargement = 0;
  charger(): void {
    const n = ++this.numeroChargement; // une réponse plus ancienne ne remplace jamais une plus récente
    this.api.dossiersTries(this.recherche, this.filtresServeur(), this.tri(), this.sens()).subscribe({
      next: (r) => { if (n === this.numeroChargement) { this.dossiers.set(r.lignes); this.total.set(r.total); this.erreur.set(''); } },
      error: () => this.erreur.set('Impossible de charger les dossiers.'),
    });
  }
  afficherPlus(): void {
    const n = ++this.numeroChargement;
    this.chargementPlus.set(true);
    this.api.dossiersTries(this.recherche, this.filtresServeur(), this.tri(), this.sens(), this.dossiers().length).subscribe({
      next: (r) => {
        this.chargementPlus.set(false);
        if (n !== this.numeroChargement) return;
        const deja = new Set(this.dossiers().map((d) => d.id));
        this.dossiers.set([...this.dossiers(), ...r.lignes.filter((d) => !deja.has(d.id))]);
        this.total.set(r.total);
      },
      error: () => { this.chargementPlus.set(false); this.erreur.set('Impossible de charger la suite des dossiers.'); },
    });
  }

  // 09/10/2026 — nouvelle maquette de chemises à rabat (4 couleurs
  // physiques réelles, DOC/CLAUDE CODE - JURIA/JFC - 4 CHEMISES A
  // RABAT.pdf) : "dore" fusionne Civil/Foncier/Famille/Immobilier (ni
  // jaune ni orange) — hex extrait par décodage pixel de la maquette,
  // même méthode que le logo du cabinet. "jaune"/"orange" restent dans
  // la table (valeurs mortes, plus aucun code n'y pointe) par prudence.
  private readonly couleursCss: Record<string, string> = {
    rouge: '#c0392b', jaune: '#d4ac0d', bleu: '#2874a6', vert: '#229954',
    orange: '#d35400', violet: '#7d3c98', gris: '#95a5a6', dore: '#C89938',
  };
  couleurCss(couleur: string): string { return this.couleursCss[couleur] ?? '#ccc'; }

  // 24/10/2026 — colonne unique « Honoraires » (remplace « Pro bono » + « Facturation »,
  // deux colonnes qui s'excluaient mutuellement et restaient presque toujours vides).
  // Une seule valeur par dossier, par priorité : pro bono (3 états) → dossier non actif (« — »)
  // → abonnement → success fee → facturé → à facturer / en attente (30 j) / toujours pas (60 j).
  // Règles et seuils inchangés (voir facturationDiscipline.js) : seul l'affichage change.
  etatHonoraires(d: Dossier): { code: string; libelle: string; classe: '' | 'ok' | 'attente' | 'haute'; titre: string } | null {
    if (d.pro_bono) {
      const seuil = `${Math.round(d.cumul_xof ?? 0).toLocaleString('fr-FR')} / ${Math.round(d.honoraires_seuil_xof ?? 0).toLocaleString('fr-FR')} FCFA`;
      switch (d.statut_honoraires) {
        case 'atteint': return { code: 'pro_bono', libelle: 'Pro bono · seuil atteint', classe: 'ok', titre: seuil };
        case 'sous_seuil': return { code: 'pro_bono', libelle: 'Pro bono · sous le seuil', classe: 'attente', titre: seuil };
        default: return { code: 'pro_bono', libelle: 'Pro bono · sans frais', classe: 'haute', titre: seuil };
      }
    }
    if (d.statut !== 'ouvert' && d.statut !== 'en_cours') return null;
    if (d.mode_honoraires === 'abonnement') return { code: 'abonnement', libelle: 'Abonnement', classe: '', titre: 'Convention-cadre : facturation au niveau du client' };
    if (d.mode_honoraires === 'success_fee') return { code: 'success_fee', libelle: 'Success fee', classe: '', titre: 'Honoraires de résultat : rien à facturer avant l’issue du dossier' };
    if ((d.cumul_xof ?? 0) > 0) return { code: 'facture', libelle: 'Facturé', classe: 'ok', titre: `${Math.round(d.cumul_xof).toLocaleString('fr-FR')} FCFA facturés` };
    const jours = Math.floor((Date.now() - new Date(d.date_ouverture).getTime()) / 86400000);
    const titre = `Ouvert depuis ${jours} jour(s), aucune facture émise`;
    if (d.statut_facturation === 'toujours_pas') return { code: 'toujours_pas', libelle: 'Toujours pas facturé', classe: 'haute', titre };
    if (d.statut_facturation === 'en_attente') return { code: 'en_attente', libelle: 'En attente de facturation', classe: 'attente', titre };
    return { code: 'a_facturer', libelle: 'À facturer', classe: '', titre };
  }

  libelleHonoraires(statut: string | null): string {
    switch (statut) {
      case 'atteint': return 'Seuil atteint';
      case 'sous_seuil': return 'Sous le seuil';
      case 'sans_honoraires': return 'Sans honoraires';
      default: return statut ?? '—';
    }
  }

  // Discipline de facturation, Bloc B (18/09/2026) — terminologie retenue
  // avec l'utilisateur : « En attente de facturation » à 30j, « Toujours
  // pas facturé » au rappel de 60j (jamais « jamais facturé », jugé trop
  // définitif ; jamais une formule parlant de paiement/encaissement, qui
  // se confondrait avec l'alerte Impayé — sujet distinct).
  libelleFacturation(statut: string | null): string {
    switch (statut) {
      case 'en_attente': return 'En attente de facturation';
      case 'toujours_pas': return 'Toujours pas facturé';
      default: return statut ?? '';
    }
  }

  // Statut de la partie sur l'instance la plus récente (19/09/2026, demande
  // utilisateur) — demandeur/défendeur se relabellisent selon le degré
  // (Appelant/Intimé en appel, Demandeur/Défendeur au pourvoi en cassation,
  // "en opposition" pour l'opposition) ; intervenant/pénal restent
  // invariants quel que soit le degré. Voir CLAUDE.md pour la conception.
  private readonly libellesStatutPartie: Record<string, Record<string, string>> = {
    demandeur: { appel: 'Appelant', cassation: 'Demandeur au pourvoi', opposition: 'Demandeur en opposition', default: 'Demandeur' },
    defendeur: { appel: 'Intimé', cassation: 'Défendeur au pourvoi', opposition: 'Défendeur en opposition', default: 'Défendeur' },
    intervenant_volontaire: { default: 'Intervenant volontaire' },
    intervenant_force: { default: 'Intervenant forcé' },
    prevenu: { default: 'Prévenu' },
    partie_civile: { default: 'Partie civile' },
  };
  libelleStatutPartie(statut?: string | null, degre?: string | null, precision?: string | null): string {
    if (!statut) return '';
    if (statut === 'autre') return precision?.trim() ? precision.trim() : 'Autre';
    const table = this.libellesStatutPartie[statut];
    if (!table) return statut;
    return table[degre || ''] || table['default'];
  }
}
