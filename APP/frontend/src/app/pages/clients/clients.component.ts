import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-clients',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink],
  template: `
    <header class="page-head">
      <div>
        <h1>Clients &amp; KYC</h1>
        <p>Registre des clients, suivi KYC/LBC-FT et alertes de pièces expirées.</p>
      </div>
      <button class="btn" (click)="afficherForm.set(!afficherForm())">
        {{ afficherForm() ? 'Annuler' : '+ Nouveau client' }}
      </button>
    </header>

    @if (alertes().length) {
      <section class="panel alerte">
        <h3>⚠ Pièces KYC expirées ou arrivant à expiration (30 jours)</h3>
        <table>
          <tr><th>Client</th><th>Pièce</th><th>Expiration</th><th>Jours restants</th></tr>
          @for (a of alertes(); track a.id) {
            <tr class="clik" [routerLink]="['/clients', a.client_id]">
              <td>{{ a.client_nom }}</td>
              <td>{{ a.libelle }}</td>
              <td>{{ a.date_expiration | date:'dd/MM/yyyy' }}</td>
              <td><span class="tag" [class.haute]="a.jours_restants < 0 || a.jours_restants <= 7">
                {{ a.jours_restants < 0 ? 'dépassé' : (a.jours_restants === 0 ? 'jour J' : 'J-' + a.jours_restants) }}
              </span></td>
            </tr>
          }
        </table>
      </section>
    }

    @if (afficherForm()) {
      <section class="panel">
        <h3>Nouveau client</h3>
        <div class="grid2">
          <div>
            <label>Type</label>
            <select class="in" [(ngModel)]="form.type" name="type">
              <option value="morale">Personne morale</option>
              <option value="physique">Personne physique</option>
            </select>
          </div>
          <div></div>

          @if (form.type === 'morale') {
            <div><label>Dénomination</label><input class="in" [(ngModel)]="form.denomination" name="denomination" /></div>
            <div><label>Forme juridique</label><input class="in" [(ngModel)]="form.forme_juridique" name="forme_juridique" /></div>
            <div><label>RCCM</label><input class="in" [(ngModel)]="form.rccm" name="rccm" /></div>
            <div><label>NIF</label><input class="in" [(ngModel)]="form.nif" name="nif" /></div>
          } @else {
            <div><label>Prénom</label><input class="in" [(ngModel)]="form.prenom" name="prenom" /></div>
            <div><label>Nom</label><input class="in" [(ngModel)]="form.nom" name="nom" /></div>
            <div><label>Nationalité</label><input class="in" [(ngModel)]="form.nationalite" name="nationalite" /></div>
            <div><label>NIF</label><input class="in" [(ngModel)]="form.nif" name="nif" /></div>
          }

          <div><label>Email</label><input class="in" [(ngModel)]="form.email" name="email" /></div>
          <div><label>Téléphone</label><input class="in" [(ngModel)]="form.telephone" name="telephone" /></div>
          <div><label>Ville</label><input class="in" [(ngModel)]="form.ville" name="ville" /></div>
          <div><label>Pays</label><input class="in" [(ngModel)]="form.pays" name="pays" placeholder="Mali" /></div>
          <div class="col2"><label>Adresse</label><input class="in" [(ngModel)]="form.adresse" name="adresse" /></div>
        </div>

        @if (doublons().length) {
          <div class="doublon">
            <b>⚠ Client(s) déjà en base ressemblant à celui-ci :</b>
            @for (d of doublons(); track d.id) {
              <p>
                <a class="lien" [routerLink]="['/clients', d.id]">{{ d.denomination || (d.prenom + ' ' + d.nom) }}</a>
                — {{ d.motifs.join(', ') }}
              </p>
            }
            <div class="btns">
              <button class="btn ghost" (click)="doublons.set([])">Annuler, je vérifie</button>
              <button class="btn" (click)="creerQuandMeme()" [disabled]="creation()">Créer quand même</button>
            </div>
          </div>
        } @else {
          <button class="btn" (click)="creer()" [disabled]="creation()">
            {{ creation() ? 'Création…' : 'Créer le client' }}
          </button>
        }
        @if (erreurCreation()) { <p class="err">{{ erreurCreation() }}</p> }
      </section>
    }

    <section class="panel">
      <div class="filtres">
        <input class="search" placeholder="Rechercher un client…"
               [(ngModel)]="recherche" (ngModelChange)="charger()" />
        <select class="in filtre-kyc" [(ngModel)]="filtreKyc" (ngModelChange)="charger()">
          <option value="">Tous statuts KYC</option>
          <option value="a_faire">À faire</option>
          <option value="incomplet">Incomplet</option>
          <option value="piece_expiree">Pièce expirée</option>
          <option value="a_jour">À jour</option>
        </select>
      </div>

      @if (clients().length) {
        <table>
          <tr><th>Client</th><th>Type</th><th>RCCM / NIF</th><th>Pays</th><th>Statut KYC</th><th>Dossiers</th></tr>
          @for (c of clients(); track c.id) {
            <tr class="clik" [routerLink]="['/clients', c.id]">
              <td>{{ c.denomination || (c.prenom + ' ' + c.nom) }}</td>
              <td>{{ c.type === 'morale' ? 'Personne morale' : 'Personne physique' }}</td>
              <td>{{ c.rccm || c.nif || '—' }}</td>
              <td>{{ c.pays }}</td>
              <td>
                <span class="tag" [class.haute]="c.kyc_statut === 'piece_expiree'"
                      [class.ok]="c.kyc_statut === 'a_jour'">
                  {{ libelleKyc(c.kyc_statut) }}
                </span>
                @if (c.pieces_expirees > 0) { <span class="tag haute">{{ c.pieces_expirees }} pièce(s) expirée(s)</span> }
              </td>
              <td>{{ c.nb_dossiers }}</td>
            </tr>
          }
        </table>
      } @else if (erreur()) {
        <p class="err">{{ erreur() }}</p>
      } @else {
        <p class="muted">Aucun client.</p>
      }
    </section>
  `,
  styles: [`
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:14px}
    label{font-size:12px;color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:680px}
    .col2{grid-column:1 / -1}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .filtres{display:flex;gap:10px;margin-bottom:14px}
    .filtre-kyc{width:auto;margin:0;max-width:220px}
    .panel.alerte{border-left:4px solid var(--amber)}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    .doublon{background:#fffaf0;border:1px solid #f0dcae;border-radius:10px;padding:14px 16px;margin-top:4px}
    .doublon p{margin:4px 0;font-size:13px}
    .doublon .btns{display:flex;gap:8px;margin-top:10px}
  `],
})
export class ClientsComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly clients = signal<any[]>([]);
  readonly alertes = signal<any[]>([]);
  readonly erreur = signal('');
  readonly afficherForm = signal(false);
  readonly creation = signal(false);
  readonly erreurCreation = signal('');
  // Contrôle de doublon avant création (20/08/2026) — voir clients.js.
  readonly doublons = signal<any[]>([]);

  recherche = '';
  filtreKyc = '';
  form: any = { type: 'morale', pays: 'Mali' };

  private readonly libellesKyc: Record<string, string> = {
    a_faire: 'À faire',
    incomplet: 'Incomplet',
    piece_expiree: 'Pièce expirée',
    a_jour: 'À jour',
  };

  libelleKyc(statut: string): string {
    return this.libellesKyc[statut] ?? statut;
  }

  ngOnInit(): void {
    this.charger();
    this.api.kycAlertes(30).subscribe({ next: (a) => this.alertes.set(a) });
  }

  charger(): void {
    this.api.clients(this.recherche, this.filtreKyc).subscribe({
      next: (c) => this.clients.set(c),
      error: () => this.erreur.set('Impossible de charger les clients.'),
    });
  }

  creer(): void {
    this.erreurCreation.set('');
    this.doublons.set([]);
    this.api.verifierDoublonClient(this.form).subscribe({
      next: (d) => { if (d.length) this.doublons.set(d); else this.creerReellement(); },
      error: () => this.creerReellement(), // le contrôle échoue → ne bloque pas la création
    });
  }

  creerQuandMeme(): void {
    this.doublons.set([]);
    this.creerReellement();
  }

  private creerReellement(): void {
    this.creation.set(true);
    this.api.creerClient(this.form).subscribe({
      next: () => {
        this.creation.set(false);
        this.afficherForm.set(false);
        this.form = { type: 'morale', pays: 'Mali' };
        this.doublons.set([]);
        this.charger();
      },
      error: (e) => {
        this.creation.set(false);
        this.erreurCreation.set(e?.error?.error ?? 'Création impossible.');
      },
    });
  }
}
