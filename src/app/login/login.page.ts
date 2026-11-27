import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonButton, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonContent, IonIcon, IonInput, IonInputPasswordToggle, IonHeader, IonModal, IonPopover, IonSpinner, IonText, IonTitle, IonToolbar } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { serverOutline } from 'ionicons/icons';
import { finalize } from 'rxjs/operators';

import { AuthService } from '../auth/auth.service';
import { ConnectionSettingsComponent } from '../connection/connection-settings.component';
import { ConnectionService } from '../connection/connection.service';
import { PreferenceOptionsComponent } from '../preferences/preference-options.component';

/** Maps a failed login to its key in the i18n files. */
function loginErrorKey(err: HttpErrorResponse): string {
  switch (err.status) {
    case 400:
    case 401:
      return 'errors.AUTH_INVALID_CREDENTIALS';
    case 429:
      return 'errors.TOO_MANY_ATTEMPTS';
    case 0:
    case 500:
    case 502:
    case 503:
    case 504:
      // Status 0 is no response at all; 5xx includes the dev proxy with the API stopped.
      return 'errors.SERVER_NOT_REACHED';
    default:
      return 'errors.TRY_AGAIN';
  }
}

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  imports: [ReactiveFormsModule, RouterLink, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonContent, IonIcon, IonInput, IonInputPasswordToggle, IonHeader, IonModal, IonPopover, IonSpinner, IonText, IonTitle, IonToolbar, ConnectionSettingsComponent, PreferenceOptionsComponent, TranslatePipe],
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly connection = inject(ConnectionService);
  protected readonly isConnectionOpen = signal(false);

  protected readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  protected readonly isLoading = signal(false);
  protected readonly errorKey = signal<string | null>(null);

  constructor() {
    addIcons({ 'server-outline': serverOutline });
  }

  protected get emailErrorKey(): string {
    return this.form.controls.email.hasError('required') ? 'no_email' : 'invalid_email';
  }

  protected submit() {
    if (this.isLoading()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);
    this.errorKey.set(null);

    const { email, password } = this.form.getRawValue();
    this.auth.login(email, password).pipe(
      finalize(() => this.isLoading.set(false)),
    ).subscribe({
      next: () => {
        // Ionic keeps pages alive in its stack, so don't leave the password in this one.
        this.form.reset();
        this.router.navigateByUrl('/home', { replaceUrl: true });
      },
      error: (err: HttpErrorResponse) => this.errorKey.set(loginErrorKey(err)),
    });
  }
}
