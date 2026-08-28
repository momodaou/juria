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
      // 404 : distingué depuis le 28/08/2026 (diagnostic « l'aperçu ne
      // fonctionne pas ») — cas réel rencontré : fichier déposé avant le
      // correctif GED du 21/08/2026, perdu lors d'un redéploiement
      // suivant. Le statut HTTP reste lisible même en responseType:'blob'.
      error: (e) => {
        this.erreur.set(
          e?.status === 404
            ? "Fichier introuvable dans le stockage — probablement déposé avant le 21/08/2026 (perdu lors d'un redéploiement) ; à retéléverser."
            : 'Impossible de charger le fichier.'
        );
        this.chargement.set(false);
      },
    });
  }

  fermer(): void {
    this.visible.set(false);
    this.blob.set(null);
    this.erreur.set('');
  }
}
