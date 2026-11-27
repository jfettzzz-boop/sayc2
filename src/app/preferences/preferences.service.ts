import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

export const LANGUAGES = [
  { code: 'es', label: 'Español (ES)' },
  { code: 'en', label: 'English (EN)' },
  { code: 'fr', label: 'Français (FR)' },
];

// The colors repeat global.scss and Ionic's palettes, to preview a theme before it's applied.
export const THEMES = [
  { id: 'light', labelKey: 'light', background: '#ffffff', primary: '#0054e9' },
  { id: 'dark', labelKey: 'dark', background: '#121212', primary: '#4d8dff' },
  { id: 'theme-sunset', labelKey: 'theme_sunset', background: '#fffaf5', primary: '#c2410c' },
  { id: 'theme-emerald', labelKey: 'theme_emerald', background: '#f4fbf7', primary: '#047857' },
  { id: 'theme-purple', labelKey: 'theme_purple', background: '#faf7fd', primary: '#7e22ce' },
];

const THEME_CLASSES = THEMES.map((t) => t.id).filter((id) => id.startsWith('theme-'));

/** Language and theme changes, shared by the side menu and the login page. */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly translate = inject(TranslateService);

  setLanguage(code: string) {
    this.translate.use(code);
  }

  setTheme(theme: string) {
    document.documentElement.classList.remove('ion-palette-dark', ...THEME_CLASSES);
    document.body.classList.remove(...THEME_CLASSES);

    if (theme === 'dark') {
      document.documentElement.classList.add('ion-palette-dark');
    } else if (theme !== 'light') {
      document.body.classList.add(theme);
    }
  }
}
