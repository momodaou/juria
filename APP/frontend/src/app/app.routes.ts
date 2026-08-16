import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'cockpit' },
      {
        path: 'cockpit',
        loadComponent: () => import('./pages/cockpit/cockpit.component').then((m) => m.CockpitComponent),
      },
      {
        path: 'dossiers',
        loadComponent: () => import('./pages/dossiers/dossiers.component').then((m) => m.DossiersComponent),
      },
      {
        path: 'dossiers/:id',
        loadComponent: () =>
          import('./pages/dossier-detail/dossier-detail.component').then((m) => m.DossierDetailComponent),
      },
      {
        path: 'clients',
        loadComponent: () => import('./pages/clients/clients.component').then((m) => m.ClientsComponent),
      },
      {
        path: 'clients/:id',
        loadComponent: () =>
          import('./pages/client-detail/client-detail.component').then((m) => m.ClientDetailComponent),
      },
      {
        path: 'ouverture',
        loadComponent: () => import('./pages/ouverture/ouverture.component').then((m) => m.OuvertureComponent),
      },
      {
        path: 'echeancier',
        loadComponent: () => import('./pages/echeancier/echeancier.component').then((m) => m.EcheancierComponent),
      },
      {
        path: 'facturation',
        loadComponent: () => import('./pages/facturation/facturation.component').then((m) => m.FacturationComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
