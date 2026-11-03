import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { IonButton, IonButtons, IonContent, IonHeader, IonMenuButton, IonSpinner, IonText, IonTitle, IonToolbar } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthService } from '../auth/auth.service';
import { AdminDashboardComponent } from './admin-dashboard/admin-dashboard.component';
import { EmployeeHomeComponent } from './employee-home/employee-home.component';

/** Shows the home page for the role of the signed-in user. */
@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [AdminDashboardComponent, EmployeeHomeComponent, IonButton, IonButtons, IonContent, IonHeader, IonMenuButton, IonSpinner, IonText, IonTitle, IonToolbar, TranslatePipe],
})
export class HomePage {
  private readonly auth = inject(AuthService);

  protected readonly user = this.auth.currentUser;
  protected readonly isAdmin = this.auth.isAdmin;
  protected readonly loadFailed = signal(false);

  ionViewWillEnter() {
    this.refresh();
  }

  /** Picks up a role changed since login. A 401 is handled by the interceptor. */
  protected refresh() {
    this.loadFailed.set(false);
    this.auth.me().subscribe({
      error: (err: HttpErrorResponse) => {
        if (err.status !== 401) this.loadFailed.set(true);
      },
    });
  }
}
