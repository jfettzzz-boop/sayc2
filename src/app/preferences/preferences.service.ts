import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

export const LANGUAGES = [
  { code: 'es', label: 'Español (ES)' },
  { code: 'en', label: 'English (EN)' },
  { code: 'fr', label: 'Français (FR)' },
];

export const THEMES = [
  { id: 'light', labelKey: 'light' },
  { id: 'dark', labelKey: 'dark' },
  { id: 'theme-sunset', labelKey: 'theme_sunset' },
  { id: 'theme-emerald', labelKey: 'theme_emerald' },
];

/** Language and theme changes, shared by the side menu and the login page. */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly translate = inject(TranslateService);

  setLanguage(code: string) {
    this.translate.use(code);
  }

  setTheme(theme: string) {
    document.documentElement.classList.remove('ion-palette-dark', 'theme-sunset', 'theme-emerald');
    document.body.classList.remove('theme-sunset', 'theme-emerald');

    if (theme === 'dark') {
      document.documentElement.classList.add('ion-palette-dark');
    } else if (theme !== 'light') {
      document.body.classList.add(theme);
    }
  }
}
