import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonButton, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonContent, IonIcon, IonInput, IonInputPasswordToggle, IonSpinner, IonText } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { arrowBackOutline } from 'ionicons/icons';
import { finalize } from 'rxjs/operators';

import { AuthService, Registration } from '../auth/auth.service';

export const MIN_PASSWORD = 8;

/** Maps a failed registration to its key in the i18n files. */
export function registerErrorKey(err: HttpErrorResponse): string {
  if (err.status === 409) return 'errors.AUTH_EMAIL_ALREADY_REGISTERED';
  if (err.status === 429) return 'errors.TOO_MANY_ATTEMPTS';
  if (err.status === 400) return 'org_register.invalid';
  if (err.status === 0 || err.status >= 500) return 'errors.SERVER_NOT_REACHED';
  return 'errors.TRY_AGAIN';
}

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const { password, confirm } = group.value;
  return password && confirm && password !== confirm ? { mismatch: true } : null;
}

/** Leaves out optional fields left blank, rather than sending empty strings. */
function filled(value: string): string | undefined {
  return value.trim() || undefined;
}

/** Registers a new company and its first administrator, then opens the app signed in. */
@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  imports: [ReactiveFormsModule, RouterLink, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonContent, IonIcon, IonInput, IonInputPasswordToggle, IonSpinner, IonText, TranslatePipe],
})
export class RegisterPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly minPassword = MIN_PASSWORD;

  protected readonly form = new FormGroup({
    org_name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(150)] }),
    org_email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email, Validators.maxLength(150)] }),
    org_tax_id: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(30)] }),
    org_phone: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(30)] }),
    org_address: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(255)] }),
    user_name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    user_email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email, Validators.maxLength(150)] }),
    passwords: new FormGroup({
      password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(MIN_PASSWORD), Validators.maxLength(72)] }),
      confirm: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    }, { validators: passwordsMatch }),
  });

  protected readonly isLoading = signal(false);
  protected readonly errorKey = signal<string | null>(null);

  constructor() {
    addIcons({ 'arrow-back-outline': arrowBackOutline });
  }

  protected emailErrorKey(control: 'org_email' | 'user_email'): string {
    return this.form.controls[control].hasError('required') ? 'no_email' : 'invalid_email';
  }

  protected get passwordErrorKey(): string {
    return this.form.controls.passwords.controls.password.hasError('required') ? 'no_password' : 'org_register.password_short';
  }

  protected get showMismatch(): boolean {
    const passwords = this.form.controls.passwords;
    return passwords.hasError('mismatch') && passwords.controls.confirm.touched;
  }

  protected submit() {
    if (this.isLoading()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const registration: Registration = {
      organization: {
        org_name: value.org_name.trim(),
        org_email: value.org_email.trim(),
        org_tax_id: filled(value.org_tax_id),
        org_phone: filled(value.org_phone),
        org_address: filled(value.org_address),
      },
      user: {
        user_name: value.user_name.trim(),
        user_email: value.user_email.trim(),
        password: value.passwords.password,
      },
    };

    this.isLoading.set(true);
    this.errorKey.set(null);
    this.auth.register(registration).pipe(
      finalize(() => this.isLoading.set(false)),
    ).subscribe({
      next: () => {
        // Ionic keeps pages alive in its stack, so don't leave the password in this one.
        this.form.reset();
        this.router.navigateByUrl('/home', { replaceUrl: true });
      },
      error: (err: HttpErrorResponse) => this.errorKey.set(registerErrorKey(err)),
    });
  }
}
