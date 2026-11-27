import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { IonApp, IonSplitPane, IonMenu, IonContent, IonList, IonListHeader, IonNote, IonMenuToggle, IonItem, IonIcon, IonLabel, IonRouterOutlet, IonRouterLink, IonPopover, AlertController, MenuController, NavController } from '@ionic/angular';
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
  languageOutline, 
  colorPaletteOutline, menuOutline,
  logOutOutline,
  cashOutline, cashSharp,
  cubeOutline, cubeSharp
} from 'ionicons/icons';

// Multilanguage
import { TranslateService, TranslatePipe } from '@ngx-translate/core';

import { PUBLIC_PAGES } from './app.routes';
import { AuthService } from './auth/auth.service';
import { PreferenceOptionsComponent } from './preferences/preference-options.component';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [RouterLink, RouterLinkActive, IonApp, IonSplitPane, IonMenu, IonContent, IonList, IonListHeader, IonNote, IonMenuToggle, IonItem, IonIcon, IonLabel, IonRouterLink, IonRouterOutlet, IonPopover, PreferenceOptionsComponent, TranslatePipe],
})
export class AppComponent implements OnInit {
  protected readonly labels = ['Extra'];

  private readonly auth = inject(AuthService);
  private readonly nav = inject(NavController);
  private readonly menu = inject(MenuController);
  private readonly alerts = inject(AlertController);

  protected readonly appPages = computed(() => [
    { title: 'titles.dashboard', url: '/home', icon: 'home' },
    { title: 'charge.title', url: '/charge', icon: 'cash' },
    { title: 'inventory.title', url: '/inventory', icon: 'cube' },
    ...(this.auth.isAdmin() ? [{ title: 'admin.users_tab', url: '/users', icon: 'person-circle' }] : []),
    { title: 'products_page.title', url: '/food-search', icon: 'search' },
  ]);

  /** The company the signed-in user works for, shown under the menu title. */
  protected readonly orgName = computed(() => this.auth.currentUser()?.org_name ?? null);

  /** Hidden until the first navigation ends, so the menu never flashes on a public page. */
  protected readonly isMenuHidden = toSignal(
    inject(Router).events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => PUBLIC_PAGES.includes(event.urlAfterRedirects.split(/[?#]/)[0].slice(1))),
    ),
    { initialValue: true },
  );

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

  protected async confirmLogout() {
    const t = (key: string) => this.translate.instant(key) as string;
    const alert = await this.alerts.create({
      header: t('logout_confirm_title'),
      message: t('logout_confirm_message'),
      buttons: [
        { text: t('common.cancel'), role: 'cancel' },
        { text: t('close_session'), role: 'destructive', handler: () => this.logout() },
      ],
    });
    await alert.present();
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
  }
}