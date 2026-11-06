import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';

// Parcours « Acte reçu avec audience », lot 3 (06/11/2026) : corriger un acte déposé (client, nature, signification,
// date / heure / juridiction d'audience, avocat désigné), remplacer ou retirer la pièce déposée par erreur, ou annuler
// l'acte déposé à tort (il reste au registre, marqué annulé, avec son motif).
@Component({
  selector: 'app-acte-audience-corriger',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <header class="page-head">
      <div>
        <h1>Corriger un acte déposé</h1>
        <p><a class="lien" routerLink="/courrier">← Registre du courrier</a></p>
      </div>
    </header>
    @if (message()) { <p class="ok-msg">{{ message() }}</p> }
    @if (erreur()) { <p class="err">{{ erreur() }}</p> }

    @if (courrier(); as c) {
      <section class="panel">
        <b>{{ c.reference }}</b>
        @if (c.annule_le) { <span class="tag haute" style="margin-left:8px">Annulé</span> }
        @if (c.audience_programmee_le) { <span class="tag ok" style="margin-left:8px">Audience programmée</span> }
        <span class="muted-sm"> · pièce : {{ c.fichier_brut_nom || (c.document_id ? 'rangée dans le dossier' : 'aucune') }}</span>
      </section>

      @if (c.annule_le) {
        <section class="panel"><p class="muted">Cet acte est annulé{{ c.annule_motif ? ' : ' + c.annule_motif : '' }}. Il reste au registre pour la trace.</p></section>
      } @else {
        <section class="panel">
          <h3>Informations de l'acte</h3>
          <div class="grid2">
            <div><label>Client</label><input class="in" [(ngModel)]="f.correspondant" name="client" /></div>
            <div><label>Nature de l'acte</label><input class="in" [(ngModel)]="f.nature" name="nature" /></div>
            <div><label>Date de signification</label><input class="in" type="date" [(ngModel)]="f.date_signification" name="sign" /></div>
            <div>
              <label>Avocat désigné</label>
              <select class="in" [(ngModel)]="f.destinataire_id" name="avocat">
                @for (m of avocats(); track m.id) { <option [value]="m.id">{{ m.prenom }} {{ m.nom }}</option> }
              </select>
            </div>
            <div><label>Date d'audience</label><input class="in" type="date" [(ngModel)]="f.audience_indiquee" name="aud" [disabled]="!!c.audience_programmee_le" /></div>
            <div><label>Heure</label><input class="in" type="time" [(ngModel)]="f.audience_heure" name="heure" [disabled]="!!c.audience_programmee_le" /></div>
            <div class="col2"><label>Juridiction</label><input class="in" [(ngModel)]="f.audience_juridiction" name="jur" [disabled]="!!c.audience_programmee_le" /></div>
          </div>
          @if (c.audience_programmee_le) { <p class="muted-sm">L'audience est programmée : sa date, son heure et sa juridiction se modifient dans le Rôle d'audience.</p> }
          <p style="margin-top:10px"><button class="btn" (click)="enregistrer()" [disabled]="enCours()">Enregistrer les corrections</button></p>
        </section>

        <section class="panel">
          <h3>Pièce déposée</h3>
          @if (c.document_id) {
            <p class="muted-sm">La pièce est déjà rangée dans la GED du dossier : gérez-la depuis le dossier.</p>
          } @else {
            <p class="muted-sm">Fichier actuel : {{ c.fichier_brut_nom || 'aucun' }}</p>
            <input class="in" type="file" (change)="remplacer($event)" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
            @if (c.fichier_brut_nom) { <button class="btn ghost" (click)="retirer()" [disabled]="enCours()">Retirer la pièce</button> }
          }
        </section>

        @if (!c.audience_programmee_le && !c.dossier_id) {
          <section class="panel">
            <h3>Annuler cet acte</h3>
            <p class="muted-sm">À utiliser si l'acte a été déposé à tort. Il reste au registre, marqué « annulé » avec son motif, et sa tâche est close.</p>
            <label>Motif <span class="req">*</span></label>
            <input class="in" [(ngModel)]="motif" name="motif" placeholder="Ex. Déposé par erreur" />
            <button class="btn ghost danger" (click)="annuler()" [disabled]="enCours() || !motif.trim()">Annuler l'acte</button>
          </section>
        }
      }
    }
  `,
  styles: [`
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md)}
    label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:900px}
    .col2{grid-column:1 / -1}
    .btn{display:inline-block;background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn.ghost{background:transparent;border:1px solid var(--line);color:inherit}
    .btn.danger{border-color:#c0392b;color:#c0392b}
    .btn:disabled{opacity:.6;cursor:not-allowed}
    .ok-msg{color:var(--green);font-size:var(--fs-base)}
    .muted-sm{font-size:var(--fs-xs);color:var(--grey)}
    .req{color:#c0392b}
  `],
})
export class ActeAudienceCorrigerComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private static readonly ROLES_AVOCAT = ['associe', 'associe_fondateur', 'of_counsel', 'avocat_stagiaire', 'collaborateur'];
  readonly courrier = signal<any | null>(null);
  readonly membres = signal<any[]>([]);
  readonly message = signal('');
  readonly erreur = signal('');
  readonly enCours = signal(false);
  readonly avocats = computed(() => this.membres().filter((m) => ActeAudienceCorrigerComponent.ROLES_AVOCAT.includes(m.role)));
  f: any = {};
  motif = '';
  private id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id')!;
    this.api.utilisateurs().subscribe({ next: (u) => this.membres.set(u), error: () => {} });
    this.charger();
  }

  private charger(): void {
    this.api.courrier(this.id).subscribe({
      next: (c) => {
        const d = (v: any) => (v ? String(v).slice(0, 10) : '');
        this.f = { correspondant: c.correspondant ?? '', nature: c.type_precision ?? '', date_signification: d(c.date_signification),
          audience_indiquee: d(c.audience_indiquee), audience_heure: c.audience_heure ?? '', audience_juridiction: c.audience_juridiction ?? '',
          destinataire_id: c.destinataire_id ?? '' };
        this.courrier.set(c);   // en dernier : le signal déclenche l'affichage (pas de zone.js)
      },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Acte introuvable.'),
    });
  }

  private fin(texte: string): void { this.enCours.set(false); this.erreur.set(''); this.message.set(texte); this.charger(); }
  private echec(e: any, defaut: string): void { this.enCours.set(false); this.message.set(''); this.erreur.set(e?.error?.error ?? defaut); }

  enregistrer(): void {
    if (this.enCours()) return;
    this.enCours.set(true);
    const corps: any = { ...this.f };
    if (this.courrier()?.audience_programmee_le) { delete corps.audience_indiquee; delete corps.audience_heure; delete corps.audience_juridiction; }
    this.api.corrigerActe(this.id, corps).subscribe({ next: () => this.fin('Corrections enregistrées.'), error: (e) => this.echec(e, 'Correction impossible.') });
  }
  remplacer(e: Event): void {
    const fichier = (e.target as HTMLInputElement).files?.[0];
    if (!fichier || this.enCours()) return;
    this.enCours.set(true);
    this.api.remplacerFichierActe(this.id, fichier).subscribe({ next: () => this.fin('Pièce remplacée.'), error: (er) => this.echec(er, 'Remplacement impossible.') });
  }
  retirer(): void {
    if (this.enCours()) return;
    this.enCours.set(true);
    this.api.retirerFichierActe(this.id).subscribe({ next: () => this.fin('Pièce retirée.'), error: (e) => this.echec(e, 'Retrait impossible.') });
  }
  annuler(): void {
    if (this.enCours() || !this.motif.trim()) return;
    this.enCours.set(true);
    this.api.annulerActe(this.id, this.motif.trim()).subscribe({ next: () => this.fin('Acte annulé.'), error: (e) => this.echec(e, 'Annulation impossible.') });
  }
}
