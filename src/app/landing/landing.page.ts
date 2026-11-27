import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonContent, IonIcon, IonPopover } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import {
  businessOutline, cashOutline, cloudOfflineOutline, cubeOutline, peopleOutline, searchOutline, timeOutline,
} from 'ionicons/icons';

import { PreferenceOptionsComponent } from '../preferences/preference-options.component';

interface Feature {
  icon: string;
  key: string;
}

/** The public front page: what SAYC does, and the way in for new companies and returning users. */
@Component({
  selector: 'app-landing',
  templateUrl: './landing.page.html',
  styleUrls: ['./landing.page.scss'],
  imports: [RouterLink, IonButton, IonContent, IonIcon, IonPopover, PreferenceOptionsComponent, TranslatePipe],
})
export class LandingPage {
  protected readonly features: Feature[] = [
    { icon: 'cash-outline', key: 'checkout' },
    { icon: 'cube-outline', key: 'inventory' },
    { icon: 'search-outline', key: 'catalog' },
    { icon: 'people-outline', key: 'roles' },
    { icon: 'time-outline', key: 'history' },
    { icon: 'cloud-offline-outline', key: 'offline' },
  ];

  protected readonly steps = ['register', 'setup', 'sell'];

  protected readonly year = new Date().getFullYear();

  constructor() {
    addIcons({
      'business-outline': businessOutline,
      'cash-outline': cashOutline,
      'cloud-offline-outline': cloudOfflineOutline,
      'cube-outline': cubeOutline,
      'people-outline': peopleOutline,
      'search-outline': searchOutline,
      'time-outline': timeOutline,
    });
  }
}
