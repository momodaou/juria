import { Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';

// Aperçu de fichier sans ouverture classique (21/08/2026, demande
// utilisateur) — état partagé, un seul composant hôte rendu une fois dans
// app.component.ts (même patron que MessagerieService/messagerie-widget).
// N'importe quel écran qui télécharge déjà un fichier authentifié
// (GET .../download → Observable<Blob>) peut ouvrir l'aperçu en lui passant
// ce même Observable, sans dupliquer la logique de détection de format.
@Injectable({ providedIn: 'root' })
export class DocumentPreviewService {
  readonly visible = signal(false);
  readonly nom = signal('');
  readonly blob = signal<Blob | null>(null);
  readonly chargement = signal(false);
  readonly erreur = signal('');

  ouvrir(nom: string, telechargement$: Observable<Blob>): void {
    this.nom.set(nom);
    this.blob.set(null);
    this.erreur.set('');
    this.chargement.set(true);
    this.visible.set(true);
    telechargement$.subscribe({
      next: (b) => { this.blob.set(b); this.chargement.set(false); },
      error: () => { this.erreur.set('Impossible de charger le fichier.'); this.chargement.set(false); },
    });
  }

  fermer(): void {
    this.visible.set(false);
    this.blob.set(null);
    this.erreur.set('');
  }
}
