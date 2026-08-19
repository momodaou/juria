import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-ouverture',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <header class="page-head"><h1>Ouverture de dossier</h1></header>

    <section class="panel">
      <h3>Étape 1 — Contrôle des conflits d'intérêts (obligatoire)</h3>

      <label>Intitulé du projet de dossier</label>
      <input class="in" [(ngModel)]="intitule" name="intitule" placeholder="Ex. Bâtir-SA — recouvrement" />

      <label>Client</label>
      <input class="in" [(ngModel)]="clientNom" name="clientNom" placeholder="Ex. Bâtir-SA" />

      <label>Parties adverses / tiers liés (séparés par des virgules, facultatif)</label>
      <input class="in" [(ngModel)]="partiesAdverses" name="partiesAdverses" placeholder="Ex. SODIMA Sarl, M. Traoré" />

      <button class="btn" (click)="verifier()" [disabled]="chargement() || !clientNom">
        {{ chargement() ? 'Vérification…' : 'Lancer le contrôle' }}
      </button>

      @if (resultat(); as r) {
        <div class="result" [class.ok]="r.resultat === 'absence'" [class.warn]="r.resultat === 'potentiel'">
          <b>{{ r.resultat === 'absence' ? '✓ Absence de conflit' : '⚠ Conflit potentiel détecté' }}</b>
          <p>{{ r.message }}</p>

          <div class="verifies">
            <span class="terme">Client vérifié :</span> <span class="chip">{{ clientNom }}</span>
            @if (partiesAdversesListe().length) {
              <span class="terme">Parties adverses vérifiées :</span>
              @for (p of partiesAdversesListe(); track p) { <span class="chip">{{ p }}</span> }
            }
          </div>

          @for (d of r.details; track d.terme) {
            <div class="match">
              <span class="terme">{{ d.terme }}</span> :
              @for (c of d.correspondances; track c.id) {
                <span class="chip">{{ c.nom }} ({{ c.source }}{{ c.dossier ? ' · ' + c.dossier : '' }})</span>
              }
            </div>
          }

          @if (r.resultat === 'potentiel' && !decisionPrise()) {
            <div class="decision">
              <label>Décision de l'associé</label>
              <input class="in" [(ngModel)]="motif" name="motif" placeholder="Motif (obligatoire)" />
              <div class="btns">
                <button class="btn ghost" (click)="decider(r.id, 'refuse')">Refuser</button>
                <button class="btn ghost" (click)="decider(r.id, 'oriente')">Orienter vers un confrère</button>
                <button class="btn" (click)="decider(r.id, 'accepte')">Accepter (motivé)</button>
              </div>
            </div>
          }

          @if (decisionPrise(); as dec) {
            <p class="decision-finale">Décision enregistrée : <b>{{ dec }}</b>.
              @if (dec === 'accepte' || r.resultat === 'absence') { L'ouverture peut se poursuivre. }
            </p>
          }
        </div>
      }

      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
    </section>

    @if (peutCreer()) {
      <section class="panel">
        <h3>Étape 2 — Création du dossier</h3>

        <label>Client</label>
        <select class="in" [(ngModel)]="dossier.client_id" name="clientId">
          <option value="">— Sélectionner —</option>
          @for (c of clients(); track c.id) {
            <option [value]="c.id">{{ c.denomination || (c.prenom + ' ' + c.nom) }}</option>
          }
        </select>
        @if (!dossier.client_id && clientNom) {
          <p class="hint">Aucun client existant ne correspond exactement à « {{ clientNom }} » — vérifiez l'orthographe ci-dessus, ou <a routerLink="/clients" class="lien">créez-le dans Clients &amp; KYC</a> puis revenez sélectionner le client dans la liste.</p>
        }

        <label>Autres clients sur ce dossier (facultatif — personnes physiques ou morales additionnelles)</label>
        <div class="upload">
          <select [(ngModel)]="clientAAjouter" name="clientAAjouter">
            <option value="">Ajouter un client…</option>
            @for (c of clientsAdditionnelsDisponibles(); track c.id) {
              <option [value]="c.id">{{ c.denomination || (c.prenom + ' ' + c.nom) }}</option>
            }
          </select>
          <button class="btn ghost" type="button" (click)="ajouterClientAdditionnel()" [disabled]="!clientAAjouter">Ajouter</button>
        </div>
        @if (clientsAdditionnelsChoisis().length) {
          <div class="verifies" style="margin-bottom:12px">
            @for (c of clientsAdditionnelsChoisis(); track c.id) {
              <span class="chip">{{ c.denomination || (c.prenom + ' ' + c.nom) }} <button class="lien-x" type="button" (click)="retirerClientAdditionnel(c.id)">✕</button></span>
            }
          </div>
        }

        <label>Parties adverses (séparées par des virgules, facultatif)</label>
        <input class="in" [(ngModel)]="partiesAdversesEdit" name="partiesAdversesEdit" placeholder="Ex. SODIMA Sarl, M. Traoré" />

        <div class="grid2">
          <div>
            <label>Pôle</label>
            <select class="in" [(ngModel)]="dossier.pole" name="pole">
              <option value="contentieux">Contentieux</option>
              <option value="conseil">Conseil</option>
            </select>
          </div>
          <div>
            <label>Matière</label>
            <input class="in" [(ngModel)]="dossier.matiere" name="matiere" placeholder="Ex. Recouvrement" />
          </div>
          <div>
            <label>Juridiction</label>
            <input class="in" [(ngModel)]="dossier.juridiction" name="juridiction" placeholder="Ex. Tribunal de commerce de Bamako" />
          </div>
          <div>
            <label>Montant du litige (FCFA)</label>
            <input class="in" type="number" [(ngModel)]="dossier.montant_litige" name="montantLitige" />
          </div>
          <div>
            <label>Mode d'honoraires</label>
            <select class="in" [(ngModel)]="dossier.mode_honoraires" name="modeHonoraires">
              <option value="forfait">Forfait</option>
              <option value="temps_passe">Temps passé</option>
              <option value="success_fee">Success fee</option>
              <option value="abonnement">Abonnement</option>
              <option value="consultation">Consultation</option>
            </select>
          </div>
          <div>
            <label>Urgence</label>
            <select class="in" [(ngModel)]="dossier.urgence" name="urgence">
              <option value="moyenne">Moyenne</option>
              <option value="basse">Basse</option>
              <option value="haute">Haute</option>
            </select>
          </div>
          <div>
            <label>Responsable</label>
            <select class="in" [(ngModel)]="dossier.responsable_id" name="responsableId">
              <option value="">— Sélectionner —</option>
              @for (u of utilisateurs(); track u.id) {
                <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option>
              }
            </select>
          </div>
        </div>

        @if (auth.peut('dossiers.pro_bono.declarer')) {
          <label class="pb">
            <input type="checkbox" [(ngModel)]="dossier.pro_bono" name="proBono" />
            Dossier pro bono (soumis au quota mensuel, frais de procédure minimum plutôt que le seuil d'honoraires classique)
          </label>
        }

        <button class="btn" (click)="creerDossier()"
                [disabled]="creation() || !dossier.client_id || !dossier.matiere || !dossier.responsable_id">
          {{ creation() ? 'Création…' : 'Créer le dossier' }}
        </button>
        @if (erreurCreation()) { <p class="err">{{ erreurCreation() }}</p> }
      </section>
    }
  `,
  styles: [`
    .in{display:block;width:100%;max-width:520px;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:14px}
    label{font-size:12px;color:var(--slate);font-weight:600}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn.ghost{background:#fff;border:1px solid var(--line);color:var(--slate)}
    .btn:disabled{opacity:.6}
    .result{margin-top:16px;border-radius:10px;padding:14px 16px}
    .result.ok{background:#e3f5ec;border:1px solid #9ed9bd}
    .result.warn{background:#fffaf0;border:1px solid #f0dcae}
    .match{margin-top:8px;font-size:13px}
    .terme{font-weight:600}
    .chip{display:inline-block;background:#fff;border:1px solid var(--line);border-radius:12px;padding:2px 9px;margin:2px;font-size:12px}
    .lien-x{background:none;border:none;color:var(--slate);cursor:pointer;font-size:11px;padding:0 0 0 4px}
    .upload{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
    .upload select{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px}
    .decision{margin-top:14px}
    .decision .btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
    .decision-finale{margin-top:12px;font-size:14px}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
    .pb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--slate);margin:6px 0 14px;cursor:pointer}
    .pb input{width:auto}
    .verifies{margin-top:10px;font-size:13px}
    .verifies .terme{display:block;margin-top:6px}
    .hint{font-size:12px;color:#9a6c12;margin:-6px 0 12px}
    .hint .lien{color:#9a6c12;text-decoration:underline}
  `],
})
export class OuvertureComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  intitule = '';
  clientNom = '';
  partiesAdverses = '';
  motif = '';
  readonly resultat = signal<any | null>(null);
  readonly decisionPrise = signal<string | null>(null);
  readonly chargement = signal(false);
  readonly erreur = signal('');

  // Étape 2 — création du dossier une fois l'absence de conflit confirmée
  // (ou le conflit potentiel accepté par un associé). numero généré
  // automatiquement côté serveur (référencement automatique, AFF-AA-XXX),
  // pas demandé ici. Les parties adverses saisies à l'étape 1 sont reprises
  // ici (éditables) plutôt que de disparaître après le contrôle des
  // conflits — corrige un gap signalé par l'utilisateur : le client et les
  // parties adverses vérifiés n'apparaissaient nulle part ensuite.
  readonly clients = signal<any[]>([]);
  readonly utilisateurs = signal<any[]>([]);
  readonly creation = signal(false);
  readonly erreurCreation = signal('');
  partiesAdversesEdit = '';
  dossier: any = { pole: 'contentieux', mode_honoraires: 'forfait', urgence: 'moyenne', pro_bono: false };

  // Clients additionnels (18/08/2026) — un même dossier peut comporter
  // plusieurs identités clientes (personnes physiques ou morales).
  readonly clientsAdditionnelsIds = signal<string[]>([]);
  clientAAjouter = '';

  ngOnInit(): void {
    this.api.clients().subscribe({ next: (c) => this.clients.set(c) });
    this.api.utilisateurs().subscribe({ next: (u) => this.utilisateurs.set(u) });
  }

  partiesAdversesListe(): string[] {
    return this.partiesAdverses.split(',').map((s) => s.trim()).filter(Boolean);
  }

  clientsAdditionnelsChoisis(): any[] {
    const ids = new Set(this.clientsAdditionnelsIds());
    return this.clients().filter((c) => ids.has(c.id));
  }

  clientsAdditionnelsDisponibles(): any[] {
    const exclus = new Set([this.dossier.client_id, ...this.clientsAdditionnelsIds()]);
    return this.clients().filter((c) => !exclus.has(c.id));
  }

  ajouterClientAdditionnel(): void {
    if (!this.clientAAjouter) return;
    this.clientsAdditionnelsIds.update((ids) => [...ids, this.clientAAjouter]);
    this.clientAAjouter = '';
  }

  retirerClientAdditionnel(id: string): void {
    this.clientsAdditionnelsIds.update((ids) => ids.filter((x) => x !== id));
  }

  peutCreer(): boolean {
    const r = this.resultat();
    return !!r && (r.resultat === 'absence' || this.decisionPrise() === 'accepte');
  }

  // Pré-sélectionne le client si son nom (saisi à l'étape 1) correspond
  // exactement, à la casse près, à un client existant — sinon laisse le
  // champ vide avec l'indice affiché dans le template plutôt que de deviner.
  private preselectionnerClient(): void {
    if (this.dossier.client_id) return;
    const cible = this.clientNom.trim().toLowerCase();
    if (!cible) return;
    const trouve = this.clients().find((c: any) => {
      const nom = (c.denomination || `${c.prenom} ${c.nom}`).trim().toLowerCase();
      return nom === cible;
    });
    if (trouve) this.dossier.client_id = trouve.id;
    this.partiesAdversesEdit = this.partiesAdverses;
  }

  creerDossier(): void {
    this.erreurCreation.set('');
    this.creation.set(true);
    const partiesAdverses = this.partiesAdversesEdit.split(',').map((s) => s.trim()).filter(Boolean);
    this.api.creerDossier({
      intitule: this.intitule, ...this.dossier,
      parties_adverses: partiesAdverses,
      clients_additionnels: this.clientsAdditionnelsIds(),
    }).subscribe({
      next: (r) => { this.creation.set(false); this.router.navigate(['/dossiers', r.id]); },
      error: (e) => { this.creation.set(false); this.erreurCreation.set(e?.error?.error ?? 'Création impossible.'); },
    });
  }

  verifier(): void {
    this.chargement.set(true);
    this.erreur.set('');
    this.resultat.set(null);
    this.decisionPrise.set(null);
    const noms = [this.clientNom, ...this.partiesAdversesListe()].filter(Boolean).join(', ');
    this.api.conflictCheck({ intitule_projet: this.intitule, noms }).subscribe({
      next: (r) => { this.resultat.set(r); this.chargement.set(false); this.preselectionnerClient(); },
      error: (e) => { this.chargement.set(false); this.erreur.set(e?.error?.error ?? 'Erreur lors du contrôle'); },
    });
  }

  decider(id: string, decision: string): void {
    if (!this.motif) { this.erreur.set('Le motif est obligatoire.'); return; }
    this.erreur.set('');
    this.api.decisionConflit(id, { decision, motif: this.motif }).subscribe({
      next: (r) => this.decisionPrise.set(r.decision),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Décision impossible (rôle associé requis).'),
    });
  }
}
