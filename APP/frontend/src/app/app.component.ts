import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (auth.estConnecte) {
      <div class="app">
        <aside class="side">
          <div class="brand">JURIA<span>by JFC Avocats</span></div>
          <nav>
            <a routerLink="/cockpit" routerLinkActive="active">Cockpit</a>
            <a routerLink="/dossiers" routerLinkActive="active">Dossiers</a>
            <a routerLink="/ouverture" routerLinkActive="active">Nouveau dossier</a>
            <a routerLink="/echeancier" routerLinkActive="active">Échéancier</a>
            <a routerLink="/facturation" routerLinkActive="active">Facturation</a>
          </nav>
          <button class="logout" (click)="deconnexion()">Se déconnecter</button>
        </aside>
        <main class="main"><router-outlet /></main>
      </div>
    } @else {
      <router-outlet />
    }
  `,
})
export class AppComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  deconnexion(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
