import { Component, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IonApp, IonSplitPane, IonMenu, IonContent, IonList, IonListHeader, IonNote, IonMenuToggle, IonItem, IonIcon, IonLabel, IonRouterOutlet, IonRouterLink } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {homeOutline, homeSharp, personCircleOutline, personCircleSharp, mailOutline, mailSharp, paperPlaneOutline, paperPlaneSharp, heartOutline, heartSharp, archiveOutline, archiveSharp, trashOutline, trashSharp, warningOutline, warningSharp, bookmarkOutline, bookmarkSharp, languageOutline, chevronDownOutline, chevronUpOutline, colorPaletteOutline, menuOutline } from 'ionicons/icons';

// Multilanguage
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
// Multilanguage end

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [RouterLink, RouterLinkActive, IonApp, IonSplitPane, IonMenu, IonContent, IonList, IonListHeader, IonNote, IonMenuToggle, IonItem, IonIcon, IonLabel, IonRouterLink, IonRouterOutlet, TranslatePipe],
})
export class AppComponent implements OnInit {
  protected readonly appPages = [
    { title: 'titles.dashboard', url: '/folder/Home', icon: 'home' },
    { title: 'admin.users_tab', url: '/folder/Users', icon: 'person-circle' },
    { title: 'navigation.searchProducts', url: '/food-search', icon: 'search' },
  ];
  protected readonly labels = ['Extra'];
  
  // Multilanguage
  protected showLanguageMenu = false;
  //Theme
  protected showThemeMenu = false;
  // Menu Collapse state
  protected isCollapsed = false;

  constructor( private translate: TranslateService ) {
  // Multilanguage end

    addIcons({  
      'home-outline': homeOutline, 
      'home-sharp': homeSharp, 
      'person-circle-outline': personCircleOutline, 
      'person-circle-sharp': personCircleSharp, 
      'language-outline': languageOutline,
      'chevron-down-outline': chevronDownOutline,
      'chevron-up-outline': chevronUpOutline,
      'color-palette-outline': colorPaletteOutline,
      'menu-outline': menuOutline,
      mailOutline, mailSharp, paperPlaneOutline, paperPlaneSharp, heartOutline, heartSharp, archiveOutline, archiveSharp, trashOutline, trashSharp, warningOutline, warningSharp, bookmarkOutline, bookmarkSharp 
    });
  }
  //Multilanguage
  ngOnInit() {
    this.translate.addLangs(['es', 'en', 'fr']);
    this.translate.setFallbackLang('es');
    const browserLang = this.translate.getBrowserLang();
    this.translate.use(browserLang && browserLang.match(/es|en|fr/) ? browserLang : 'es');
  }
  toggleLanguageMenu() {
    this.showLanguageMenu = !this.showLanguageMenu;
  }
  changeLanguage(lang: string) {
    this.translate.use(lang);
    this.showLanguageMenu = false;
  }
  //Multilanguage end
  //Theme
  toggleThemeMenu() {
    this.showThemeMenu = !this.showThemeMenu;
    if (this.showThemeMenu) this.showLanguageMenu = false;
  }

  setTheme(theme: string) {
    document.documentElement.classList.remove('ion-palette-dark', 'theme-sunset', 'theme-emerald');
    document.body.classList.remove('theme-sunset', 'theme-emerald');

    if (theme === 'dark') {
      document.documentElement.classList.add('ion-palette-dark');
    } else if (theme === 'light') {
    } else {
      document.body.classList.add(theme);
    }
    this.showThemeMenu = false;
  }

  toggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
    if (this.isCollapsed) {
      this.showLanguageMenu = false;
      this.showThemeMenu = false;
    }
  }

}