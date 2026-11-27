import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonIcon, IonRouterLink } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { cashOutline, cubeOutline, searchOutline } from 'ionicons/icons';

@Component({
  selector: 'app-employee-home',
  templateUrl: './employee-home.component.html',
  styleUrls: ['./employee-home.component.scss'],
  imports: [IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonIcon, IonRouterLink, RouterLink, TranslatePipe],
})
export class EmployeeHomeComponent {
  readonly userName = input.required<string>();

  protected readonly cards = [
    { url: '/charge', icon: 'cash-outline', title: 'charge.title', text: 'employee_home.charge_text' },
    { url: '/inventory', icon: 'cube-outline', title: 'inventory.title', text: 'employee_home.inventory_text' },
    { url: '/food-search', icon: 'search-outline', title: 'products_page.title', text: 'employee_home.search_text' },
  ];

  constructor() {
    addIcons({ 'cash-outline': cashOutline, 'cube-outline': cubeOutline, 'search-outline': searchOutline });
  }
}
