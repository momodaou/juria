import { Directive, EventEmitter, HostListener, Input, Output } from '@angular/core';

// JURIA — raccourcis clavier d'un formulaire (30/10/2026) : Entrée valide, Échap annule.
//
// À poser sur le conteneur d'un formulaire :
//   <div appRaccourcis (entree)="enregistrer()" (echap)="annuler()" [entreeActive]="formulaireValide()">
// Règles (usages courants et WCAG 3.3.4) :
//  - Entrée n'agit que si `entreeActive` est vrai (mêmes conditions que le bouton : champs obligatoires remplis,
//    pas d'envoi en cours) — jamais de validation d'un formulaire incomplet ;
//  - Entrée est ignorée dans une zone de texte (retour à la ligne), une liste déroulante, un bouton ou un lien (leur
//    comportement natif prime), un champ fichier, le sélecteur de dossier, et pendant une composition de caractère ;
//  - aucune action destructive ni décaissement ne doit s'y brancher : seules les saisies courantes et leurs actions
//    d'enregistrement le sont.
@Directive({ selector: '[appRaccourcis]', standalone: true })
export class RaccourcisClavierDirective {
  @Input() entreeActive = true;
  @Output() entree = new EventEmitter<void>();
  @Output() echap = new EventEmitter<void>();

  @HostListener('keydown', ['$event'])
  surTouche(ev: KeyboardEvent): void {
    if (ev.isComposing) return;
    const cible = ev.target as HTMLElement | null;
    if (ev.key === 'Escape') {
      if (this.echap.observed && !cible?.closest('app-dossier-picker')) { ev.stopPropagation(); this.echap.emit(); }
      return;
    }
    if (ev.key !== 'Enter' || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (!this.entree.observed || !this.entreeActive) return;
    const balise = cible?.tagName ?? '';
    if (['TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(balise)) return;
    if (balise === 'INPUT' && (cible as HTMLInputElement).type === 'file') return;
    if (cible?.isContentEditable || cible?.closest('app-dossier-picker')) return;
    ev.preventDefault();
    this.entree.emit();
  }
}
