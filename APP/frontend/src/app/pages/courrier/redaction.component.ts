import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DocumentPreviewService } from '../../core/document-preview.service';
import { DossierPickerComponent } from '../../core/dossier-picker.component';

// Rédiger un courrier départ (lot 4, 05/11/2026) : formulaire à cases fixes selon le gabarit, sortie A (papier à
// en-tête) ou B (en-tête numérique), aperçu PDF, téléchargements Word et PDF, versions conservées, états.
// Le N/R est la référence JURIA, attribuée à l'enregistrement (jamais saisie). La signature (cachet + signature
// scannée) est le lot 5 : ici, la lettre est préparée puis soumise au signataire.
@Component({
  selector: 'app-redaction-courrier',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, RouterLink, DossierPickerComponent],
  template: `
    <header class="page-head">
      <div>
        <h1>{{ courrier() ? 'Courrier ' + courrier().reference : 'Rédiger un courrier' }}</h1>
        <p><a class="lien" routerLink="/courrier">← Registre du courrier</a></p>
      </div>
    </header>

    @if (message()) { <p class="ok-msg">{{ message() }}</p> }
    @if (erreur()) { <p class="err">{{ erreur() }}</p> }

    @if (courrier(); as c) {
      <section class="panel etat">
        <span class="tag" [class.ok]="c.etat_redaction === 'signee'" [class.attente]="c.etat_redaction === 'a_signer'">{{ libelleEtat(c.etat_redaction) }}</span>
        @if (c.annule_le) { <span class="tag haute">Numéro annulé</span> }
        <span class="muted-sm">Signataire : <b>{{ c.signataire_nom || '—' }}</b> · {{ c.versions.length }} version(s)</span>
        @if (lecture()) {
          <p class="muted" style="margin:8px 0 0">
            @if (c.annule_le) { Ce courrier est annulé : aucune modification possible. }
            @else if (c.etat_redaction === 'a_signer') { La lettre est à signer : pour la modifier, renvoyez-la d'abord en brouillon. }
            @else { Lettre signée : aucune modification possible. }
          </p>
        }
      </section>
    }

    <section class="panel">
      <h3>Paramètres</h3>
      <div class="grid2">
        <div>
          <label>Gabarit</label>
          <select class="in" [ngModel]="gabaritCode()" (ngModelChange)="choisirGabarit($event)" name="rdGabarit" [disabled]="!!courrier()">
            @for (g of gabarits(); track g.code) { <option [value]="g.code">{{ g.nom }}</option> }
          </select>
        </div>
        <div>
          <label>Signataire</label>
          <select class="in" [(ngModel)]="signataireId" name="rdSignataire" [disabled]="lecture()">
            @for (s of signataires(); track s.id) { <option [value]="s.id">{{ s.nom }}</option> }
          </select>
        </div>
        <div class="col2">
          <label>Dossier concerné (facultatif — un courrier général du cabinet n'a pas de dossier)</label>
          @if (courrier()) {
            <p class="muted" style="margin:6px 0 12px">{{ courrier().dossier_id ? 'Rattaché à un dossier (modifiable depuis le registre).' : 'Courrier général, sans dossier.' }}</p>
          } @else {
            <app-dossier-picker [valeur]="dossierId" (valeurChange)="dossierId = $event"></app-dossier-picker>
          }
        </div>
        <div>
          <label>Sortie</label>
          <select class="in" [(ngModel)]="sortie" name="rdSortie" [disabled]="lecture()">
            <option value="A">A · Papier à en-tête (texte seul)</option>
            <option value="B">B · En-tête numérique</option>
          </select>
        </div>
        <div>
          <label>Bloc de signature</label>
          <select class="in" [(ngModel)]="bloc" name="rdBloc" [disabled]="lecture()">
            <option value="psc">P/SCPA JFC AVOCATS-MALI + nom et mention</option>
            <option value="con">Le Conseil, SCPA JFC AVOCATS - MALI, Me …</option>
          </select>
        </div>
        @if (sortie === 'B') {
          <div>
            <label>Logo</label>
            <select class="in" [(ngModel)]="logo" name="rdLogo" [disabled]="lecture()">
              <option value="mali">JFC AVOCATS MALI</option>
              <option value="std">JFC AVOCATS</option>
            </select>
          </div>
          <div>
            <label>Décor pâle (en bas à droite)</label>
            <select class="in" [ngModel]="decor ? 'oui' : 'non'" (ngModelChange)="decor = $event === 'oui'" name="rdDecor" [disabled]="lecture()">
              <option value="oui">Oui</option>
              <option value="non">Non</option>
            </select>
          </div>
        }
      </div>
    </section>

    @if (gabarit(); as g) {
      <section class="panel">
        <h3>Contenu</h3>
        <p class="muted">Le N/R est la référence JURIA, attribuée à l'enregistrement. Chaque enregistrement crée une nouvelle version : les précédentes restent téléchargeables.</p>
        <div class="grid2">
          @for (c of g.champs; track c.cle) {
            <div class="col2">
              <label>{{ c.libelle }}@if (c.obligatoire) { <span class="req"> *</span> }</label>
              @switch (c.type) {
                @case ('paragraphes') {
                  <textarea class="in" rows="11" [ngModel]="valeurs[c.cle]" (ngModelChange)="valeurs[c.cle] = $event" [name]="'rd_' + c.cle" [disabled]="lecture()"></textarea>
                }
                @case ('lignes') {
                  <textarea class="in" rows="4" [ngModel]="valeurs[c.cle]" (ngModelChange)="valeurs[c.cle] = $event" [name]="'rd_' + c.cle" [disabled]="lecture()"></textarea>
                }
                @default {
                  <input class="in" [ngModel]="valeurs[c.cle]" (ngModelChange)="valeurs[c.cle] = $event" [name]="'rd_' + c.cle" [disabled]="lecture()" [placeholder]="c.cle === 'date' ? 'Vide : date du jour' : ''" />
                }
              }
              @if (c.aide) { <p class="muted-sm" style="margin:-8px 0 6px">{{ c.aide }}</p> }
              @if (erreursChamps()[c.cle]; as e) { <p class="err" style="margin:-4px 0 8px">{{ e }}</p> }
            </div>
          }
        </div>

        @if (!lecture()) {
          <p style="margin-top:8px">
            <button class="btn" (click)="enregistrer()" [disabled]="enCours()">
              {{ enCours() ? 'Enregistrement…' : (courrier() ? 'Enregistrer une nouvelle version' : 'Enregistrer le brouillon (attribue la référence)') }}
            </button>
          </p>
        }
      </section>
    }

    @if (courrier(); as c) {
      <section class="panel">
        <h3>Versions</h3>
        <table>
          <tr><th>Version</th><th>Date</th><th>Auteur</th><th>Sortie</th><th>Pages</th><th>Fichiers</th></tr>
          @for (v of versionsInverses(); track v.numero) {
            <tr>
              <td>v{{ v.numero }}@if (v.numero === c.versions.length) { <span class="tag ok" style="margin-left:6px">dernière</span> }</td>
              <td>{{ v.cree_le | date:'dd/MM/yyyy HH:mm' }}</td>
              <td>{{ v.cree_par_nom || '—' }}</td>
              <td>{{ v.sortie === 'B' ? 'En-tête numérique' : 'Papier à en-tête' }}</td>
              <td>{{ v.pages }}</td>
              <td>
                <button class="lien" (click)="apercu(v.numero)">Aperçu PDF</button> ·
                <button class="lien" (click)="telecharger(v.numero, 'pdf')">PDF</button> ·
                <button class="lien" (click)="telecharger(v.numero, 'docx')">Word</button>
              </td>
            </tr>
          }
        </table>
      </section>

      @if (c.etat_redaction === 'a_signer' && !c.annule_le && appo(); as ap) {
        @if (ap.peut_signer) {
          <section class="panel">
            <h3>Signature</h3>
            @if (ap.mode === 'image') {
              <p class="muted">Le cachet du cabinet et votre signature scannée seront apposés sur la lettre, qui sera figée en PDF. Réglez la taille et la position, vérifiez l'aperçu, puis signez.</p>
              @if (!ap.cachet_present) { <p class="err">Le cachet du cabinet n'est pas déposé : demandez à l'administration de le déposer (Accès &amp; permissions › Courriers).</p> }
              @if (!ap.signature_presente) { <p class="err">Votre signature n'est pas déposée : demandez à l'administration de la déposer (Accès &amp; permissions › Courriers).</p> }
              <div class="grid2">
                <div><label>Taille de l'ensemble cachet + signature : {{ reglage.ens * 100 | number:'1.0-0' }} %</label>
                  <input type="range" min="0.7" max="1.3" step="0.05" [(ngModel)]="reglage.ens" name="sgEns" /></div>
                <div><label>Taille de la signature seule : {{ reglage.ts * 100 | number:'1.0-0' }} %</label>
                  <input type="range" min="0.6" max="1.4" step="0.05" [(ngModel)]="reglage.ts" name="sgTs" /></div>
                <div><label>Décalage horizontal de la signature : {{ reglage.ox }}</label>
                  <input type="range" min="-40" max="40" step="1" [(ngModel)]="reglage.ox" name="sgOx" /></div>
                <div><label>Décalage vertical de la signature : {{ reglage.oy }}</label>
                  <input type="range" min="-40" max="40" step="1" [(ngModel)]="reglage.oy" name="sgOy" /></div>
              </div>
              <p><button class="btn" (click)="apercuSignature()" [disabled]="enCours() || !ap.cachet_present || !ap.signature_presente">Aperçu avec cachet et signature</button></p>
            } @else {
              <p class="muted">Sortie A : imprimez la lettre sur le papier à en-tête, signez-la à la main (cachet compris), puis joignez la copie signée depuis le registre. Ici, vous enregistrez seulement que la lettre est signée.</p>
            }
            <p><label class="chk"><input type="checkbox" [(ngModel)]="confirmation" name="sgConf" />
              {{ ap.mode === 'image' ? 'Je confirme apposer mon cachet et ma signature sur cette lettre.' : 'Je confirme avoir signé cette lettre à la main.' }}</label></p>
            <button class="btn" (click)="signer()" [disabled]="!confirmation || enCours() || (ap.mode === 'image' && (!ap.cachet_present || !ap.signature_presente))">
              {{ ap.mode === 'image' ? 'Signer' : 'Marquer comme signée' }}
            </button>
          </section>
        }
      }
      @if (c.etat_redaction === 'signee') {
        <section class="panel">
          <h3>Lettre signée</h3>
          <p>Signée le {{ c.signee_le | date:'dd/MM/yyyy HH:mm' }}@if (c.apposition?.mode === 'manuscrite') { <span class="muted"> — signature manuscrite (la copie signée se joint depuis le registre)</span> }.</p>
          @if (c.pdf_signe) {
            <button class="lien" (click)="pdfSigne(true)">Aperçu du PDF signé</button> ·
            <button class="lien" (click)="pdfSigne(false)">Télécharger</button>
            @if (c.apposition?.empreinte) { <p class="muted-sm">Empreinte (SHA-256) : {{ c.apposition.empreinte }}</p> }
          }
        </section>
      }

      @if (c.etat_redaction !== 'signee') {
      <section class="panel">
        <h3>Suite</h3>
        @if (c.etat_redaction === 'brouillon' && !c.annule_le) {
          <button class="btn" (click)="soumettre()" [disabled]="enCours()">Soumettre à signature</button>
          <p class="muted-sm">Le signataire désigné sera chargé de signer (cachet et signature : étape suivante du chantier). Une lettre soumise ne se modifie plus sans retour en brouillon.</p>
          <p style="margin-top:12px"><label>Annuler ce brouillon (la référence reste au registre, marquée « annulée »)</label>
            <input class="in" [(ngModel)]="motifAnnulation" name="rdMotif" placeholder="Motif (obligatoire)" />
            <button class="lien" (click)="annuler()" [disabled]="!motifAnnulation.trim() || enCours()">Annuler le brouillon</button></p>
        }
        @if (c.etat_redaction === 'a_signer' && !c.annule_le) {
          <button class="btn" (click)="retourBrouillon()" [disabled]="enCours()">Renvoyer en brouillon</button>
          <p class="muted-sm">À utiliser pour corriger la lettre avant signature.</p>
        }
      </section>
      }
    }
  `,
  styles: [`
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md)}
    textarea.in{resize:vertical;font-family:inherit}
    label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:900px}
    .col2{grid-column:1 / -1}
    .btn{display:inline-block;background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer;text-decoration:none}
    .btn:disabled{opacity:.6}
    .ok-msg{color:var(--green);font-size:var(--fs-base);margin-top:10px}
    .muted-sm{font-size:var(--fs-xs);color:var(--grey)}
    input[type=range]{width:100%}
    .req{color:#c0392b}
    .etat{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  `],

})
export class RedactionCourrierComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly preview = inject(DocumentPreviewService);

  readonly gabarits = signal<any[]>([]);
  readonly signataires = signal<any[]>([]);
  readonly courrier = signal<any | null>(null);
  readonly gabaritCode = signal('');
  readonly gabarit = computed(() => this.gabarits().find((g) => g.code === this.gabaritCode()) ?? null);
  readonly erreursChamps = signal<Record<string, string>>({});
  readonly message = signal('');
  readonly erreur = signal('');
  readonly enCours = signal(false);
  readonly lecture = computed(() => {
    const c = this.courrier();
    return !!c && (c.etat_redaction !== 'brouillon' || !!c.annule_le);
  });
  readonly appo = signal<any | null>(null);
  readonly versionsInverses = computed(() => [...(this.courrier()?.versions ?? [])].reverse());

  valeurs: Record<string, any> = {};
  signataireId = '';
  dossierId: string | null = null;
  sortie = 'A';
  bloc = 'psc';
  logo = 'mali';
  decor = true;
  motifAnnulation = '';
  reglage = { ens: 1, ts: 1, ox: 0, oy: 0 };
  confirmation = false;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.api.gabaritsCourrier().subscribe({
      next: (g) => {
        this.gabarits.set(g);
        this.api.courrierReglages().subscribe({
          next: (r) => {
            this.signataires.set((r.signataires ?? []).filter((s: any) => ['associe', 'associe_fondateur'].includes(s.role) || s.signature?.presente));
            this.logo = r.logo_defaut ?? 'mali';
            this.decor = r.decor ?? true;
            if (id) this.charger(id); else this.nouveau(g);
          },
          error: () => { if (id) this.charger(id); else this.nouveau(g); },
        });
      },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Gabarits indisponibles.'),
    });
  }

  private nouveau(g: any[]): void {
    if (g.length) this.choisirGabarit(g[0].code);
    const moi = this.auth.utilisateur()?.id;
    const liste = this.signataires();
    this.signataireId = liste.find((s) => s.id === moi)?.id ?? liste[0]?.id ?? '';
  }

  private charger(id: string): void {
    this.api.redactionCourrier(id).subscribe({
      next: (c) => {
        this.courrier.set(c);
        this.gabaritCode.set(c.gabarit_code);
        this.valeurs = this.versTexte(c.gabarit_code, c.contenu);
        this.signataireId = c.signataire_id ?? '';
        const o = c.options_redaction ?? {};
        this.sortie = o.sortie ?? 'A';
        this.bloc = o.bloc_signature ?? this.gabarits().find((x) => x.code === c.gabarit_code)?.bloc_signature ?? 'psc';
        if (o.logo) this.logo = o.logo;
        if (o.decor !== undefined) this.decor = !!o.decor;
        this.chargerApposition(c);
      },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Courrier introuvable.'),
    });
  }

  // Les listes (lignes, paragraphes) se saisissent dans un champ texte : lignes séparées par un retour, paragraphes par une ligne vide.
  private versTexte(code: string, contenu: Record<string, any>): Record<string, any> {
    const g = this.gabarits().find((x) => x.code === code);
    const out: Record<string, any> = {};
    (g?.champs ?? []).forEach((c: any) => {
      const v = contenu?.[c.cle];
      out[c.cle] = Array.isArray(v) ? v.join(c.type === 'paragraphes' ? '\n\n' : '\n') : (v ?? '');
    });
    return out;
  }

  choisirGabarit(code: string): void {
    this.gabaritCode.set(code);
    const g = this.gabarits().find((x) => x.code === code);
    const v: Record<string, any> = {};
    (g?.champs ?? []).forEach((c: any) => {
      const d = c.defaut;
      v[c.cle] = Array.isArray(d) ? d.join(c.type === 'paragraphes' ? '\n\n' : '\n') : (d ?? '');
    });
    this.valeurs = v;
    this.bloc = g?.bloc_signature ?? 'psc';
    this.erreursChamps.set({});
  }

  libelleEtat(e: string): string {
    return ({ brouillon: 'Brouillon', a_signer: 'À signer', signee: 'Signée' } as Record<string, string>)[e] ?? e;
  }

  private erreurServeur(e: any): void {
    const parChamp: Record<string, string> = {};
    (e?.error?.erreurs ?? []).forEach((x: any) => { parChamp[x.cle] = x.message; });
    this.erreursChamps.set(parChamp);
    this.erreur.set(Object.keys(parChamp).length ? 'Corrigez les champs signalés.' : (e?.error?.error ?? 'Opération impossible.'));
    this.enCours.set(false);
  }

  enregistrer(): void {
    this.erreur.set(''); this.message.set(''); this.erreursChamps.set({}); this.enCours.set(true);
    const options = { sortie: this.sortie, bloc_signature: this.bloc, logo: this.logo, decor: this.decor };
    const c = this.courrier();
    if (c) {
      this.api.majContenuCourrier(c.id, { valeurs: this.valeurs, signataire_id: this.signataireId, ...options }).subscribe({
        next: (r) => { this.enCours.set(false); this.message.set('Version ' + r.version.numero + ' enregistrée.'); this.charger(c.id); },
        error: (e) => this.erreurServeur(e),
      });
    } else {
      this.api.redigerCourrier({ gabarit: this.gabaritCode(), valeurs: this.valeurs, signataire_id: this.signataireId, dossier_id: this.dossierId, ...options }).subscribe({
        next: (r) => { this.enCours.set(false); this.router.navigate(['/courrier/rediger', r.courrier.id], { replaceUrl: true }); },
        error: (e) => this.erreurServeur(e),
      });
    }
  }

  apercu(numero: number): void {
    const c = this.courrier();
    if (c) this.preview.ouvrir(c.reference + '-v' + numero + '.pdf', this.api.versionCourrier(c.id, numero, 'pdf'));
  }

  telecharger(numero: number, format: 'pdf' | 'docx'): void {
    const c = this.courrier();
    if (!c) return;
    this.api.versionCourrier(c.id, numero, format).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = c.reference + '-v' + numero + '.' + format; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      error: () => this.erreur.set('Téléchargement impossible.'),
    });
  }

  // Signature (lot 5) : mode, réglages mémorisés du signataire, présence du cachet et de la signature.
  private chargerApposition(c: any): void {
    this.appo.set(null);
    if (c.etat_redaction !== 'a_signer' || !this.auth.peut('courriers.signer')) return;
    this.api.infoAppositionCourrier(c.id).subscribe({
      next: (i) => { this.appo.set(i); this.reglage = { ...this.reglage, ...(i.defauts ?? {}) }; this.confirmation = false; },
      error: () => this.appo.set(null),
    });
  }

  apercuSignature(): void {
    const c = this.courrier(); if (!c) return;
    this.preview.ouvrir('Aperçu de signature ' + c.reference + '.pdf', this.api.apercuAppositionCourrier(c.id, { ...this.reglage }));
  }

  signer(): void {
    const c = this.courrier(); if (!c) return;
    this.erreur.set(''); this.enCours.set(true);
    this.api.signerCourrier(c.id, { confirmer: this.confirmation, ...this.reglage }).subscribe({
      next: () => { this.enCours.set(false); this.message.set('Lettre signée.'); this.charger(c.id); },
      error: (e) => this.erreurServeur(e),
    });
  }

  pdfSigne(apercu: boolean): void {
    const c = this.courrier(); if (!c) return;
    const nom = c.reference + '-signe.pdf';
    if (apercu) { this.preview.ouvrir(nom, this.api.pdfSigneCourrier(c.id)); return; }
    this.api.pdfSigneCourrier(c.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = nom; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      error: () => this.erreur.set('Téléchargement impossible.'),
    });
  }

  soumettre(): void {
    const c = this.courrier(); if (!c) return;
    this.enCours.set(true);
    this.api.soumettreSignatureCourrier(c.id).subscribe({
      next: () => { this.enCours.set(false); this.message.set('Lettre soumise à signature.'); this.charger(c.id); },
      error: (e) => this.erreurServeur(e),
    });
  }

  retourBrouillon(): void {
    const c = this.courrier(); if (!c) return;
    this.enCours.set(true);
    this.api.retourBrouillonCourrier(c.id).subscribe({
      next: () => { this.enCours.set(false); this.message.set('Lettre renvoyée en brouillon.'); this.charger(c.id); },
      error: (e) => this.erreurServeur(e),
    });
  }

  annuler(): void {
    const c = this.courrier(); if (!c) return;
    this.enCours.set(true);
    this.api.annulerNumeroCourrier(c.id, this.motifAnnulation.trim()).subscribe({
      next: () => { this.enCours.set(false); this.message.set('Brouillon annulé.'); this.motifAnnulation = ''; this.charger(c.id); },
      error: (e) => this.erreurServeur(e),
    });
  }
}
