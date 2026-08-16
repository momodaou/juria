import { Component, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AuthService } from './core/auth.service';

const SIDEBAR_KEY = 'juria.sidebar.dock';

interface NavItem {
  path: string;
  label: string;
  /** Icône trait (24x24, style Feather-like), un seul path/groupe par entrée. */
  icon: SafeHtml;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (auth.estConnecte) {
      <div class="app" [class.collapsed]="collapsed()">
        <aside class="side">
          <div class="side-head">
            <div class="brand">
              <span class="brand-full">JURIA<small>by JFC Avocats</small></span>
              <span class="brand-mark">J</span>
            </div>
            <button
              type="button"
              class="dock-toggle"
              [title]="collapsed() ? 'Déplier le menu' : 'Réduire le menu'"
              [attr.aria-label]="collapsed() ? 'Déplier le menu' : 'Réduire le menu'"
              (click)="toggleDock()"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                @if (collapsed()) {
                  <polyline points="9 6 15 12 9 18"></polyline>
                } @else {
                  <polyline points="15 6 9 12 15 18"></polyline>
                }
              </svg>
            </button>
          </div>

          <nav>
            @for (item of navItems; track item.path) {
              <a [routerLink]="item.path" routerLinkActive="active" [title]="item.label">
                <span class="ico" [innerHTML]="item.icon"></span>
                <span class="lbl">{{ item.label }}</span>
              </a>
            }
          </nav>

          <button class="logout" type="button" title="Se déconnecter" (click)="deconnexion()">
            <span class="ico" [innerHTML]="icons.logout"></span>
            <span class="lbl">Se déconnecter</span>
          </button>
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
  private readonly sanitizer = inject(DomSanitizer);

  private icon(svg: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  }

  readonly icons = {
    cockpit: this.icon(
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    ),
    dossiers: this.icon(
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>',
    ),
    ouverture: this.icon(
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>',
    ),
    clients: this.icon(
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10.5" r="2.25"/><path d="M5.5 17c.6-2.1 2.2-3.2 3.5-3.2s2.9 1.1 3.5 3.2"/><line x1="14.5" y1="9" x2="18.5" y2="9"/><line x1="14.5" y1="12.5" x2="18.5" y2="12.5"/></svg>',
    ),
    echeancier: this.icon(
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="7.5" y1="2.5" x2="7.5" y2="6.5"/><line x1="16.5" y1="2.5" x2="16.5" y2="6.5"/></svg>',
    ),
    facturation: this.icon(
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5h9l3 3V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z"/><line x1="8.5" y1="8" x2="15.5" y2="8"/><line x1="8.5" y1="12" x2="15.5" y2="12"/><line x1="8.5" y1="16" x2="12.5" y2="16"/></svg>',
    ),
    roleAudience: this.icon(
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21c4-2.4 7-5.2 7-9.5V5.5L12 3 5 5.5v6c0 4.3 3 7.1 7 9.5Z"/><path d="M9 12l2 2 4-4"/></svg>',
    ),
    courrier: this.icon(
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5 12 13l8.5-6.5"/></svg>',
    ),
    actes: this.icon(
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><line x1="8.5" y1="12" x2="15.5" y2="12"/><line x1="8.5" y1="15.5" x2="15.5" y2="15.5"/><line x1="8.5" y1="19" x2="12.5" y2="19"/></svg>',
    ),
    biblio: this.icon(
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H10v18H5.5A1.5 1.5 0 0 1 4 19.5Z"/><path d="M20 4.5A1.5 1.5 0 0 0 18.5 3H14v18h4.5a1.5 1.5 0 0 0 1.5-1.5Z"/><line x1="10" y1="3" x2="10" y2="21"/><line x1="14" y1="3" x2="14" y2="21"/></svg>',
    ),
    planAction: this.icon(
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="9.5" y="4" width="5" height="10" rx="1"/><rect x="16" y="4" width="5" height="13" rx="1"/></svg>',
    ),
    depenses: this.icon(
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1.4 1.2-2.2 2.5-2.2s2.5.8 2.5 2c0 1.6-2 2-2.5 2.7-.5.6-.5 1.5-.5 1.5m0 2.5h.01"/></svg>',
    ),
    logout: this.icon(
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    ),
  };

  readonly navItems: NavItem[] = [
    { path: '/cockpit', label: 'Cockpit', icon: this.icons.cockpit },
    { path: '/dossiers', label: 'Dossiers', icon: this.icons.dossiers },
    { path: '/ouverture', label: 'Nouveau dossier', icon: this.icons.ouverture },
    { path: '/clients', label: 'Clients & KYC', icon: this.icons.clients },
    { path: '/echeancier', label: 'Échéancier', icon: this.icons.echeancier },
    { path: '/role-audience', label: "Rôle d'audience", icon: this.icons.roleAudience },
    { path: '/courrier', label: 'Registre du courrier', icon: this.icons.courrier },
    { path: '/actes', label: "Atelier d'actes", icon: this.icons.actes },
    { path: '/biblio', label: 'Bibliothèque', icon: this.icons.biblio },
    { path: '/plan-action', label: "Plan d'action", icon: this.icons.planAction },
    { path: '/depenses', label: 'Dépenses & caisse', icon: this.icons.depenses },
    { path: '/facturation', label: 'Facturation', icon: this.icons.facturation },
  ];

  readonly collapsed = signal(localStorage.getItem(SIDEBAR_KEY) === '1');

  toggleDock(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
  }

  deconnexion(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
