import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'mot-de-passe-oublie',
    loadComponent: () =>
      import('./pages/mot-de-passe-oublie/mot-de-passe-oublie.component').then((m) => m.MotDePasseOublieComponent),
  },
  {
    path: 'reinitialiser-mot-de-passe',
    loadComponent: () =>
      import('./pages/reinitialiser-mot-de-passe/reinitialiser-mot-de-passe.component').then(
        (m) => m.ReinitialiserMotDePasseComponent
      ),
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
        path: 'role-audience',
        loadComponent: () =>
          import('./pages/role-audience/role-audience.component').then((m) => m.RoleAudienceComponent),
      },
      {
        path: 'courrier',
        loadComponent: () => import('./pages/courrier/courrier.component').then((m) => m.CourrierComponent),
      },
      {
        path: 'actes',
        loadComponent: () => import('./pages/actes/actes.component').then((m) => m.ActesComponent),
      },
      {
        path: 'biblio',
        loadComponent: () => import('./pages/biblio/biblio.component').then((m) => m.BiblioComponent),
      },
      {
        path: 'plan-action',
        loadComponent: () =>
          import('./pages/plan-action/plan-action.component').then((m) => m.PlanActionComponent),
      },
      {
        path: 'depenses',
        loadComponent: () => import('./pages/depenses/depenses.component').then((m) => m.DepensesComponent),
      },
      {
        path: 'retrocessions',
        loadComponent: () =>
          import('./pages/retrocessions/retrocessions.component').then((m) => m.RetrocessionsComponent),
      },
      {
        path: 'acces',
        loadComponent: () => import('./pages/acces/acces.component').then((m) => m.AccesComponent),
      },
      {
        path: 'cabinet',
        loadComponent: () => import('./pages/cabinet/cabinet.component').then((m) => m.CabinetComponent),
      },
      {
        path: 'assistant-ia',
        loadComponent: () =>
          import('./pages/assistant-ia/assistant-ia.component').then((m) => m.AssistantIaComponent),
      },
      {
        path: 'portail-client',
        loadComponent: () =>
          import('./pages/portail-client/portail-client.component').then((m) => m.PortailClientComponent),
      },
      {
        path: 'mon-compte',
        loadComponent: () => import('./pages/mon-compte/mon-compte.component').then((m) => m.MonCompteComponent),
      },
      {
        path: 'facturation',
        loadComponent: () => import('./pages/facturation/facturation.component').then((m) => m.FacturationComponent),
      },
      {
        path: 'messagerie',
        loadComponent: () => import('./pages/messagerie/messagerie.component').then((m) => m.MessagerieComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
