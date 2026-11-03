import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { IonApp, IonSplitPane, IonMenu, IonContent, IonList, IonListHeader, IonNote, IonMenuToggle, IonItem, IonIcon, IonLabel, IonRouterOutlet, IonRouterLink, MenuController, NavController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { filter, map } from 'rxjs/operators';
import { 
  searchOutline, searchSharp, search, 
  close, closeCircle, 
  addCircleOutline, addSharp,
  homeOutline, homeSharp, 
  personCircleOutline, personCircleSharp, 
  mailOutline, mailSharp, 
  paperPlaneOutline, paperPlaneSharp, 
  heartOutline, heartSharp, 
  archiveOutline, archiveSharp, 
  trashOutline, trashSharp, 
  warningOutline, warningSharp, 
  bookmarkOutline, bookmarkSharp, 
  languageOutline, chevronDownOutline, chevronUpOutline, 
  colorPaletteOutline, menuOutline,
  logOutOutline,
  cashOutline, cashSharp,
  cubeOutline, cubeSharp
} from 'ionicons/icons';

// Multilanguage
import { TranslateService, TranslatePipe } from '@ngx-translate/core';

import { AuthService } from './auth/auth.service';
import { LANGUAGES, PreferencesService, THEMES } from './preferences/preferences.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [RouterLink, RouterLinkActive, IonApp, IonSplitPane, IonMenu, IonContent, IonList, IonListHeader, IonNote, IonMenuToggle, IonItem, IonIcon, IonLabel, IonRouterLink, IonRouterOutlet, TranslatePipe],
})
export class AppComponent implements OnInit {
  protected readonly labels = ['Extra'];
  protected readonly languages = LANGUAGES;
  protected readonly themes = THEMES;

  private readonly auth = inject(AuthService);
  private readonly nav = inject(NavController);
  private readonly menu = inject(MenuController);
  private readonly preferences = inject(PreferencesService);

  protected readonly appPages = computed(() => [
    { title: 'titles.dashboard', url: '/home', icon: 'home' },
    { title: 'charge.title', url: '/charge', icon: 'cash' },
    { title: 'inventory.title', url: '/inventory', icon: 'cube' },
    ...(this.auth.isAdmin() ? [{ title: 'admin.users_tab', url: '/users', icon: 'person-circle' }] : []),
    { title: 'products_page.title', url: '/food-search', icon: 'search' },
  ]);

  /** Hidden until the first navigation ends, so the menu never flashes on the login page. */
  protected readonly isMenuHidden = toSignal(
    inject(Router).events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects.split(/[?#]/)[0] === '/login'),
    ),
    { initialValue: true },
  );

  protected showLanguageMenu = false;
  protected showThemeMenu = false;
  protected isCollapsed = false;

  /** True when the menu sits beside the page. On small screens it opens over the page instead. */
  protected readonly isPaneVisible = signal(false);

  constructor(private translate: TranslateService) {
    addIcons({  
      'search': search,
      'search-outline': searchOutline,
      'search-sharp': searchSharp,
      'close': close,
      'close-circle': closeCircle,
      'add-circle-outline': addCircleOutline,
      'add-sharp': addSharp,
      'home-outline': homeOutline, 
      'home-sharp': homeSharp, 
      'person-circle-outline': personCircleOutline, 
      'person-circle-sharp': personCircleSharp, 
      'language-outline': languageOutline,
      'chevron-down-outline': chevronDownOutline,
      'chevron-up-outline': chevronUpOutline,
      'color-palette-outline': colorPaletteOutline,
      'menu-outline': menuOutline,
      'log-out-outline': logOutOutline,
      'cash-outline': cashOutline,
      'cash-sharp': cashSharp,
      'cube-outline': cubeOutline,
      'cube-sharp': cubeSharp,
      mailOutline, mailSharp, paperPlaneOutline, paperPlaneSharp, heartOutline, heartSharp, archiveOutline, archiveSharp, trashOutline, trashSharp, warningOutline, warningSharp, bookmarkOutline, bookmarkSharp 
    });
  }

  ngOnInit() {
    this.translate.addLangs(['es', 'en', 'fr']);
    this.translate.setFallbackLang('es');
    const browserLang = this.translate.getBrowserLang();
    this.translate.use(browserLang && browserLang.match(/es|en|fr/) ? browserLang : 'fr');
  }

  toggleLanguageMenu() {
    this.showLanguageMenu = !this.showLanguageMenu;
  }

  changeLanguage(lang: string) {
    this.preferences.setLanguage(lang);
    this.showLanguageMenu = false;
  }

  toggleThemeMenu() {
    this.showThemeMenu = !this.showThemeMenu;
    if (this.showThemeMenu) this.showLanguageMenu = false;
  }

  setTheme(theme: string) {
    this.preferences.setTheme(theme);
    this.showThemeMenu = false;
  }

  logout() {
    this.auth.clearSession();
    this.nav.navigateRoot('/login');
  }

  /** Only a menu beside the page can be narrow, so a collapse doesn't carry over to a small screen. */
  protected get isNarrow(): boolean {
    return this.isCollapsed && this.isPaneVisible();
  }

  /** Narrows the menu beside the page, or closes it when it opened over the page. */
  toggleCollapse() {
    if (!this.isPaneVisible()) {
      this.menu.close();
      return;
    }
    this.isCollapsed = !this.isCollapsed;
    if (this.isCollapsed) {
      this.showLanguageMenu = false;
      this.showThemeMenu = false;
    }
  }
}