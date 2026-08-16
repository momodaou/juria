import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-dossier-detail',
  standalone: true,
  imports: [DatePipe, DecimalPipe, RouterLink, FormsModule],
  template: `
    <a routerLink="/dossiers" class="back">← Retour aux dossiers</a>

    @if (dossier(); as d) {
      <div class="dcard">
        <div class="dcard-top">
          <div>
            <h1>{{ d.intitule }}</h1>
            <div class="sub">{{ d.numero }} · {{ d.matiere || d.pole }} · {{ d.juridiction }}</div>
          </div>
          <span class="tag" [class.haute]="d.urgence === 'haute'">Urgence {{ d.urgence }}</span>
        </div>
        <div class="meta">
          <div><span>Client</span><b>{{ d.client_nom }}</b></div>
          <div><span>Responsable</span><b>{{ d.responsable_nom }}</b></div>
          <div><span>Montant</span><b>{{ d.montant_litige ? (d.montant_litige | number) + ' FCFA' : '—' }}</b></div>
          <div><span>Phase</span><b>{{ d.phase }}</b></div>
          <div><span>Honoraires</span><b>{{ d.mode_honoraires || '—' }}</b></div>
        </div>
      </div>

      <section class="panel">
        <h3>Parties adverses</h3>
        @if (d.parties?.length) {
          <table>
            <tr><th>Rôle</th><th>Dénomination</th><th>Conseil</th></tr>
            @for (p of d.parties; track p.id) {
              <tr><td>{{ p.role }}</td><td>{{ p.denomination }}</td><td>{{ p.conseil || '—' }}</td></tr>
            }
          </table>
        } @else { <p class="muted">Aucune partie enregistrée.</p> }
      </section>

      <section class="panel">
        <h3>Délais & audiences</h3>
        <div class="upload">
          <select [(ngModel)]="dType" name="dtype" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px">
            <option value="audience">Audience</option>
            <option value="delai_procedure">Délai de procédure</option>
            <option value="delai_recours">Délai de recours</option>
            <option value="depot">Dépôt</option>
            <option value="prescription">Prescription</option>
          </select>
          <input [(ngModel)]="dTitre" name="dtitre" placeholder="Intitulé" style="flex:1;min-width:150px">
          <input type="date" [(ngModel)]="dDate" name="ddate">
          <button class="btn" (click)="ajouterDelai()" [disabled]="!dDate">Ajouter</button>
        </div>
        @if (evenements().length) {
          <table>
            <tr><th>Type</th><th>Intitulé</th><th>Échéance</th><th>Jours</th></tr>
            @for (e of evenements(); track e.id) {
              <tr>
                <td>{{ e.type }}</td><td>{{ e.titre }}</td>
                <td>{{ e.date_echeance | date:'dd/MM/yyyy' }}</td>
                <td><span class="tag" [class.haute]="e.jours_restants <= 7">J-{{ e.jours_restants }}</span></td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucun délai enregistré.</p> }
      </section>

      <section class="panel">
        <h3>Pièces (GED)</h3>

        <div class="upload">
          <input type="file" (change)="fichierChoisi($event)" />
          <select [(ngModel)]="categorie" name="categorie">
            <option value="piece_client">Pièce client</option>
            <option value="correspondance">Correspondance</option>
            <option value="contrat">Contrat</option>
            <option value="conclusions">Conclusions</option>
            <option value="decision">Décision</option>
            <option value="note_interne">Note interne</option>
            <option value="autre">Autre</option>
          </select>
          <button class="btn" (click)="televerser()" [disabled]="!fichier() || envoi()">
            {{ envoi() ? 'Envoi…' : 'Téléverser' }}
          </button>
        </div>

        @if (documents().length) {
          <table>
            <tr><th>Nom</th><th>Catégorie</th><th>Version</th><th>Statut</th><th></th></tr>
            @for (doc of documents(); track doc.id) {
              <tr>
                <td>{{ doc.nom }}</td><td>{{ doc.categorie }}</td>
                <td>v{{ doc.version }}</td><td>{{ doc.statut }}</td>
                <td><button class="lien" (click)="ouvrir(doc)">Ouvrir</button></td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucune pièce.</p> }
      </section>

      <section class="panel">
        <h3>Temps passé</h3>
        <div class="upload">
          <input type="number" placeholder="Durée (min)" [(ngModel)]="dureeMin" name="duree" style="width:130px" />
          <input type="text" placeholder="Description" [(ngModel)]="descTemps" name="desc" style="flex:1;min-width:180px" />
          <button class="btn" (click)="ajouterTemps()" [disabled]="!dureeMin">Ajouter</button>
        </div>
        @if (temps().length) {
          <table>
            <tr><th>Date</th><th>Durée</th><th>Facturable</th><th>Description</th></tr>
            @for (t of temps(); track t.id) {
              <tr>
                <td>{{ t.date_saisie | date:'dd/MM/yyyy' }}</td>
                <td>{{ (t.duree_minutes / 60) | number:'1.1-1' }} h</td>
                <td>{{ t.facturable ? 'Oui' : 'Non' }}</td>
                <td>{{ t.description || '—' }}</td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucun temps saisi.</p> }
      </section>

      <section class="panel">
        <h3>Fil du dossier — communications</h3>
        <div class="upload">
          <select [(ngModel)]="cType" name="ctype" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px">
            <option value="email">E-mail</option>
            <option value="courrier">Courrier</option>
            <option value="appel">Appel</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="reunion">Réunion / CR d'audience</option>
            <option value="note">Note</option>
          </select>
          <input [(ngModel)]="cSujet" name="csujet" placeholder="Sujet" style="min-width:150px">
          <input [(ngModel)]="cResume" name="cresume" placeholder="Résumé" style="flex:1;min-width:180px">
          <button class="btn" (click)="ajouterComm()" [disabled]="!cSujet">Enregistrer</button>
        </div>
        @if (communications().length) {
          <table>
            <tr><th>Date</th><th>Type</th><th>Sujet</th><th>Résumé</th></tr>
            @for (c of communications(); track c.id) {
              <tr>
                <td>{{ c.date_comm | date:'dd/MM/yyyy' }}</td>
                <td>{{ c.type }}</td><td>{{ c.sujet }}</td><td>{{ c.resume || '—' }}</td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucune communication enregistrée.</p> }
      </section>

      <section class="panel">
        <h3>Assistant IA <span class="ia-tag">projet à valider</span></h3>
        <p class="muted" style="margin-bottom:8px">Un appui, jamais une décision : toute production doit être validée par l'avocat.</p>
        <textarea [(ngModel)]="iaTexte" name="iatexte" rows="4"
          placeholder="Collez ici le texte d'une pièce à résumer…"
          style="width:100%;border:1px solid var(--line);border-radius:8px;padding:10px;font-size:13px;font-family:inherit"></textarea>
        <div class="upload" style="margin-top:8px">
          <button class="btn" (click)="iaResumer()" [disabled]="iaEnCours() || !iaTexte">Résumer (IA)</button>
          <button class="btn" style="background:#fff;border:1px solid var(--line);color:var(--slate)" (click)="iaChrono()" [disabled]="iaEnCours()">Chronologie du dossier (IA)</button>
        </div>
        @if (iaEnCours()) { <p class="muted" style="margin-top:10px">Génération en cours…</p> }
        @if (iaOut()) {
          <div style="margin-top:12px;background:#fffaf0;border:1px solid #f0dcae;border-radius:10px;padding:14px 16px">
            <b style="color:#8a6412">Assistant IA — projet à valider</b>
            <p style="white-space:pre-wrap;font-size:13px;margin-top:6px">{{ iaOut() }}</p>
          </div>
        }
      </section>
    } @else if (erreur()) {
      <p class="err">{{ erreur() }}</p>
    } @else {
      <p class="muted">Chargement…</p>
    }
  `,
  styles: [`
    .upload{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
    .upload select{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .lien{background:none;border:none;color:var(--gold);cursor:pointer;font-size:13px;padding:0}
    .ia-tag{background:#eef;border:1px solid #d5d9f5;color:#43489a;border-radius:12px;padding:2px 9px;font-size:11px;font-weight:600;margin-left:8px}
  `],
})
export class DossierDetailComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  private id = '';
  readonly dossier = signal<any | null>(null);
  readonly evenements = signal<any[]>([]);
  readonly documents = signal<any[]>([]);
  readonly erreur = signal('');

  readonly fichier = signal<File | null>(null);
  readonly envoi = signal(false);
  categorie = 'piece_client';

  readonly temps = signal<any[]>([]);
  dureeMin: number | null = null;
  descTemps = '';

  readonly communications = signal<any[]>([]);
  dType = 'audience'; dTitre = ''; dDate = '';
  cType = 'email'; cSujet = ''; cResume = '';

  iaTexte = '';
  readonly iaOut = signal('');
  readonly iaEnCours = signal(false);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.id = id;
    this.api.dossier(id).subscribe({
      next: (d) => this.dossier.set(d),
      error: () => this.erreur.set('Dossier introuvable.'),
    });
    this.rafraichirDelais();
    this.rafraichirDocuments();
    this.rafraichirTemps();
    this.rafraichirComms();
  }

  private rafraichirDelais(): void {
    this.api.dossierEvenements(this.id).subscribe({ next: (e) => this.evenements.set(e), error: () => {} });
  }
  ajouterDelai(): void {
    if (!this.dDate) return;
    this.api.creerEvenement({ dossier_id: this.id, type: this.dType, titre: this.dTitre, date_echeance: this.dDate }).subscribe({
      next: () => { this.dTitre = ''; this.dDate = ''; this.rafraichirDelais(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Ajout impossible'),
    });
  }

  private rafraichirComms(): void {
    this.api.dossierCommunications(this.id).subscribe({ next: (c) => this.communications.set(c), error: () => {} });
  }
  ajouterComm(): void {
    if (!this.cSujet) return;
    this.api.creerCommunication({ dossier_id: this.id, type: this.cType, sujet: this.cSujet, resume: this.cResume }).subscribe({
      next: () => { this.cSujet = ''; this.cResume = ''; this.rafraichirComms(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Enregistrement impossible'),
    });
  }

  iaResumer(): void {
    if (!this.iaTexte) return;
    this.iaEnCours.set(true); this.iaOut.set('');
    this.api.iaResume({ texte: this.iaTexte }).subscribe({
      next: (r) => { this.iaOut.set(r.resume); this.iaEnCours.set(false); },
      error: (e) => { this.iaEnCours.set(false); this.iaOut.set(e?.error?.error ?? 'Service IA indisponible.'); },
    });
  }

  iaChrono(): void {
    this.iaEnCours.set(true); this.iaOut.set('');
    const payload = this.iaTexte ? { texte: this.iaTexte } : { dossier_id: this.id };
    this.api.iaChronologie(payload).subscribe({
      next: (r) => { this.iaOut.set(r.chronologie); this.iaEnCours.set(false); },
      error: (e) => { this.iaEnCours.set(false); this.iaOut.set(e?.error?.error ?? 'Service IA indisponible.'); },
    });
  }

  private rafraichirTemps(): void {
    this.api.tempsDossier(this.id).subscribe({ next: (t) => this.temps.set(t), error: () => {} });
  }

  ajouterTemps(): void {
    if (!this.dureeMin) return;
    this.api.creerTemps({ dossier_id: this.id, duree_minutes: this.dureeMin, description: this.descTemps }).subscribe({
      next: () => { this.dureeMin = null; this.descTemps = ''; this.rafraichirTemps(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Saisie impossible'),
    });
  }

  private rafraichirDocuments(): void {
    this.api.dossierDocuments(this.id).subscribe({ next: (d) => this.documents.set(d), error: () => {} });
  }

  fichierChoisi(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.fichier.set(input.files && input.files.length ? input.files[0] : null);
  }

  televerser(): void {
    const f = this.fichier();
    if (!f) return;
    this.envoi.set(true);
    this.api.televerserDocument(this.id, f, { categorie: this.categorie }).subscribe({
      next: () => { this.envoi.set(false); this.fichier.set(null); this.rafraichirDocuments(); },
      error: (e) => { this.envoi.set(false); this.erreur.set(e?.error?.error ?? 'Téléversement impossible'); },
    });
  }

  ouvrir(doc: any): void {
    this.api.telechargerDocument(doc.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      error: () => this.erreur.set('Téléchargement impossible'),
    });
  }
}
