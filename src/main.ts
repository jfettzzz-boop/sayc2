import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withComponentInputBinding, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';

// Multilanguage
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { provideHttpClient, withInterceptors, withInterceptorsFromDi } from '@angular/common/http';
// Multilanguage end

import { authInterceptor } from './app/auth/auth.interceptor';
import { connectionInterceptor } from './app/connection/connection.interceptor';
import { registerServiceWorker } from './app/pwa';

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    
    // Multilanguage Providers
    provideHttpClient(withInterceptorsFromDi(), withInterceptors([authInterceptor, connectionInterceptor])),
    provideTranslateService({
      fallbackLang: 'es',
      loader: provideTranslateHttpLoader({
        prefix: 'assets/i18n/',
        suffix: '.json'
      })
    }),
    // Multilanguage end

    provideIonicAngular(),
    provideRouter(routes, withPreloading(PreloadAllModules), withComponentInputBinding()),
  ],
})
  .then(() => registerServiceWorker())
  .catch((err) => console.error(err));
