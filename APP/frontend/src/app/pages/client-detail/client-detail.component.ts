import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DocumentPreviewService } from '../../core/document-preview.service';

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
          <div style="display:flex;gap:10px;align-items:center">
            <span class="tag" [class.haute]="c.kyc_statut === 'piece_expiree'" [class.ok]="c.kyc_statut === 'a_jour'">
              KYC : {{ libelleKyc(c.kyc_statut) }}
            </span>
            <button class="btn ghost" (click)="modeEdition() ? annulerEdition() : activerEdition(c)">
              {{ modeEdition() ? 'Annuler' : 'Modifier' }}
            </button>
            @if (auth.peut('clients.supprimer')) {
              <button class="btn ghost danger" (click)="supprimerClient()">Supprimer</button>
            }
          </div>
        </div>
        <div class="meta">
          <div><span>Email</span><b>{{ c.email || '—' }}</b></div>
          <div><span>Téléphone</span><b>{{ c.telephone || '—' }}</b></div>
          <div><span>Adresse</span><b>{{ c.adresse || '—' }}, {{ c.ville }}</b></div>
          <div><span>Dernière MAJ KYC</span><b>{{ c.kyc_maj_le ? (c.kyc_maj_le | date:'dd/MM/yyyy') : '—' }}</b></div>
        </div>
      </div>

      @if (modeEdition()) {
        <section class="panel">
          <h3>Modifier la fiche</h3>
          <div class="grid2">
            @if (c.type === 'morale') {
              <div><label>Dénomination</label><input class="in" [(ngModel)]="edit.denomination" name="editDenomination" /></div>
              <div><label>RCCM</label><input class="in" [(ngModel)]="edit.rccm" name="editRccm" /></div>
              <div><label>NIF</label><input class="in" [(ngModel)]="edit.nif" name="editNif" /></div>
              <div><label>Forme juridique</label><input class="in" [(ngModel)]="edit.forme_juridique" name="editForme" /></div>
            } @else {
              <div><label>Prénom</label><input class="in" [(ngModel)]="edit.prenom" name="editPrenom" /></div>
              <div><label>Nom</label><input class="in" [(ngModel)]="edit.nom" name="editNom" /></div>
              <div><label>Nationalité</label><input class="in" [(ngModel)]="edit.nationalite" name="editNationalite" /></div>
            }
            <div><label>Email</label><input class="in" type="email" [(ngModel)]="edit.email" name="editEmail" /></div>
            <div><label>Téléphone</label><input class="in" [(ngModel)]="edit.telephone" name="editTelephone" /></div>
            <div><label>Ville</label><input class="in" [(ngModel)]="edit.ville" name="editVille" /></div>
            <div><label>Pays</label><input class="in" [(ngModel)]="edit.pays" name="editPays" /></div>
            <div class="col2"><label>Adresse</label><input class="in" [(ngModel)]="edit.adresse" name="editAdresse" /></div>
            <div class="col2"><label>Bénéficiaires effectifs</label><input class="in" [(ngModel)]="edit.beneficiaires_effectifs" name="editBenef" /></div>
            <div class="col2"><label>Notes</label><input class="in" [(ngModel)]="edit.notes" name="editNotes" /></div>
          </div>
          <button class="btn" (click)="enregistrerFiche()" [disabled]="enregistrement()">
            {{ enregistrement() ? 'Enregistrement…' : 'Enregistrer' }}
          </button>
          @if (erreurEdition()) { <p class="err">{{ erreurEdition() }}</p> }
        </section>
      }

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
                <td>
                  <button class="lien" (click)="apercuPiece(p)">Aperçu</button>
                  <button class="lien" (click)="ouvrirPiece(p)">Ouvrir</button>
                  <button class="lien" (click)="supprimerPiece(p.id)">Supprimer</button>
                </td>
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
        <h3>Personnes &amp; entités liées</h3>
        <p class="muted">Bénéficiaires effectifs, filiales, dirigeants, représentants… (LBC-FT). Un lien saisi ici apparaît aussi sur la fiche de l'autre client.</p>
        @if (liensCombines(c).length) {
          <table>
            <tr><th>Nature</th><th>Client lié</th><th></th></tr>
            @for (l of liensCombines(c); track l.id) {
              <tr>
                <td>{{ l.nature }}</td>
                <td><a class="lien" [routerLink]="['/clients', l.lie_a_id]">{{ l.lie_a_nom }}</a></td>
                <td>
                  @if (auth.peut('clients.modifier')) {
                    <button class="lien" (click)="retirerLien(l.id)">Retirer</button>
                  }
                </td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucun lien enregistré.</p> }

        @if (auth.peut('clients.modifier')) {
          <div class="upload">
            <select class="sel" [(ngModel)]="nouveauLien.lie_a_id" name="lienClient">
              <option value="">Client lié…</option>
              @for (autre of autresClients(); track autre.id) {
                <option [value]="autre.id">{{ autre.denomination || (autre.prenom + ' ' + autre.nom) }}</option>
              }
            </select>
            <input class="sel" [(ngModel)]="nouveauLien.nature" name="lienNature" placeholder="Nature (ex. filiale, dirigeant, bénéficiaire effectif…)" />
            <button class="btn" (click)="ajouterLien()" [disabled]="!nouveauLien.lie_a_id || !nouveauLien.nature">Ajouter</button>
          </div>
          @if (erreurLien()) { <p class="err">{{ erreurLien() }}</p> }
        }
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
    .btn.ghost{background:#fff;border:1px solid var(--line);color:var(--slate)}
    .btn:disabled{opacity:.6}
    .lien{background:none;border:none;color:var(--gold);cursor:pointer;font-size:13px;padding:0}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    tr.expiree td{background:#fff5f4}
    .ok-msg{color:var(--green);font-size:13px;margin-top:8px}
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:14px}
    label{font-size:12px;color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
    .col2{grid-column:1 / -1}
    .btn.ghost.danger{color:var(--red);border-color:#f0c8c5}
  `],
})
export class ClientDetailComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  private readonly preview = inject(DocumentPreviewService);

  readonly client = signal<any | null>(null);
  readonly erreur = signal('');
  readonly erreurPiece = signal('');
  readonly messageKyc = signal('');
  readonly ajoutEnCours = signal(false);
  readonly typesOriginal = signal<{ code: string; libelle: string }[]>([]);

  // Édition de la fiche identité/coordonnées (ajout 18/08/2026) — le backend
  // (PUT /api/clients/:id) le permettait déjà, mais aucun écran n'exposait
  // ces champs : seul le statut KYC était modifiable via l'UI (gap signalé
  // par l'utilisateur). Même patron que dossier-detail.component.ts.
  readonly modeEdition = signal(false);
  readonly enregistrement = signal(false);
  readonly erreurEdition = signal('');
  edit: any = {};

  clientId = '';
  nouveauStatutKyc = 'a_jour';
  nouvellePiece: { libelle: string; date_expiration: string } = { libelle: '', date_expiration: '' };
  fichierChoisi: File | null = null;
  nouvelOriginal: { type_piece: string; description: string; emplacement: string } = { type_piece: '', description: '', emplacement: '' };

  // Personnes/entités liées (20/08/2026, diagnostic utilisateur) — la table
  // client_liens existait déjà (lue par GET /api/clients/:id) mais n'avait
  // jusqu'ici aucun écran ni aucune route d'écriture (voir clients.js).
  readonly clientsTous = signal<any[]>([]);
  readonly erreurLien = signal('');
  nouveauLien: { lie_a_id: string; nature: string } = { lie_a_id: '', nature: '' };

  // Combine les deux sens (liens saisis depuis cette fiche + liens saisis
  // depuis l'autre bout) en une seule liste pour l'affichage.
  liensCombines(c: any): any[] {
    return [...(c.liens || []), ...(c.liens_inverses || [])];
  }

  autresClients(): any[] {
    const dejaLies = new Set([this.clientId, ...this.liensCombines(this.client()).map((l: any) => l.lie_a_id)]);
    return this.clientsTous().filter((c) => !dejaLies.has(c.id));
  }

  ajouterLien(): void {
    if (!this.nouveauLien.lie_a_id || !this.nouveauLien.nature) return;
    this.erreurLien.set('');
    this.api.ajouterLienClient(this.clientId, this.nouveauLien).subscribe({
      next: () => { this.nouveauLien = { lie_a_id: '', nature: '' }; this.charger(); },
      error: (e) => this.erreurLien.set(e?.error?.error ?? 'Ajout impossible.'),
    });
  }

  retirerLien(lienId: string): void {
    if (!window.confirm('Retirer ce lien ?')) return;
    this.api.retirerLienClient(this.clientId, lienId).subscribe({
      next: () => this.charger(),
      error: (e) => this.erreurLien.set(e?.error?.error ?? 'Retrait impossible.'),
    });
  }

  private readonly libellesKyc: Record<string, string> = {
    a_faire: 'À faire', incomplet: 'Incomplet', piece_expiree: 'Pièce expirée', a_jour: 'À jour',
  };
  libelleKyc(statut: string): string { return this.libellesKyc[statut] ?? statut; }

  ngOnInit(): void {
    this.clientId = this.route.snapshot.paramMap.get('id') ?? '';
    this.charger();
    this.api.listesValeurs('type_original').subscribe({ next: (t) => this.typesOriginal.set(t) });
    this.api.clients().subscribe({ next: (c) => this.clientsTous.set(c) });
  }

  charger(): void {
    this.api.client(this.clientId).subscribe({
      next: (c) => { this.client.set(c); this.nouveauStatutKyc = c.kyc_statut; },
      error: () => this.erreur.set('Impossible de charger ce client.'),
    });
  }

  activerEdition(c: any): void {
    this.edit = {
      denomination: c.denomination, rccm: c.rccm, nif: c.nif, forme_juridique: c.forme_juridique,
      prenom: c.prenom, nom: c.nom, nationalite: c.nationalite,
      email: c.email, telephone: c.telephone, adresse: c.adresse, ville: c.ville, pays: c.pays,
      beneficiaires_effectifs: c.beneficiaires_effectifs, notes: c.notes,
    };
    this.erreurEdition.set('');
    this.modeEdition.set(true);
  }

  annulerEdition(): void {
    this.modeEdition.set(false);
  }

  enregistrerFiche(): void {
    this.erreurEdition.set('');
    this.enregistrement.set(true);
    this.api.majClient(this.clientId, { ...this.edit, maj_le_attendu: this.client()?.maj_le }).subscribe({
      next: () => { this.enregistrement.set(false); this.modeEdition.set(false); this.charger(); },
      error: (e) => {
        this.enregistrement.set(false);
        if (e?.status === 409) {
          this.erreurEdition.set('Cette fiche a été modifiée entre-temps — rechargement...');
          this.charger();
        } else {
          this.erreurEdition.set(e?.error?.error ?? 'Enregistrement impossible.');
        }
      },
    });
  }

  supprimerClient(): void {
    if (!window.confirm('Supprimer définitivement ce client ? Impossible si une activité (dossier, facture, pièce KYC…) est déjà enregistrée.')) return;
    this.api.supprimerClient(this.clientId).subscribe({
      next: () => this.router.navigate(['/clients']),
      error: (e) => this.erreur.set(e?.error?.error ?? 'Suppression impossible.'),
    });
  }

  majStatutKyc(): void {
    this.messageKyc.set('');
    this.api.majClient(this.clientId, {
      kyc_statut: this.nouveauStatutKyc,
      maj_le_attendu: this.client()?.maj_le,
    }).subscribe({
      next: () => { this.messageKyc.set('Statut KYC mis à jour.'); this.charger(); },
      error: (e) => {
        if (e?.status === 409) {
          this.erreur.set(e?.error?.error ?? 'Cette fiche a été modifiée entre-temps — rechargement...');
          this.charger(); // recharge la version à jour pour repartir sur des bases fraîches
        } else {
          this.erreur.set('Mise à jour impossible.');
        }
      },
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

  // Ouverture classique + aperçu sans ouverture (21/08/2026, demande
  // utilisateur) — n'existaient pas du tout ici jusqu'ici (seule la
  // suppression était exposée, alors que l'API de téléchargement existait
  // déjà). Le Content-Type renvoyé par le serveur dépend de `type_mime`,
  // capturé uniquement depuis cette même date (voir schema.sql/clients.js)
  // — les pièces plus anciennes retombent sur "aperçu non disponible".
  apercuPiece(p: any): void {
    this.preview.ouvrir(p.libelle, this.api.telechargerPieceKyc(this.clientId, p.id));
  }

  ouvrirPiece(p: any): void {
    this.api.telechargerPieceKyc(this.clientId, p.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      error: () => this.erreurPiece.set('Ouverture impossible.'),
    });
  }

  supprimerPiece(pieceId: string): void {
    if (!window.confirm('Supprimer définitivement cette pièce KYC ?')) return;
    this.api.supprimerPieceKyc(this.clientId, pieceId).subscribe({
      next: () => this.charger(),
      error: (e) => this.erreurPiece.set(e?.error?.error ?? 'Suppression impossible.'),
    });
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
