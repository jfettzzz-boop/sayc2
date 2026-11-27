import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { IonBadge, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonIcon, IonItem, IonLabel, IonList, IonNote, IonSpinner, IonText } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { refreshOutline, warningOutline } from 'ionicons/icons';
import { finalize } from 'rxjs/operators';

import { DashboardData, DashboardService } from './dashboard.service';

@Component({
  selector: 'app-admin-dashboard',
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.scss'],
  imports: [DatePipe, DecimalPipe, IonBadge, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonIcon, IonItem, IonLabel, IonList, IonNote, IonSpinner, IonText, TranslatePipe],
})
export class AdminDashboardComponent implements OnInit {
  private readonly dashboard = inject(DashboardService);

  protected readonly data = signal<DashboardData | null>(null);
  protected readonly isLoading = signal(false);
  protected readonly loadFailed = signal(false);

  constructor() {
    addIcons({ 'refresh-outline': refreshOutline, 'warning-outline': warningOutline });
  }

  ngOnInit() {
    this.load();
  }

  protected load() {
    this.isLoading.set(true);
    this.loadFailed.set(false);
    this.dashboard.load().pipe(
      finalize(() => this.isLoading.set(false)),
    ).subscribe({
      next: (data) => this.data.set(data),
      error: () => this.loadFailed.set(true),
    });
  }
}
