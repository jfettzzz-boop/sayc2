import { Component, OnInit, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { IonApp, IonSplitPane, IonMenu, IonContent, IonList, IonListHeader, IonNote, IonMenuToggle, IonItem, IonIcon, IonLabel, IonRouterOutlet, IonRouterLink, NavController } from '@ionic/angular';
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
  logOutOutline, cartOutline, pricetagsOutline
} from 'ionicons/icons';

// Multilanguage
import { TranslateService, TranslatePipe } from '@ngx-translate/core';

import { AuthService } from './auth/auth.service';
import { LANGUAGES, PreferencesService, THEMES } from './preferences/preferences.service';

interface AppPage {
  title: string;
  url: string;
  icon: string;
  adminOnly?: boolean;
}

const ADMIN_ROLE = 'Administrador';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [RouterLink, RouterLinkActive, IonApp, IonSplitPane, IonMenu, IonContent, IonList, IonListHeader, IonNote, IonMenuToggle, IonItem, IonIcon, IonLabel, IonRouterLink, IonRouterOutlet, TranslatePipe],
})
export class AppComponent implements OnInit {
  protected readonly appPages: AppPage[] = [
    { title: 'titles.dashboard', url: '/home', icon: 'home' },
    { title: 'nav.sell', url: '/sales', icon: 'cart' },
    { title: 'nav.products', url: '/products', icon: 'pricetags' },
    { title: 'navigation.searchProducts', url: '/food-search', icon: 'search' },
    { title: 'admin.users_tab', url: '/users', icon: 'person-circle', adminOnly: true },
  ];

  protected readonly visiblePages = computed(() => {
    const isAdmin = this.auth.user()?.role_name === ADMIN_ROLE;
    return this.appPages.filter((page) => !page.adminOnly || isAdmin);
  });
  protected readonly labels = ['Extra'];
  protected readonly languages = LANGUAGES;
  protected readonly themes = THEMES;

  private readonly auth = inject(AuthService);
  private readonly nav = inject(NavController);
  private readonly preferences = inject(PreferencesService);
  private readonly translate = inject(TranslateService);

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

  constructor() {
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
      'cart-outline': cartOutline,
      'pricetags-outline': pricetagsOutline,
      mailOutline, mailSharp, paperPlaneOutline, paperPlaneSharp, heartOutline, heartSharp, archiveOutline, archiveSharp, trashOutline, trashSharp, warningOutline, warningSharp, bookmarkOutline, bookmarkSharp 
    });
  }

  ngOnInit() {
    this.translate.addLangs(['es', 'en', 'fr']);
    this.translate.setFallbackLang('es');
    const browserLang = this.translate.getBrowserLang();
    this.translate.use(browserLang && browserLang.match(/es|en|fr/) ? browserLang : 'es');

    // Restore the profile so the menu can filter by role after a reload.
    if (this.auth.isAuthenticated() && !this.auth.user()) {
      this.auth.loadUser().subscribe({ error: () => undefined });
    }
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

  toggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
    if (this.isCollapsed) {
      this.showLanguageMenu = false;
      this.showThemeMenu = false;
    }
  }
}