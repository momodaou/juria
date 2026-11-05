import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from './api.service';

// Générateur de courriers — réglages du cabinet (lot 1, 05/11/2026) : papier à en-tête (mesures modifiables sans
// toucher au code), logo par défaut, cachet du cabinet, qualité et signature scannée de chaque signataire.
// Les images déposées ne sont jamais affichées ni téléchargeables : le serveur seul les relit, à l'apposition.
@Component({
  selector: 'app-courrier-reglages',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <section class="panel">
      <h3>Courriers : papier à en-tête, cachet et signatures</h3>
      <p class="muted">Réglages du générateur de courriers. Les mesures se corrigent ici si l'impression sur le papier à en-tête révèle un écart ; le cachet et les signatures sont des images PNG à fond transparent, conservées de façon privée (jamais affichées ni téléchargeables, seulement apposées par le serveur au moment de signer).</p>
      @if (message()) { <p class="msg" [class.msg-err]="erreur()">{{ message() }}</p> }

      @if (r(); as reg) {
        <h4>Papier à en-tête et logo</h4>
        <div class="grid2">
          <div>
            <label>Logo par défaut</label>
            <select class="in" [(ngModel)]="edit.courrier_logo_defaut" name="crLogo">
              <option value="mali">JFC AVOCATS MALI</option>
              <option value="std">JFC AVOCATS</option>
            </select>
          </div>
          <div>
            <label>Décor pâle (en-tête numérique)</label>
            <select class="in" [ngModel]="edit.courrier_decor ? 'oui' : 'non'" (ngModelChange)="edit.courrier_decor = $event === 'oui'" name="crDecor">
              <option value="oui">Oui</option>
              <option value="non">Non</option>
            </select>
          </div>
          <div><label>Texte de la page 1 : distance du bord (cm)</label><input class="in" type="number" step="0.05" [(ngModel)]="edit.courrier_texte_x_page1_cm" name="crTexteX" /></div>
          <div><label>Colonne de droite : distance du bord (cm)</label><input class="in" type="number" step="0.05" [(ngModel)]="edit.courrier_colonne_droite_cm" name="crColDroite" /></div>
          <div><label>Première ligne de la page 1 (cm depuis le haut)</label><input class="in" type="number" step="0.05" [(ngModel)]="edit.courrier_page1_haut_cm" name="crHaut" /></div>
          <div><label>Dernière ligne de la page 1 (cm depuis le haut)</label><input class="in" type="number" step="0.05" [(ngModel)]="edit.courrier_page1_bas_cm" name="crBas" /></div>
          <div><label>Largeur du cachet à 100 % (cm)</label><input class="in" type="number" step="0.1" [(ngModel)]="edit.courrier_cachet_largeur_cm" name="crCachetL" /></div>
        </div>
        <p class="muted" style="margin-top:6px">Valeurs d'origine mesurées sur votre feuille vierge : texte à 6,2 cm (filet vertical à 5,86 cm), colonne de droite à 10,3 cm, première ligne à 3,5 cm, dernière ligne à 27,1 cm, cachet de 5,4 cm.</p>
        <button class="btn" (click)="enregistrer()">Enregistrer les réglages</button>

        <h4 style="margin-top:18px">Cachet du cabinet</h4>
        <p>
          @if (reg.cachet.present) { <span class="tag ok">Déposé le {{ reg.cachet.maj_le | date:'dd/MM/yyyy HH:mm' }}</span> }
          @else { <span class="tag">Non déposé</span> }
        </p>
        <input type="file" accept="image/png" (change)="deposerCachet($event)" />
        @if (reg.cachet.present) { <button class="lien" (click)="retirerCachet()">Retirer le cachet</button> }

        <h4 style="margin-top:18px">Signataires</h4>
        @if (reg.signataires.length) {
          <div class="table-scroll">
            <table>
              <tr><th>Signataire</th><th>Nom et mention sous la signature</th><th>Signature scannée</th></tr>
              @for (s of reg.signataires; track s.id) {
                <tr>
                  <td><b>{{ s.nom }}</b></td>
                  <td>
                    <input class="in" [ngModel]="noms[s.id] ?? s.nom_signature ?? ''" (ngModelChange)="noms[s.id] = $event" [name]="'crN' + s.id" placeholder="Nom sous la signature (vide = Prénom NOM)" />
                    <input class="in" style="margin-top:4px" [ngModel]="qualites[s.id] ?? s.qualite_signature ?? ''" (ngModelChange)="qualites[s.id] = $event" [name]="'crQ' + s.id" placeholder="Ex. Avocat aux Barreaux du Mali &amp; de Paris" />
                    <button class="lien" (click)="enregistrerQualite(s.id)">Enregistrer</button>
                  </td>
                  <td>
                    @if (s.signature.presente) { <span class="tag ok">Déposée le {{ s.signature.maj_le | date:'dd/MM/yyyy' }}</span> <button class="lien" (click)="retirerSignature(s.id)">Retirer</button> }
                    @else { <span class="tag">Non déposée</span> }
                    <br /><input type="file" accept="image/png" (change)="deposerSignature(s.id, $event)" />
                  </td>
                </tr>
              }
            </table>
          </div>
        } @else { <p class="muted">Aucun signataire (associés actifs) à afficher.</p> }
      }
    </section>
  `,
})
export class CourrierReglagesComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly r = signal<any | null>(null);
  readonly message = signal('');
  readonly erreur = signal(false);
  edit: {
    courrier_logo_defaut: string; courrier_decor: boolean; courrier_texte_x_page1_cm: number; courrier_colonne_droite_cm: number;
    courrier_page1_haut_cm: number; courrier_page1_bas_cm: number; courrier_cachet_largeur_cm: number;
  } = {
    courrier_logo_defaut: 'mali', courrier_decor: true, courrier_texte_x_page1_cm: 6.2, courrier_colonne_droite_cm: 10.3,
    courrier_page1_haut_cm: 3.5, courrier_page1_bas_cm: 27.1, courrier_cachet_largeur_cm: 5.4,
  };
  qualites: Record<string, string> = {};
  noms: Record<string, string> = {};

  ngOnInit(): void { this.charger(); }

  private charger(): void {
    this.api.courrierReglages().subscribe({
      next: (r) => {
        this.r.set(r);
        this.edit = {
          courrier_logo_defaut: r.logo_defaut, courrier_decor: r.decor,
          courrier_texte_x_page1_cm: r.texte_x_page1_cm, courrier_colonne_droite_cm: r.colonne_droite_cm,
          courrier_page1_haut_cm: r.page1_haut_cm, courrier_page1_bas_cm: r.page1_bas_cm,
          courrier_cachet_largeur_cm: r.cachet_largeur_cm,
        };
      },
      error: (e) => this.dire(e?.error?.error ?? 'Réglages indisponibles.', true),
    });
  }
  private dire(texte: string, erreur = false): void { this.message.set(texte); this.erreur.set(erreur); }

  enregistrer(): void {
    this.api.majCourrierReglages(this.edit).subscribe({
      next: () => { this.dire('Réglages enregistrés.'); this.charger(); },
      error: (e) => this.dire(e?.error?.error ?? 'Enregistrement impossible.', true),
    });
  }
  deposerCachet(ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    this.api.deposerCachetCourrier(f).subscribe({
      next: () => { this.dire('Cachet déposé.'); this.charger(); },
      error: (e) => this.dire(e?.error?.error ?? 'Dépôt impossible.', true),
    });
  }
  retirerCachet(): void {
    this.api.retirerCachetCourrier().subscribe({ next: () => { this.dire('Cachet retiré.'); this.charger(); } });
  }
  enregistrerQualite(id: string): void {
    const q = this.qualites[id], n = this.noms[id];
    if (q === undefined && n === undefined) { this.dire('Aucune modification à enregistrer.'); return; }
    const payload: { qualite_signature?: string; nom_signature?: string } = {};
    if (q !== undefined) payload.qualite_signature = q;
    if (n !== undefined) payload.nom_signature = n;
    this.api.majSignataireCourrier(id, payload).subscribe({
      next: () => { this.dire('Signataire enregistré.'); delete this.qualites[id]; delete this.noms[id]; this.charger(); },
      error: (e) => this.dire(e?.error?.error ?? 'Enregistrement impossible.', true),
    });
  }
  deposerSignature(id: string, ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    this.api.deposerSignatureCourrier(id, f).subscribe({
      next: () => { this.dire('Signature déposée.'); this.charger(); },
      error: (e) => this.dire(e?.error?.error ?? 'Dépôt impossible.', true),
    });
  }
  retirerSignature(id: string): void {
    this.api.retirerSignatureCourrier(id).subscribe({ next: () => { this.dire('Signature retirée.'); this.charger(); } });
  }
}
