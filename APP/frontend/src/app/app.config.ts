import { ApplicationConfig, LOCALE_ID } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';

// Nombres à la française (16/10/2026) : « 1 770 000 » (espace insécable fine
// entre les milliers) et virgule décimale, pour tous les pipes number/date.
registerLocaleData(localeFr);

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: LOCALE_ID, useValue: 'fr-FR' },
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
