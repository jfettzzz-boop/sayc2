import { TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';

import { PreferenceOptionsComponent } from './preference-options.component';
import { PreferencesService, THEMES } from './preferences.service';

describe('PreferenceOptionsComponent', () => {
  function render(kind: 'language' | 'theme') {
    TestBed.configureTestingModule({
      imports: [PreferenceOptionsComponent],
      providers: [provideTranslateService(), provideIonicAngular()],
    });
    const fixture = TestBed.createComponent(PreferenceOptionsComponent);
    fixture.componentRef.setInput('kind', kind);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('lists the languages, without swatches, and applies the one chosen', () => {
    const el = render('language');
    const setLanguage = vi.spyOn(TestBed.inject(PreferencesService), 'setLanguage').mockImplementation(() => undefined);
    const options = el.querySelectorAll<HTMLElement>('.option');
    expect(options.length).toBe(3);
    expect(el.querySelectorAll('.swatch').length).toBe(0);
    options[1].click();
    expect(setLanguage).toHaveBeenCalledWith('en');
  });

  it('shows each theme with its own colors, beside its name', () => {
    const el = render('theme');
    const swatches = el.querySelectorAll<HTMLElement>('.swatch');
    expect(swatches.length).toBe(THEMES.length);
    THEMES.forEach((theme, i) => {
      expect(swatches[i].style.getPropertyValue('--swatch-background')).toBe(theme.background);
      expect(swatches[i].style.getPropertyValue('--swatch-primary')).toBe(theme.primary);
    });
    expect(el.querySelectorAll('.option ion-label').length).toBe(THEMES.length);
  });

  it('gives every theme different colors', () => {
    expect(new Set(THEMES.map((t) => t.primary + t.background)).size).toBe(THEMES.length);
  });

  it('applies the theme chosen', () => {
    const el = render('theme');
    const setTheme = vi.spyOn(TestBed.inject(PreferencesService), 'setTheme').mockImplementation(() => undefined);
    el.querySelectorAll<HTMLElement>('.option')[2].click();
    expect(setTheme).toHaveBeenCalledWith('theme-sunset');
  });
});
