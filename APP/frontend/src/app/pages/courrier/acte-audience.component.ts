import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ApiService } from '../../core/api.service';

// Parcours « Acte reçu avec audience », étape 1 (06/11/2026) : l'acte transmis par le client (souvent par e-mail) est
// déposé ici avec le client, la nature de l'acte, la date de signification, la date d'audience lue sur l'acte et l'avocat
// qui le traite. Rien d'autre n'est créé à cette étape : l'avocat désigné reçoit une tâche, et les associés voient
// la tuile du Tableau de bord si l'audience est à moins de 7 jours. Ouvrir le dossier et programmer l'audience
// viennent aux lots suivants.
@Component({
  selector: 'app-acte-audience',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <header class="page-head">
      <div>
        <h1>Acte reçu avec audience</h1>
        <p><a class="lien" routerLink="/courrier">← Registre du courrier</a></p>
      </div>
    </header>

    @if (resultat(); as r) {
      <section class="panel">
        <h3>Acte déposé</h3>
        <p class="ok-msg">Courrier <b>{{ r.reference }}</b> enregistré. L'avocat désigné a reçu une tâche pour traiter l'acte.</p>
        @if (r.urgent) {
          <p class="alerte">Audience dans {{ r.jours_restants < 0 ? 'une date déjà passée' : r.jours_restants + ' jour(s)' }} : l'acte apparaît en rouge sur le Tableau de bord des associés et de l'avocat désigné.</p>
        }
        <p class="muted-sm">Prévenez l'avocat désigné pour qu'il traite l'acte sans attendre. L'ouverture du dossier et la programmation de l'audience au rôle se font ensuite.</p>
        <p style="margin-top:14px">
          @if (auth.peut('courriers.acte_audience.programmer')) {
            <a class="btn" style="margin-right:14px" [routerLink]="['/courrier/acte-audience', r.id]">Programmer l'audience maintenant</a>
          }
          <button class="btn" (click)="recommencer()">Déposer un autre acte</button>
          <a class="lien" style="margin-left:14px" routerLink="/courrier">Retour au registre</a>
        </p>
      </section>
    } @else {
      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
      <section class="panel">
        <h3>1 · L'acte reçu</h3>
        <p class="muted-sm">Le client vous a transmis l'acte par e-mail : joignez le fichier ci-dessous.</p>
        <div class="grid2">
          <div class="col2">
            <label>Fichier de l'acte <span class="req">*</span></label>
            <input class="in" type="file" (change)="choisirFichier($event)" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
            @if (fichier()) { <p class="muted-sm" style="margin:-6px 0 10px">{{ fichier()!.name }} — {{ taille() }}</p> }
          </div>
          <div>
            <label>Client qui a transmis l'acte <span class="req">*</span></label>
            <input class="in" [(ngModel)]="form.correspondant" name="client" list="clientsBanques" placeholder="Ex. BDM SA" (change)="chargerHabitudes()" />
            @if (habitudes()) { <span class="muted-sm">{{ habitudes() }}</span> }
            <datalist id="clientsBanques">
              @for (c of clientsConnus(); track c) { <option [value]="c"></option> }
            </datalist>
          </div>
          <div>
            <label>Nature de l'acte</label>
            <select class="in" [(ngModel)]="form.nature" name="nature">
              @for (n of natures; track n) { <option [value]="n">{{ n }}</option> }
            </select>
          </div>
          <div>
            <label>Date de signification au client</label>
            <input class="in" type="date" [(ngModel)]="form.date_signification" name="signification" />
            <span class="muted-sm">Elle compte pour les délais : prenez celle écrite sur l'acte.</span>
          </div>
          <div>
            <label>Date de réception du mail</label>
            <input class="in" type="date" [(ngModel)]="form.date_courrier" name="reception" />
          </div>
          <div>
            <label>Date d'audience indiquée sur l'acte</label>
            <input class="in" type="date" [(ngModel)]="form.audience_indiquee" name="audience" />
            <span class="muted-sm">Si elle est à 7 jours ou moins, l'acte est signalé en rouge.</span>
          </div>
          <div>
            <label>Heure de l'audience (si indiquée)</label>
            <input class="in" type="time" [(ngModel)]="form.audience_heure" name="heure" />
          </div>
          <div>
            <label>Juridiction (si indiquée)</label>
            <input class="in" [(ngModel)]="form.audience_juridiction" name="juridiction" placeholder="Ex. Tribunal de commerce de Bamako" />
          </div>
          <div class="col2">
            <label>Avocat qui traite l'acte <span class="req">*</span></label>
            <select class="in" [(ngModel)]="form.destinataire_id" name="destinataire">
              <option value="">—</option>
              @for (m of avocats(); track m.id) { <option [value]="m.id">{{ m.prenom }} {{ m.nom }}</option> }
            </select>
          </div>
        </div>
        @if (alerteDelai()) { <p class="alerte">{{ alerteDelai() }}</p> }
        @if (doublons().length) {
          <div class="alerte">
            <b>Un acte semblable est déjà enregistré pour ce client :</b>
            <ul>
              @for (d of doublons(); track d.id) { <li>{{ d.reference }} — {{ d.nature || 'Acte' }}{{ d.audience_indiquee ? ', audience le ' + d.audience_indiquee.slice(0, 10) : '' }}</li> }
            </ul>
            <button class="btn ghost" (click)="deposer(true)" [disabled]="enCours()">C'est un autre acte : déposer quand même</button>
          </div>
        }
        <p class="muted-sm">À cette étape, rien d'autre n'est créé : ni dossier, ni audience au rôle. L'avocat désigné reçoit une tâche, et les associés voient la tuile du Tableau de bord si l'audience est proche.</p>
        <p style="margin-top:14px"><button class="btn" (click)="deposer()" [disabled]="enCours() || !pret()">Déposer l'acte</button></p>
      </section>
    }
  `,
  styles: [`
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md)}
    label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:900px}
    .col2{grid-column:1 / -1}
    .btn{display:inline-block;background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer;text-decoration:none}
    .btn:disabled{opacity:.6;cursor:not-allowed}
    .ok-msg{color:var(--green);font-size:var(--fs-base)}
    .muted-sm{font-size:var(--fs-xs);color:var(--grey)}
    .req{color:#c0392b}
    .alerte{background:#fdecea;border:1px solid #c0392b;color:#8a1f15;border-radius:8px;padding:9px 12px;font-size:var(--fs-sm);max-width:900px}
  `],
})
export class ActeAudienceComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private static readonly ROLES_AVOCAT = ['associe', 'associe_fondateur', 'of_counsel', 'avocat_stagiaire', 'collaborateur'];

  readonly natures = ['Assignation', 'Requête', 'Sommation', 'Commandement', 'Signification de jugement', 'Autre acte'];
  readonly membres = signal<any[]>([]);
  readonly fichier = signal<File | null>(null);
  readonly enCours = signal(false);
  readonly erreur = signal('');
  readonly resultat = signal<any | null>(null);
  readonly doublons = signal<any[]>([]);
  readonly habitudes = signal('');
  // Les champs saisis au clavier alimentent des signaux dérivés (pas de zone.js) : form reste un simple objet de saisie.
  form: any = this.vierge();

  readonly avocats = computed(() => this.membres().filter((m) => ActeAudienceComponent.ROLES_AVOCAT.includes(m.role)));
  readonly clientsConnus = signal<string[]>(['BDM SA', 'ORABANK Mali']);
  readonly taille = computed(() => {
    const f = this.fichier();
    return f ? (f.size > 1048576 ? (f.size / 1048576).toFixed(1) + ' Mo' : Math.ceil(f.size / 1024) + ' Ko') : '';
  });

  ngOnInit(): void {
    this.api.utilisateurs().subscribe({ next: (u) => this.membres.set(u), error: () => {} });
    this.api.habitudesActe().subscribe({ next: (h) => { if (h.clients?.length) this.clientsConnus.set([...new Set([...h.clients, 'BDM SA', 'ORABANK Mali'])]); }, error: () => {} });
  }

  // Mémorisation par client (sans IA) : propose la juridiction, l'avocat et la nature les plus fréquents, sans écraser une saisie.
  chargerHabitudes(): void {
    const client = String(this.form.correspondant || '').trim();
    if (!client) { this.habitudes.set(''); return; }
    this.api.habitudesActe(client).subscribe({
      next: (h) => {
        const infos: string[] = [];
        if (h.juridiction && !this.form.audience_juridiction) { this.form.audience_juridiction = h.juridiction; infos.push('juridiction ' + h.juridiction); }
        if (h.destinataire_id && !this.form.destinataire_id) { this.form.destinataire_id = h.destinataire_id; infos.push('avocat habituel'); }
        if (h.nature && this.form.nature === 'Assignation' && this.natures.includes(h.nature)) this.form.nature = h.nature;
        this.habitudes.set(infos.length ? 'Habitudes de ce client reprises : ' + infos.join(', ') + '.' : '');
      },
      error: () => {},
    });
  }

  private vierge(): any {
    const auj = new Date().toISOString().slice(0, 10);
    return { correspondant: '', nature: 'Assignation', date_signification: '', date_courrier: auj, audience_indiquee: '', audience_heure: '', audience_juridiction: '', destinataire_id: '' };
  }

  pret(): boolean {
    return !!this.fichier() && !!String(this.form.correspondant).trim() && !!this.form.destinataire_id;
  }

  alerteDelai(): string {
    const d = this.form.audience_indiquee;
    if (!d) return '';
    const jours = Math.round((new Date(d + 'T00:00:00').getTime() - new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00').getTime()) / 86400000);
    if (jours < 0) return 'La date d\'audience indiquée est passée : vérifiez-la.';
    if (jours <= 7) return 'Audience dans ' + jours + ' jour(s) : l\'acte sera marqué urgent.';
    return '';
  }

  choisirFichier(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0] ?? null;
    this.fichier.set(f);
  }

  deposer(confirmer = false): void {
    const f = this.fichier();
    if (!f || this.enCours() || !this.pret()) return;
    this.erreur.set('');
    if (!confirmer) this.doublons.set([]);
    this.enCours.set(true);
    const fd = new FormData();
    fd.append('fichier', f);
    for (const k of ['correspondant', 'nature', 'date_signification', 'date_courrier', 'audience_indiquee', 'audience_heure', 'audience_juridiction', 'destinataire_id']) {
      if (this.form[k]) fd.append(k, this.form[k]);
    }
    if (confirmer) fd.append('confirmer_doublon', 'true');
    this.api.deposerActeAudience(fd).subscribe({
      next: (r) => { this.enCours.set(false); this.doublons.set([]); this.resultat.set(r); },
      error: (e) => {
        this.enCours.set(false);
        if (e?.status === 409 && e?.error?.doublons) { this.doublons.set(e.error.doublons); return; }
        this.erreur.set(e?.error?.error ?? 'Dépôt impossible.');
      },
    });
  }

  recommencer(): void {
    this.form = this.vierge();
    this.fichier.set(null);
    this.resultat.set(null);
    this.doublons.set([]);
    this.habitudes.set('');
    this.erreur.set('');
  }
}
