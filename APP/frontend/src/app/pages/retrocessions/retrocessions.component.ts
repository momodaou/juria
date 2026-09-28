import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, Dossier } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MenuActionsComponent, ActionMenuItem } from '../../core/menu-actions.component';
import { libelleRole } from '../../core/roles';

@Component({
  selector: 'app-retrocessions',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, RouterLink, MenuActionsComponent],
  template: `
    <header class="page-head">
      <div>
        <h1>Rétrocessions</h1>
        <p>Calcul et suivi des rétrocessions d'honoraires — règle « tout ou rien » (décaissable seulement après encaissement intégral).</p>
      </div>
      @if (auth.peut('retrocessions.creer')) {
        <button class="btn" (click)="afficherForm.set(!afficherForm())">
          {{ afficherForm() ? 'Annuler' : '+ Nouvelle rétrocession' }}
        </button>
      }
    </header>

    @if (filtreDossierNumero()) {
      <p class="bandeau-filtre">Filtré sur le dossier <b>{{ filtreDossierNumero() }}</b> — <a class="lien" routerLink="." [queryParams]="{}">voir toutes les rétrocessions</a></p>
    }

    @if (auth.peut('retrocessions.consulter')) {
    <section class="panel">
      <h3>Pro Bono — quota mensuel (2 dossiers / associé, non reportable)</h3>
      @if (proBono().length) {
        <table>
          <tr><th>Associé</th><th>Utilisés</th><th>Restants</th></tr>
          @for (p of proBono(); track p.associe_id) {
            <tr>
              <td>{{ p.associe }}</td>
              <td>{{ p.utilises }} / {{ p.quota }}</td>
              <td><span class="tag" [class.haute]="p.restants === 0" [class.ok]="p.restants > 0">{{ p.restants }}</span></td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucun associé actif.</p> }
    </section>
    }

    @if (afficherForm()) {
      <section class="panel">
        <h3>Nouvelle rétrocession</h3>
        <div class="grid2">
          <div>
            <label>Bénéficiaire</label>
            <select class="in" [(ngModel)]="form.beneficiaire_id" name="beneficiaire" (ngModelChange)="onQualiteAuto()">
              <option value="">—</option>
              @for (u of beneficiairesEligibles(); track u.id) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }} ({{ libelleRole(u.role, 'court') }})</option> }
            </select>
          </div>
          <div>
            <label>Qualité</label>
            <select class="in" [(ngModel)]="form.qualite" name="qualite">
              @for (q of qualites(); track q.code) { <option [value]="q.code">{{ q.libelle }} — {{ q.taux }} %</option> }
            </select>
          </div>
          <div><label>Base HT (FCFA)</label><input class="in" type="number" [(ngModel)]="form.base_ht" name="baseHt" /></div>
          <div><label>Taux appliqué (%, optionnel)</label><input class="in" type="number" [(ngModel)]="form.taux" name="taux" placeholder="Par défaut selon la qualité" /></div>
          <div class="col2">
            <label>Dossier (optionnel)</label>
            <input class="in" [(ngModel)]="dossierRecherche" name="dossierRecherche"
                   (ngModelChange)="rechercherDossiers()" placeholder="Rechercher un dossier…" />
            @if (dossierResultats().length) {
              <div class="suggestions">
                @for (d of dossierResultats(); track d.id) {
                  <button type="button" class="chip" (click)="choisirDossier(d)">{{ d.numero }} — {{ d.intitule }}</button>
                }
              </div>
            }
            @if (form.dossier_id) { <p class="muted">Sélectionné : {{ dossierLabel }}</p> }
          </div>
        </div>
        <button class="btn" (click)="creer()" [disabled]="!form.beneficiaire_id || !form.qualite || !form.base_ht || creationEnCours()">{{ creationEnCours() ? 'Création…' : 'Créer' }}</button>
        @if (doublonsRetro().length) {
          <div class="doublon">
            <b>⚠ Une rétrocession très proche existe déjà :</b>
            @for (d of doublonsRetro(); track d.id) { <p>{{ d.qualite }} — base {{ d.base_ht | number }} FCFA — {{ d.montant | number }} FCFA ({{ d.statut }})</p> }
            <div class="btns">
              <button class="btn ghost" (click)="doublonsRetro.set([])">Annuler, je vérifie</button>
              <button class="btn" (click)="creerQuandMeme()" [disabled]="creationEnCours()">Créer quand même</button>
            </div>
          </div>
        }
        @if (erreur()) { <p class="err">{{ erreur() }}</p> }
      </section>
    }

    <section class="panel">
      <!-- 28/09/2026 — audit menu par menu : bug trouvé — un bénéficiaire
           sans retrocessions.consulter ne voyait JAMAIS ses propres
           rétrocessions (le backend le permet sans permission particulière,
           mais l'écran n'envoyait jamais beneficiaire_id=soi-même par
           défaut, donc 403 silencieux). Corrigé dans charger() ci-dessous ;
           le sélecteur ci-dessous n'est qu'un complément pour qui peut déjà
           tout voir. -->
      @if (auth.peut('retrocessions.consulter')) {
        <div class="upload">
          <select class="sel" [ngModel]="beneficiaireFiltreId()" (ngModelChange)="changerBeneficiaireFiltre($event)" name="benefFiltre" title="Filtrer par bénéficiaire">
            <option value="">Tous les bénéficiaires</option>
            @for (u of beneficiairesEligibles(); track u.id) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
          </select>
        </div>
      }
      @if (retros().length) {
        <table>
          <tr><th>Bénéficiaire</th><th>Qualité</th><th>Base HT</th><th>Taux</th><th>Montant</th><th>Dossier</th><th>Statut</th><th>Décaissé le</th><th></th></tr>
          @for (r of retros(); track r.id) {
            <tr>
              <td>{{ r.beneficiaire }}</td>
              <td>{{ libelleQualite(r.qualite) }}</td>
              <td>{{ r.base_ht | number }} FCFA</td>
              <td>{{ r.taux }} %</td>
              <td><b>{{ r.montant | number }} FCFA</b></td>
              <td>@if (r.dossier_id) { <a class="lien" [routerLink]="['/dossiers', r.dossier_id]">{{ r.dossier_numero }}</a> } @else { — }</td>
              <td>
                <span class="tag" [class.ok]="r.statut==='decaissee'">{{ libelleStatut(r.statut) }}</span>
                @if (r.facture_numero && !r.honoraires_encaisses) { <span class="tag haute">non encaissée</span> }
              </td>
              <td>{{ r.decaisse_le ? (r.decaisse_le | date:'dd/MM/yyyy') : '—' }}</td>
              <td><app-menu-actions [actions]="actionsPour(r)" /></td>
            </tr>
            @if (editionId() === r.id) {
              <tr class="edition">
                <td colspan="9">
                  <div class="grid2">
                    <div>
                      <label>Qualité</label>
                      <select class="in" [(ngModel)]="editForm.qualite" name="edQualite">
                        @for (q of qualites(); track q.code) { <option [value]="q.code">{{ q.libelle }} — {{ q.taux }} %</option> }
                      </select>
                    </div>
                    <div><label>Base HT (FCFA)</label><input class="in" type="number" [(ngModel)]="editForm.base_ht" name="edBaseHt" /></div>
                    <div><label>Taux appliqué (%, optionnel)</label><input class="in" type="number" [(ngModel)]="editForm.taux" name="edTaux" placeholder="Par défaut selon la qualité" /></div>
                  </div>
                  <p class="hint">Le bénéficiaire n'est pas modifiable — retirer puis recréer si erroné.</p>
                  <button class="lien" (click)="enregistrerEdition()">Enregistrer</button>
                  <button class="lien" (click)="annulerEdition()">Annuler</button>
                  @if (erreur()) { <p class="err">{{ erreur() }}</p> }
                </td>
              </tr>
            }
          }
        </table>
      } @else { <p class="muted">Aucune rétrocession.</p> }
    </section>
  `,
  styles: [`
    /* 26/09/2026 — audit doublons, même style que clients.component.ts. */
    .doublon{background:#fffaf0;border:1px solid #f0dcae;border-radius:10px;padding:14px 16px;margin-top:10px;max-width:680px}
    .doublon p{margin:4px 0;font-size:var(--fs-base)}
    .doublon .btns{display:flex;gap:8px;margin-top:10px}
    .edition td{background:var(--light);padding:12px 14px}
    .hint{display:block;font-size:var(--fs-sm);color:var(--grey);margin:0 0 10px}
    .upload{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
    .sel{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:var(--fs-base)}
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md)}
    label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:680px}
    .col2{grid-column:1 / -1}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .suggestions{display:flex;flex-wrap:wrap;gap:6px;margin:-6px 0 12px}
    .chip{background:#fff;border:1px solid var(--line);border-radius:12px;padding:5px 11px;font-size:var(--fs-sm);cursor:pointer}
    .lien:disabled{opacity:.4;cursor:not-allowed}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    .tag.haute{background:#fbe6e5;color:#b13a36}
    .bandeau-filtre{background:var(--light);border-radius:8px;padding:9px 14px;font-size:var(--fs-base);color:var(--slate);margin-bottom:14px}
  `],
})
export class RetrocessionsComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  readonly libelleRole = libelleRole;
  readonly retros = signal<any[]>([]);
  readonly qualites = signal<{ code: string; libelle: string; taux: number }[]>([]);
  readonly utilisateurs = signal<any[]>([]);
  readonly proBono = signal<any[]>([]);
  readonly dossierResultats = signal<Dossier[]>([]);
  readonly afficherForm = signal(false);
  readonly erreur = signal('');
  // 26/09/2026 — audit doublons : garde anti-double-clic + avertissement de
  // ressaisie, même patron que clients.component.ts.
  readonly creationEnCours = signal(false);
  readonly doublonsRetro = signal<any[]>([]);
  // 28/09/2026 — audit menu par menu : sélecteur de bénéficiaire pour qui a
  // retrocessions.consulter (voir bug corrigé dans charger()).
  readonly beneficiaireFiltreId = signal('');

  // Navigation inter-modules (06/09/2026) — voir facturation.component.ts.
  readonly filtreDossierId = signal<string | null>(null);
  readonly filtreDossierNumero = signal<string | null>(null);

  dossierRecherche = '';
  dossierLabel = '';
  form: any = { qualite: 'associe' };

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.filtreDossierId.set(params.get('dossier'));
    this.filtreDossierNumero.set(params.get('dossierLabel'));
    this.charger();
    this.api.qualitesRetro().subscribe({ next: (q) => this.qualites.set(q) });
    this.api.utilisateurs().subscribe({ next: (u) => this.utilisateurs.set(u) });
    if (this.auth.peut('retrocessions.consulter')) {
      this.api.proBono().subscribe({ next: (p) => this.proBono.set(p), error: () => {} });
    }
  }

  // 28/09/2026 — bug trouvé en auditant : un bénéficiaire sans
  // retrocessions.consulter ne voyait jamais ses propres rétrocessions —
  // le backend les autorise sans permission particulière quand
  // beneficiaire_id === soi-même, mais cette route n'envoyait jamais ce
  // paramètre par défaut. Corrigé : self par défaut pour qui n'a pas la
  // permission de tout voir ; le sélecteur ci-dessus reste disponible pour
  // qui l'a déjà.
  charger(): void {
    const dossierId = this.filtreDossierId();
    const filtres: any = dossierId ? { dossier_id: dossierId } : {};
    if (this.auth.peut('retrocessions.consulter')) {
      if (this.beneficiaireFiltreId()) filtres.beneficiaire_id = this.beneficiaireFiltreId();
    } else {
      filtres.beneficiaire_id = this.auth.utilisateur()?.id;
    }
    this.api.retrocessions(filtres).subscribe({ next: (r) => this.retros.set(r), error: () => this.retros.set([]) });
  }

  changerBeneficiaireFiltre(id: string): void {
    this.beneficiaireFiltreId.set(id);
    this.charger();
  }

  // Rétrocessions réservées aux avocats (04/09/2026, décision explicite de
  // l'utilisateur — les juristes/stagiaires non-avocats sortent du
  // dispositif) : le bénéficiaire n'est plus choisi que parmi les avocats,
  // donc plus besoin de retomber sur la qualité "non_avocat" (10%) ici —
  // elle reste définie côté serveur uniquement pour l'historique déjà
  // enregistré, jamais réutilisable depuis ce formulaire.
  readonly ROLES_ASSOCIES = ['associe', 'associe_fondateur'];
  readonly ROLES_AVOCATS_COLLABORATEURS = ['of_counsel', 'collaborateur', 'avocat_stagiaire'];

  beneficiairesEligibles(): any[] {
    const roles = [...this.ROLES_ASSOCIES, ...this.ROLES_AVOCATS_COLLABORATEURS];
    return this.utilisateurs().filter((u) => roles.includes(u.role));
  }

  // Suggestion automatique de la qualité de rétrocession à partir du rôle
  // d'accès du bénéficiaire (toujours modifiable ensuite à la main) :
  // associé/associé-fondateur -> 30% ; avocat collaborateur/Of Counsel/
  // avocat stagiaire -> 25% (règle du cahier des charges).
  onQualiteAuto(): void {
    const u = this.utilisateurs().find((x) => x.id === this.form.beneficiaire_id);
    if (!u) return;
    if (this.ROLES_ASSOCIES.includes(u.role)) this.form.qualite = 'associe';
    else if (this.ROLES_AVOCATS_COLLABORATEURS.includes(u.role)) this.form.qualite = 'collaborateur';
  }

  // 28/09/2026 — audit menu par menu : qualité/statut affichés en code
  // ENUM brut ("associe", "attente") au lieu d'un libellé français, alors
  // que qualites() contient déjà {code, libelle}.
  libelleQualite(code: string): string {
    return this.qualites().find((q) => q.code === code)?.libelle ?? code;
  }
  private readonly libellesStatut: Record<string, string> = { attente: 'En attente', decaissee: 'Décaissée' };
  libelleStatut(code: string): string { return this.libellesStatut[code] ?? code; }

  rechercherDossiers(): void {
    this.form.dossier_id = null;
    if (this.dossierRecherche.length < 2) { this.dossierResultats.set([]); return; }
    this.api.dossiers(this.dossierRecherche).subscribe({ next: (d) => this.dossierResultats.set(d) });
  }

  choisirDossier(d: Dossier): void {
    this.form.dossier_id = d.id;
    this.dossierLabel = `${d.numero} — ${d.intitule}`;
    this.dossierResultats.set([]);
    this.dossierRecherche = '';
  }

  creer(): void {
    this.erreur.set('');
    this.doublonsRetro.set([]);
    this.api.verifierDoublonRetrocession(this.form).subscribe({
      next: (d) => { if (d.length) this.doublonsRetro.set(d); else this.creerReellement(); },
      error: () => this.creerReellement(),
    });
  }

  creerQuandMeme(): void {
    this.doublonsRetro.set([]);
    this.creerReellement();
  }

  private creerReellement(): void {
    this.creationEnCours.set(true);
    this.api.creerRetrocession(this.form).subscribe({
      next: () => {
        this.creationEnCours.set(false);
        this.afficherForm.set(false);
        this.form = { qualite: 'associe' };
        this.dossierLabel = '';
        this.doublonsRetro.set([]);
        this.charger();
      },
      error: (e) => { this.creationEnCours.set(false); this.erreur.set(e?.error?.error ?? 'Création impossible.'); },
    });
  }

  // Menu "⋮" (19/09/2026) — Décaisser est omis (pas juste désactivé) tant
  // que les honoraires liés ne sont pas intégralement encaissés : plus
  // cohérent avec le reste de l'appli, qui cache les actions impossibles
  // plutôt que de les griser.
  actionsPour(r: any): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];
    if (r.statut !== 'decaissee' && this.auth.peut('retrocessions.decaisser') && (!r.facture_numero || r.honoraires_encaisses)) {
      items.push({ label: 'Décaisser', action: () => this.decaisser(r) });
    }
    if (r.statut !== 'decaissee' && this.auth.peut('retrocessions.creer')) {
      items.push({ label: 'Modifier', action: () => this.commencerEdition(r) });
      items.push({ label: 'Retirer', action: () => this.retirer(r.id), danger: true });
    }
    return items;
  }

  // 28/09/2026 — audit menu par menu : aucune confirmation avant une
  // action financière irréversible, contrairement à "Retirer" sur ce même
  // écran.
  decaisser(r: any): void {
    if (!confirm(`Décaisser ${r.montant.toLocaleString('fr-FR')} FCFA à ${r.beneficiaire} ?`)) return;
    this.erreur.set('');
    this.api.decaisserRetrocession(r.id).subscribe({
      next: () => this.charger(),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Décaissement impossible.'),
    });
  }

  readonly editionId = signal<string | null>(null);
  editForm: any = {};
  commencerEdition(r: any): void {
    this.erreur.set('');
    this.editForm = { qualite: r.qualite, base_ht: r.base_ht, taux: r.taux };
    this.editionId.set(r.id);
  }
  annulerEdition(): void {
    this.editionId.set(null);
    this.editForm = {};
  }
  enregistrerEdition(): void {
    const id = this.editionId();
    if (!id) return;
    this.erreur.set('');
    this.api.majRetrocession(id, this.editForm).subscribe({
      next: () => { this.editionId.set(null); this.editForm = {}; this.charger(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Modification impossible.'),
    });
  }

  retirer(id: string): void {
    if (!window.confirm('Retirer cette rétrocession (saisie par erreur) ?')) return;
    this.erreur.set('');
    this.api.retirerRetrocession(id).subscribe({
      next: () => this.charger(),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Retrait impossible.'),
    });
  }
}
