import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-client-detail',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink],
  template: `
    <a routerLink="/clients" class="back">← Retour aux clients</a>

    @if (client(); as c) {
      <div class="dcard">
        <div class="dcard-top">
          <div>
            <h1>{{ c.denomination || (c.prenom + ' ' + c.nom) }}</h1>
            <div class="sub">
              {{ c.type === 'morale' ? 'Personne morale' : 'Personne physique' }}
              · {{ c.rccm || c.nif || 'Identifiant non renseigné' }} · {{ c.pays }}
            </div>
          </div>
          <span class="tag" [class.haute]="c.kyc_statut === 'piece_expiree'" [class.ok]="c.kyc_statut === 'a_jour'">
            KYC : {{ libelleKyc(c.kyc_statut) }}
          </span>
        </div>
        <div class="meta">
          <div><span>Email</span><b>{{ c.email || '—' }}</b></div>
          <div><span>Téléphone</span><b>{{ c.telephone || '—' }}</b></div>
          <div><span>Adresse</span><b>{{ c.adresse || '—' }}, {{ c.ville }}</b></div>
          <div><span>Dernière MAJ KYC</span><b>{{ c.kyc_maj_le ? (c.kyc_maj_le | date:'dd/MM/yyyy') : '—' }}</b></div>
        </div>
      </div>

      <section class="panel">
        <h3>Statut KYC</h3>
        <div class="upload">
          <select class="sel" [(ngModel)]="nouveauStatutKyc" name="statutKyc">
            <option value="a_faire">À faire</option>
            <option value="incomplet">Incomplet</option>
            <option value="piece_expiree">Pièce expirée</option>
            <option value="a_jour">À jour</option>
          </select>
          <button class="btn" (click)="majStatutKyc()">Mettre à jour le statut</button>
        </div>
        @if (messageKyc()) { <p class="ok-msg">{{ messageKyc() }}</p> }
      </section>

      <section class="panel">
        <h3>Pièces KYC / LBC-FT</h3>
        @if (c.pieces_kyc?.length) {
          <table>
            <tr><th>Pièce</th><th>Expiration</th><th>Ajoutée le</th><th></th></tr>
            @for (p of c.pieces_kyc; track p.id) {
              <tr [class.expiree]="p.expiree">
                <td>{{ p.libelle }}</td>
                <td>{{ p.date_expiration ? (p.date_expiration | date:'dd/MM/yyyy') : '—' }}
                  @if (p.expiree) { <span class="tag haute">expirée</span> }
                </td>
                <td>{{ p.cree_le | date:'dd/MM/yyyy' }}</td>
                <td><button class="lien" (click)="supprimerPiece(p.id)">Supprimer</button></td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucune pièce enregistrée.</p> }

        <div class="upload">
          <input class="sel" [(ngModel)]="nouvellePiece.libelle" name="libelle" placeholder="Ex. Passeport, RCCM…" />
          <input class="sel" type="date" [(ngModel)]="nouvellePiece.date_expiration" name="expiration" />
          <input type="file" (change)="onFichierChoisi($event)" />
          <button class="btn" (click)="ajouterPiece()" [disabled]="!nouvellePiece.libelle || ajoutEnCours()">
            {{ ajoutEnCours() ? 'Ajout…' : 'Ajouter la pièce' }}
          </button>
        </div>
        @if (erreurPiece()) { <p class="err">{{ erreurPiece() }}</p> }
      </section>

      <section class="panel">
        <h3>Dossiers liés</h3>
        @if (c.dossiers?.length) {
          <table>
            <tr><th>N°</th><th>Intitulé</th><th>Statut</th><th>Phase</th></tr>
            @for (d of c.dossiers; track d.id) {
              <tr class="clik" [routerLink]="['/dossiers', d.id]">
                <td>{{ d.numero }}</td><td>{{ d.intitule }}</td><td>{{ d.statut }}</td><td>{{ d.phase }}</td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucun dossier pour ce client.</p> }
      </section>

      <section class="panel">
        <h3>Originaux &amp; pièces physiques confiés</h3>
        @if (c.originaux_confies?.length) {
          <table>
            <tr><th>Type</th><th>Description</th><th>Reçu le</th><th>Emplacement</th><th>Statut</th><th></th></tr>
            @for (o of c.originaux_confies; track o.id) {
              <tr>
                <td>{{ o.type_piece || '—' }}</td>
                <td>{{ o.description }}</td>
                <td>{{ o.recu_le | date:'dd/MM/yyyy' }}</td>
                <td>{{ o.emplacement || '—' }}</td>
                <td>
                  @if (o.restitue) { <span class="tag ok">Restitué le {{ o.restitue_le | date:'dd/MM/yyyy' }}</span> }
                  @else { <span class="tag">Conservé</span> }
                </td>
                <td>
                  @if (!o.restitue) { <button class="lien" (click)="restituer(o.id)">Marquer restitué</button> }
                </td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucun original confié enregistré.</p> }

        <div class="upload">
          <select class="sel" [(ngModel)]="nouvelOriginal.type_piece" name="typePiece">
            <option value="">Type…</option>
            @for (t of typesOriginal(); track t.code) { <option [value]="t.code">{{ t.libelle }}</option> }
          </select>
          <input class="sel" [(ngModel)]="nouvelOriginal.description" name="description" placeholder="Description" />
          <input class="sel" [(ngModel)]="nouvelOriginal.emplacement" name="emplacement" placeholder="Emplacement (coffre, armoire…)" />
          <button class="btn" (click)="ajouterOriginal()" [disabled]="!nouvelOriginal.description">Ajouter</button>
        </div>
      </section>

      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
    } @else if (erreur()) {
      <p class="err">{{ erreur() }}</p>
    }
  `,
  styles: [`
    .sel{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px}
    .upload{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .lien{background:none;border:none;color:var(--gold);cursor:pointer;font-size:13px;padding:0}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    tr.expiree td{background:#fff5f4}
    .ok-msg{color:var(--green);font-size:13px;margin-top:8px}
  `],
})
export class ClientDetailComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  readonly client = signal<any | null>(null);
  readonly erreur = signal('');
  readonly erreurPiece = signal('');
  readonly messageKyc = signal('');
  readonly ajoutEnCours = signal(false);
  readonly typesOriginal = signal<{ code: string; libelle: string }[]>([]);

  clientId = '';
  nouveauStatutKyc = 'a_jour';
  nouvellePiece: { libelle: string; date_expiration: string } = { libelle: '', date_expiration: '' };
  fichierChoisi: File | null = null;
  nouvelOriginal: { type_piece: string; description: string; emplacement: string } = { type_piece: '', description: '', emplacement: '' };

  private readonly libellesKyc: Record<string, string> = {
    a_faire: 'À faire', incomplet: 'Incomplet', piece_expiree: 'Pièce expirée', a_jour: 'À jour',
  };
  libelleKyc(statut: string): string { return this.libellesKyc[statut] ?? statut; }

  ngOnInit(): void {
    this.clientId = this.route.snapshot.paramMap.get('id') ?? '';
    this.charger();
    this.api.listesValeurs('type_original').subscribe({ next: (t) => this.typesOriginal.set(t) });
  }

  charger(): void {
    this.api.client(this.clientId).subscribe({
      next: (c) => { this.client.set(c); this.nouveauStatutKyc = c.kyc_statut; },
      error: () => this.erreur.set('Impossible de charger ce client.'),
    });
  }

  majStatutKyc(): void {
    this.messageKyc.set('');
    this.api.majClient(this.clientId, { kyc_statut: this.nouveauStatutKyc }).subscribe({
      next: () => { this.messageKyc.set('Statut KYC mis à jour.'); this.charger(); },
      error: () => this.erreur.set('Mise à jour impossible.'),
    });
  }

  onFichierChoisi(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.fichierChoisi = input.files?.[0] ?? null;
  }

  ajouterPiece(): void {
    this.ajoutEnCours.set(true);
    this.erreurPiece.set('');
    this.api.ajouterPieceKyc(this.clientId, this.nouvellePiece.libelle, this.nouvellePiece.date_expiration || null, this.fichierChoisi)
      .subscribe({
        next: () => {
          this.ajoutEnCours.set(false);
          this.nouvellePiece = { libelle: '', date_expiration: '' };
          this.fichierChoisi = null;
          this.charger();
        },
        error: (e) => { this.ajoutEnCours.set(false); this.erreurPiece.set(e?.error?.error ?? 'Ajout impossible.'); },
      });
  }

  supprimerPiece(pieceId: string): void {
    this.api.supprimerPieceKyc(this.clientId, pieceId).subscribe({ next: () => this.charger() });
  }

  ajouterOriginal(): void {
    this.api.creerOriginal({ client_id: this.clientId, ...this.nouvelOriginal }).subscribe({
      next: () => { this.nouvelOriginal = { type_piece: '', description: '', emplacement: '' }; this.charger(); },
      error: () => this.erreur.set('Ajout de l’original impossible.'),
    });
  }

  restituer(id: string): void {
    const a = window.prompt('Remis à (nom de la personne) :');
    if (!a) return;
    this.api.restituerOriginal(id, a).subscribe({ next: () => this.charger() });
  }
}
