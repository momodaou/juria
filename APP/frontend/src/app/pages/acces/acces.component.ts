import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, ParametresHonoraires } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-acces',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <header class="page-head">
      <div>
        <h1>Accès &amp; permissions</h1>
        <p>Création de compte, validation à l'entrée, évolution des rôles, délégations d'accès, journal d'audit. Réservé associé/admin.</p>
      </div>
      <button class="btn" (click)="afficherFormCompte.set(!afficherFormCompte())">
        {{ afficherFormCompte() ? 'Annuler' : '+ Nouveau compte' }}
      </button>
    </header>

    @if (erreurGlobale()) {
      <section class="panel"><p class="err">{{ erreurGlobale() }}</p></section>
    } @else {
      @if (afficherFormCompte()) {
        <section class="panel">
          <h3>Nouveau compte</h3>
          <div class="grid2">
            <div><label>Code</label><input class="in" [(ngModel)]="nouveauCompte.code" name="code" placeholder="Ex. HNA" /></div>
            <div>
              <label>Rôle initial</label>
              <select class="in" [(ngModel)]="nouveauCompte.role" name="roleInit">
                @for (r of roles; track r.code) { <option [value]="r.code">{{ r.libelle }}</option> }
              </select>
            </div>
            <div><label>Prénom</label><input class="in" [(ngModel)]="nouveauCompte.prenom" name="prenom" /></div>
            <div><label>Nom</label><input class="in" [(ngModel)]="nouveauCompte.nom" name="nom" /></div>
            <div class="col2"><label>Email</label><input class="in" type="email" [(ngModel)]="nouveauCompte.email" name="email" /></div>
          </div>
          <button class="btn" (click)="creerCompte()" [disabled]="!nouveauCompte.code || !nouveauCompte.prenom || !nouveauCompte.nom || !nouveauCompte.email">
            Créer (compte inactif, à valider ensuite)
          </button>
          @if (erreurCompte()) { <p class="err">{{ erreurCompte() }}</p> }
        </section>
      }

      @if (dernierMotDePasse()) {
        <section class="panel alerte">
          <h3>Mot de passe temporaire (affiché une seule fois)</h3>
          <p><b>{{ dernierMotDePasse()!.nom }}</b> — <code class="mdp">{{ dernierMotDePasse()!.mdp }}</code></p>
          <p class="muted">
            @if (dernierMotDePasse()!.creation) {
              Communiquez-le en toute sécurité à la personne concernée. Le compte reste inactif tant qu'il n'est pas validé ci-dessous.
            } @else {
              Communiquez-le en toute sécurité à la personne concernée. L'ancien mot de passe ne fonctionne plus, le statut du compte n'a pas changé.
            }
          </p>
          <button class="lien" (click)="dernierMotDePasse.set(null)">Fermer</button>
        </section>
      }

      <section class="panel">
        <h3>Membres du cabinet</h3>
        <table>
          <tr><th>Nom</th><th>Rôle</th><th>Statut</th><th></th></tr>
          @for (u of utilisateurs(); track u.id) {
            <tr>
              <td>{{ u.prenom }} {{ u.nom }} <span class="muted">({{ u.code }})</span></td>
              <td>
                <select class="sel" [ngModel]="u.role" (ngModelChange)="changerRole(u, $event)">
                  @for (r of roles; track r.code) { <option [value]="r.code">{{ r.libelle }}</option> }
                </select>
              </td>
              <td>
                <span class="tag" [class.ok]="u.actif" [class.attente]="statut(u) === 'attente'" [class.haute]="statut(u) === 'suspendu'">
                  {{ libelleStatut(u) }}
                </span>
              </td>
              <td>
                @if (statut(u) === 'attente') { <button class="lien" (click)="valider(u)">Valider</button> }
                @else { <button class="lien" (click)="basculerActif(u)">{{ u.actif ? 'Désactiver' : 'Réactiver' }}</button> }
                <button class="lien" (click)="reinitialiserMotDePasse(u)">Réinit. mot de passe</button>
              </td>
            </tr>
          }
        </table>
      </section>

      <section class="panel">
        <h3>Délégations d'accès</h3>
        <div class="upload">
          <select class="sel" [(ngModel)]="nouvelleDeleg.utilisateur_id" name="deleUser">
            <option value="">Bénéficiaire…</option>
            @for (u of utilisateurs(); track u.id) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
          </select>
          <select class="sel" [(ngModel)]="nouvelleDeleg.portee" name="delePortee">
            <option value="temporaire">Temporaire</option>
            <option value="permanent">Permanent</option>
          </select>
          <input class="sel" [(ngModel)]="nouvelleDeleg.description" name="deleDesc" placeholder="Ex. Accès facturation" style="flex:1;min-width:180px" />
          @if (nouvelleDeleg.portee === 'temporaire') {
            <input class="sel" type="date" [(ngModel)]="nouvelleDeleg.date_fin" name="deleFin" />
          }
          <button class="btn sm" (click)="accorderDelegation()" [disabled]="!nouvelleDeleg.utilisateur_id || !nouvelleDeleg.description">Accorder</button>
        </div>

        @if (delegations().length) {
          <table>
            <tr><th>Bénéficiaire</th><th>Portée</th><th>Description</th><th>Du</th><th>Au</th><th>Statut</th><th></th></tr>
            @for (d of delegations(); track d.id) {
              <tr>
                <td>{{ d.utilisateur }}</td>
                <td>{{ d.portee }}</td>
                <td>{{ d.description }}</td>
                <td>{{ d.date_debut | date:'dd/MM/yyyy' }}</td>
                <td>{{ d.date_fin ? (d.date_fin | date:'dd/MM/yyyy') : '—' }}</td>
                <td><span class="tag" [class.ok]="d.actif" [class.haute]="!d.actif">{{ d.actif ? 'Active' : 'Révoquée' }}</span></td>
                <td>@if (d.actif) { <button class="lien" (click)="revoquer(d)">Révoquer</button> }</td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucune délégation.</p> }
      </section>

      @if (auth.peut('parametres.honoraires.modifier') && parametres()) {
        <section class="panel">
          <h3>Seuils pro bono</h3>
          <p class="muted">Plancher minimum, pas un forfait imposé — un dossier pro bono peut toujours être facturé au-delà. Réservé aux avocats habilités (voir dossiers.pro_bono.declarer dans la matrice ci-dessous).</p>
          <div class="grid2">
            <div>
              <label>Frais de procédure minimum — dossier pro bono (FCFA)</label>
              <input class="in" type="number" [(ngModel)]="parametresEdit.frais_procedure_pro_bono_min_xof" name="seuilProBono" />
            </div>
            <div>
              <label>Quota pro bono (dossiers/mois/responsable)</label>
              <input class="in" type="number" [(ngModel)]="parametresEdit.quota_pro_bono_mensuel" name="quotaProBono" />
            </div>
          </div>
          <button class="btn" (click)="enregistrerParametres()">Enregistrer</button>
          @if (parametresMessage()) { <p class="muted" style="margin-top:8px">{{ parametresMessage() }}</p> }
        </section>
      }

      @if (matrice()) {
        <section class="panel">
          <h3>Matrice des permissions</h3>
          <p class="muted">Réservé Associé + Administrateur IT. Chaque case autorise (ou non) le rôle en colonne à effectuer l'action en ligne. Les cases sans coche par défaut correspondent au comportement d'origine de l'application — à ajuster librement.</p>
          <div class="matrice-scroll">
            <table class="matrice">
              <thead>
                <tr>
                  <th class="col-action">Action</th>
                  @for (r of roles; track r.code) { <th class="col-role">{{ r.court }}</th> }
                </tr>
              </thead>
              <tbody>
                @for (m of modulesMatrice(); track m) {
                  <tr class="ligne-module"><td [attr.colspan]="roles.length + 1">{{ m }}</td></tr>
                  @for (a of actionsDuModule(m); track a.code) {
                    <tr>
                      <td class="col-action">{{ a.label }} @if (a.restreinte) { <span class="pastille" title="Réservée à la direction avant l'introduction de cette matrice">★</span> }</td>
                      @for (r of roles; track r.code) {
                        <td class="col-role">
                          <input type="checkbox" [checked]="valeurPermission(r.code, a.code)" (change)="basculerPermission(r.code, a.code, $event)" />
                        </td>
                      }
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      <section class="panel">
        <h3>Journal d'audit (100 dernières actions)</h3>
        @if (audit().length) {
          <table>
            <tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Entité</th></tr>
            @for (a of audit(); track a.id) {
              <tr>
                <td>{{ a.horodatage | date:'dd/MM/yyyy HH:mm' }}</td>
                <td>{{ a.utilisateur || '—' }}</td>
                <td><span class="tag">{{ a.action }}</span></td>
                <td>{{ a.entite || '—' }}</td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucune entrée.</p> }
      </section>
    }
  `,
  styles: [`
    .sel{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px}
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:14px}
    label{font-size:12px;color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:600px}
    .col2{grid-column:1 / -1}
    .upload{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .btn.sm{padding:9px 14px;font-size:13px}
    .lien{background:none;border:none;color:var(--gold);cursor:pointer;font-size:12.5px;padding:0}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    .tag.haute{background:#fbe6e5;color:#b13a36}
    .tag.attente{background:#fbf1dc;color:#9a6c12}
    .panel.alerte{border-left:4px solid var(--amber)}
    .mdp{background:#f7f9fc;border:1px solid var(--line);border-radius:6px;padding:3px 8px;font-size:14px;font-weight:700;letter-spacing:.5px}
    .matrice-scroll{overflow-x:auto}
    table.matrice{border-collapse:collapse;font-size:12px;min-width:900px}
    table.matrice th, table.matrice td{border:1px solid var(--line);padding:6px 8px;text-align:center;white-space:nowrap}
    table.matrice .col-action{text-align:left;min-width:220px;white-space:normal}
    table.matrice .col-role{min-width:56px}
    table.matrice thead th{background:var(--light);font-weight:700;font-size:11px}
    tr.ligne-module td{background:var(--navy);color:#fff;font-weight:700;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
    .pastille{color:var(--gold);margin-left:3px}
  `],
})
export class AccesComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly utilisateurs = signal<any[]>([]);
  readonly parametres = signal<ParametresHonoraires | null>(null);
  readonly parametresMessage = signal('');
  parametresEdit: Partial<ParametresHonoraires> = {};
  readonly delegations = signal<any[]>([]);
  readonly audit = signal<any[]>([]);
  readonly erreurGlobale = signal('');
  readonly afficherFormCompte = signal(false);
  readonly erreurCompte = signal('');
  readonly dernierMotDePasse = signal<{ nom: string; mdp: string; creation: boolean } | null>(null);

  nouvelleDeleg: any = { portee: 'temporaire' };
  nouveauCompte: any = { role: 'collaborateur' };

  // 13 statuts réels du cabinet (17/08/2026, complété après coup avec
  // associe_fondateur et la distinction avocat_stagiaire/stagiaire).
  // `court` = en-tête de colonne dans la matrice de permissions ; `libelle`
  // = intitulé complet ailleurs. L'associé-fondateur a les mêmes droits
  // qu'un associé classique partout SAUF la matrice de permissions
  // elle-même (réservée associé + admin IT, voir acces.js backend).
  readonly roles: { code: string; libelle: string; court: string }[] = [
    { code: 'associe', libelle: 'Avocat associé', court: 'Associé' },
    { code: 'associe_fondateur', libelle: 'Avocat associé-fondateur', court: 'Assoc. fondateur' },
    { code: 'of_counsel', libelle: 'Avocat Of Counsel', court: 'Of Counsel' },
    { code: 'collaborateur', libelle: 'Avocat collaborateur', court: 'Collab. avocat' },
    { code: 'avocat_stagiaire', libelle: 'Avocat stagiaire', court: 'Avocat stag.' },
    { code: 'stagiaire', libelle: 'Stagiaire (non-avocat)', court: 'Stagiaire' },
    { code: 'juriste', libelle: 'Collaborateur non-avocat/juriste', court: 'Juriste' },
    { code: 'admin_general', libelle: 'Administrateur général', court: 'Admin. général' },
    { code: 'assistante', libelle: 'Assistante juridique et administrative', court: 'Assistante' },
    { code: 'comptable', libelle: 'Comptable', court: 'Comptable' },
    { code: 'assistant_comptable', libelle: 'Assistant comptable', court: 'Assist. comptable' },
    { code: 'admin_it', libelle: 'Administrateur IT', court: 'Admin. IT' },
    { code: 'archiviste', libelle: 'Archiviste', court: 'Archiviste' },
  ];

  readonly matrice = signal<{ catalogue: any[]; roles: string[]; valeurs: Record<string, boolean> } | null>(null);

  statut(u: any): 'actif' | 'attente' | 'suspendu' {
    if (u.actif) return 'actif';
    return u.valide_le ? 'suspendu' : 'attente';
  }

  libelleStatut(u: any): string {
    const s = this.statut(u);
    return s === 'actif' ? 'Actif' : s === 'attente' ? 'En attente de validation' : 'Suspendu';
  }

  ngOnInit(): void {
    this.api.utilisateurs(undefined).subscribe({ next: (u) => this.utilisateurs.set(u) });
    this.chargerDelegations();
    this.api.journalAudit().subscribe({
      next: (a) => this.audit.set(a),
      error: (e) => this.erreurGlobale.set(e?.error?.error ?? 'Accès réservé aux associés/admin.'),
    });
    // 403 attendu pour un Administrateur général (matrice réservée
    // Associé + Administrateur IT) : on masque simplement la section,
    // sans faire remonter d'erreur.
    this.api.permissionsMatrice().subscribe({
      next: (m) => this.matrice.set(m),
      error: () => this.matrice.set(null),
    });
    // 403 attendu pour tout rôle hors Associé/Administrateur IT — la
    // section est simplement masquée (auth.peut()), pas traité en erreur.
    if (this.auth.peut('parametres.honoraires.modifier')) {
      this.api.parametresHonoraires().subscribe({
        next: (p) => { this.parametres.set(p); this.parametresEdit = { ...p }; },
        error: () => {},
      });
    }
  }

  enregistrerParametres(): void {
    this.parametresMessage.set('');
    this.api.majParametresHonoraires(this.parametresEdit).subscribe({
      next: (p) => { this.parametres.set(p); this.parametresEdit = { ...p }; this.parametresMessage.set('Enregistré.'); },
      error: (e) => this.parametresMessage.set(e?.error?.error ?? 'Enregistrement impossible.'),
    });
  }

  modulesMatrice(): string[] {
    const m = this.matrice();
    if (!m) return [];
    return [...new Set(m.catalogue.map((a: any) => a.module))];
  }

  actionsDuModule(module: string): any[] {
    return (this.matrice()?.catalogue ?? []).filter((a: any) => a.module === module);
  }

  valeurPermission(role: string, actionCode: string): boolean {
    return !!this.matrice()?.valeurs[`${role}::${actionCode}`];
  }

  basculerPermission(role: string, actionCode: string, ev: Event): void {
    const autorise = (ev.target as HTMLInputElement).checked;
    this.api.majPermission(role, actionCode, autorise).subscribe({
      next: () => {
        const m = this.matrice();
        if (m) m.valeurs[`${role}::${actionCode}`] = autorise;
      },
      error: () => {
        (ev.target as HTMLInputElement).checked = !autorise; // revert visuel si l'appel échoue
      },
    });
  }

  chargerDelegations(): void {
    this.api.delegations().subscribe({ next: (d) => this.delegations.set(d) });
  }

  creerCompte(): void {
    this.erreurCompte.set('');
    this.api.creerCompte(this.nouveauCompte).subscribe({
      next: (r) => {
        this.dernierMotDePasse.set({ nom: `${r.prenom} ${r.nom}`, mdp: r.mot_de_passe_temporaire, creation: true });
        this.afficherFormCompte.set(false);
        this.nouveauCompte = { role: 'collaborateur' };
        this.api.utilisateurs(undefined).subscribe({ next: (u) => this.utilisateurs.set(u) });
      },
      error: (e) => this.erreurCompte.set(e?.error?.error ?? 'Création impossible.'),
    });
  }

  valider(u: any): void {
    this.api.validerCompte(u.id).subscribe({
      next: () => { u.actif = true; u.valide_le = new Date().toISOString(); },
      error: (e) => this.erreurGlobale.set(e?.error?.error ?? 'Validation impossible.'),
    });
  }

  reinitialiserMotDePasse(u: any): void {
    this.api.reinitialiserMotDePasse(u.id).subscribe({
      next: (r) => this.dernierMotDePasse.set({ nom: `${r.prenom} ${r.nom}`, mdp: r.mot_de_passe_temporaire, creation: false }),
      error: (e) => this.erreurGlobale.set(e?.error?.error ?? 'Réinitialisation impossible.'),
    });
  }

  changerRole(u: any, role: string): void {
    this.api.majRoleUtilisateur(u.id, role).subscribe({ next: () => { u.role = role; } });
  }

  basculerActif(u: any): void {
    this.api.majActifUtilisateur(u.id, !u.actif).subscribe({ next: () => { u.actif = !u.actif; } });
  }

  accorderDelegation(): void {
    this.api.creerDelegation(this.nouvelleDeleg).subscribe({
      next: () => { this.nouvelleDeleg = { portee: 'temporaire' }; this.chargerDelegations(); },
    });
  }

  revoquer(d: any): void {
    this.api.revoquerDelegation(d.id).subscribe({ next: () => this.chargerDelegations() });
  }
}
