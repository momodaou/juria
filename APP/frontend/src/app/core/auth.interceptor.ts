import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { MessagerieService } from './messagerie.service';

// Ajoute le jeton à chaque requête et déconnecte en cas de 401.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const messagerie = inject(MessagerieService);
  const token = auth.token;

  const requete = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(requete).pipe(
    catchError((err) => {
      if (err.status === 401) {
        // 🐛 Bug trouvé et corrigé le 13/09/2026 (même audit messagerie) :
        // messagerie.arreter() n'était appelé que sur la déconnexion
        // manuelle (bouton « Se déconnecter »), jamais ici — un jeton expiré
        // (8h, voir routes/auth.js) laissait le flux SSE existant tourner
        // indéfiniment contre un jeton devenu invalide. Sans ce nettoyage,
        // `MessagerieService.demarrer()` (rappelé après une reconnexion,
        // voir login.component.ts) refusait de rouvrir un flux tant que
        // `this.source` restait non nul — la messagerie temps réel restait
        // silencieusement cassée pour le reste de la session tant que la
        // page n'était pas rechargée manuellement (F5).
        messagerie.arreter();
        auth.logout();
        router.navigate(['/login']);
      }
      return throwError(() => err);
    })
  );
};
