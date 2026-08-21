import { Component, DestroyRef, effect, inject, signal, computed } from '@angular/core';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { DocumentPreviewService } from './document-preview.service';

// Aperçu de fichier sans ouverture classique (21/08/2026, demande
// utilisateur) — « en plus de l'ouverture classique d'un fichier Word/Excel/
// PDF, permettre sa visualisation en aperçu sans l'ouvrir ». Rendu une seule
// fois dans app.component.ts (persiste à travers la navigation, même
// patron que <app-messagerie-widget>), piloté par DocumentPreviewService
// depuis n'importe quel écran qui télécharge déjà un fichier authentifié.
//
// Détection du format : d'abord le type MIME réel du Blob téléchargé (fixé
// par le serveur via Content-Type — fiable pour documents.js/biblio.js, qui
// le stockent depuis l'upload), puis à défaut l'extension du nom de fichier
// fourni par l'appelant. PDF/images : rendu natif du navigateur (iframe/img
// sur une URL d'objet). Word (.docx) : converti en HTML via `mammoth`.
// Excel/CSV/ODS (.xlsx/.xls/.csv/.ods) : parsé via `xlsx` (SheetJS),
// rendu en tableau, avec onglets si plusieurs feuilles. Les deux
// bibliothèques tournent entièrement côté client (le fichier ne quitte
// jamais le navigateur une fois téléchargé) — pas de service de conversion
// externe, pas d'URL signée publique, cohérent avec le bucket GED privé.
// Le format binaire ancien .doc (pré-OOXML) n'est pas supporté par
// `mammoth` (docx uniquement) — repli explicite sur le message "aperçu non
// disponible", pas une tentative silencieuse.
type TypeApercu = 'pdf' | 'image' | 'docx' | 'feuille' | 'texte' | 'non_supporte';

@Component({
  selector: 'app-document-preview',
  standalone: true,
  imports: [],
  template: `
    @if (svc.visible()) {
      <div class="dp-fond" (click)="svc.fermer()">
        <div class="dp-panneau" (click)="$event.stopPropagation()">
          <div class="dp-entete">
            <span class="dp-nom">{{ svc.nom() }}</span>
            <button type="button" class="dp-fermer" (click)="svc.fermer()" title="Fermer">✕</button>
          </div>
          <div class="dp-corps">
            @if (svc.chargement()) {
              <p class="dp-msg">Chargement…</p>
            } @else if (svc.erreur() || erreurApercu()) {
              <p class="dp-msg dp-err">{{ svc.erreur() || erreurApercu() }}</p>
            } @else {
              @switch (type()) {
                @case ('pdf') { <iframe [src]="urlSure()" class="dp-pdf" title="Aperçu PDF"></iframe> }
                @case ('image') { <img [src]="urlSure()" class="dp-image" alt="Aperçu" /> }
                @case ('docx') { <div class="dp-docx" [innerHTML]="htmlSur()"></div> }
                @case ('feuille') {
                  @if (feuilles().length > 1) {
                    <div class="dp-onglets">
                      @for (f of feuilles(); track f; let i = $index) {
                        <button type="button" class="dp-onglet" [class.actif]="i === feuilleActive()" (click)="feuilleActive.set(i)">{{ f }}</button>
                      }
                    </div>
                  }
                  <div class="dp-feuille" [innerHTML]="htmlSur()"></div>
                }
                @case ('texte') { <pre class="dp-texte">{{ texteBrut() }}</pre> }
                @default { <p class="dp-msg">Aperçu non disponible pour ce type de fichier — utilisez « Ouvrir » / « Télécharger ».</p> }
              }
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .dp-fond{position:fixed;inset:0;background:rgba(15,20,30,.55);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px}
    .dp-panneau{background:#fff;border-radius:12px;max-width:min(920px,100%);width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.35)}
    .dp-entete{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line)}
    .dp-nom{font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dp-fermer{background:none;border:none;font-size:16px;cursor:pointer;color:var(--slate);padding:4px 8px}
    .dp-corps{overflow:auto;flex:1;padding:16px}
    .dp-msg{color:var(--grey);font-size:13px;text-align:center;padding:40px 0}
    .dp-err{color:var(--red)}
    .dp-pdf{width:100%;height:75vh;border:none}
    .dp-image{max-width:100%;display:block;margin:0 auto}
    .dp-docx{font-size:14px;line-height:1.5;max-width:760px;margin:0 auto}
    /* ::ng-deep : le HTML de dp-docx/dp-feuille est injecté via [innerHTML]
       (mammoth/xlsx), donc jamais passé par le compilateur de gabarits
       Angular — sans ::ng-deep, l'encapsulation de style ne l'atteindrait
       jamais (attribut _ngcontent absent sur du HTML injecté à l'exécution). */
    .dp-docx ::ng-deep table{border-collapse:collapse;width:100%}
    .dp-docx ::ng-deep td,.dp-docx ::ng-deep th{border:1px solid var(--line);padding:4px 8px}
    .dp-onglets{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
    .dp-onglet{background:#fff;border:1px solid var(--line);border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer}
    .dp-onglet.actif{background:var(--gold);border-color:var(--gold);color:#1b2436;font-weight:600}
    .dp-feuille{overflow:auto}
    .dp-feuille ::ng-deep table{border-collapse:collapse;font-size:12px}
    .dp-feuille ::ng-deep td,.dp-feuille ::ng-deep th{border:1px solid var(--line);padding:3px 7px;white-space:nowrap}
    .dp-texte{white-space:pre-wrap;font-size:13px;font-family:ui-monospace,monospace}
  `],
})
export class DocumentPreviewComponent {
  readonly svc = inject(DocumentPreviewService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  private objectUrlActuelle: string | null = null;

  readonly type = signal<TypeApercu>('non_supporte');
  readonly urlSure = signal<SafeResourceUrl | null>(null);
  readonly htmlSur = signal<SafeHtml | null>(null);
  readonly texteBrut = signal('');
  readonly erreurApercu = signal('');
  readonly classeur = signal<any>(null); // XLSX.WorkBook une fois parsé
  readonly feuilleActive = signal(0);
  readonly feuilles = computed<string[]>(() => this.classeur()?.SheetNames ?? []);

  constructor() {
    effect(() => {
      const b = this.svc.blob();
      const nom = this.svc.nom();
      if (!b) { this.reinitialiser(); return; }
      void this.traiter(b, nom);
    });

    // Réagit à un changement d'onglet (ou à l'arrivée d'un nouveau classeur)
    // pour ne parser qu'une seule fois le fichier puis simplement changer
    // la feuille affichée.
    effect(() => {
      const wb = this.classeur();
      const idx = this.feuilleActive();
      if (wb) void this.rendreFeuille(wb, idx);
    });

    this.destroyRef.onDestroy(() => this.revoquerUrl());
  }

  private reinitialiser(): void {
    this.revoquerUrl();
    this.type.set('non_supporte');
    this.urlSure.set(null);
    this.htmlSur.set(null);
    this.texteBrut.set('');
    this.erreurApercu.set('');
    this.classeur.set(null);
    this.feuilleActive.set(0);
  }

  private revoquerUrl(): void {
    if (this.objectUrlActuelle) { URL.revokeObjectURL(this.objectUrlActuelle); this.objectUrlActuelle = null; }
  }

  private detecterType(blob: Blob, nom: string): TypeApercu {
    const mime = (blob.type || '').toLowerCase();
    const ext = (nom.split('.').pop() || '').toLowerCase();
    if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
    if (mime.includes('wordprocessingml.document') || ext === 'docx') return 'docx';
    if (mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel' || ['xlsx', 'xls', 'csv', 'ods'].includes(ext)) return 'feuille';
    if (mime.startsWith('text/') || ext === 'txt') return 'texte';
    return 'non_supporte';
  }

  private async traiter(blob: Blob, nom: string): Promise<void> {
    this.revoquerUrl();
    this.erreurApercu.set('');
    this.classeur.set(null);
    const t = this.detecterType(blob, nom);
    this.type.set(t);
    try {
      if (t === 'pdf' || t === 'image') {
        this.objectUrlActuelle = URL.createObjectURL(blob);
        this.urlSure.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrlActuelle));
      } else if (t === 'docx') {
        const mammoth = await import('mammoth');
        const arrayBuffer = await blob.arrayBuffer();
        const { value: html } = await mammoth.convertToHtml({ arrayBuffer });
        this.htmlSur.set(this.sanitizer.bypassSecurityTrustHtml(html));
      } else if (t === 'feuille') {
        const XLSX = await import('xlsx');
        const arrayBuffer = await blob.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
        this.feuilleActive.set(0);
        this.classeur.set(wb); // déclenche le rendu via l'effect ci-dessus
      } else if (t === 'texte') {
        this.texteBrut.set(await blob.text());
      }
    } catch {
      this.erreurApercu.set('Aperçu impossible : fichier corrompu ou format non pris en charge.');
    }
  }

  private async rendreFeuille(wb: any, idx: number): Promise<void> {
    try {
      const XLSX = await import('xlsx');
      const feuille = wb.Sheets[wb.SheetNames[idx]];
      const html = XLSX.utils.sheet_to_html(feuille);
      this.htmlSur.set(this.sanitizer.bypassSecurityTrustHtml(html));
    } catch {
      this.erreurApercu.set('Aperçu impossible : fichier corrompu ou format non pris en charge.');
    }
  }
}
