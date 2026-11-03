import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AlertController, IonBadge, IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonIcon, IonInput, IonInputPasswordToggle, IonItem, IonLabel, IonList, IonModal, IonNote, IonSelect, IonSelectOption, IonSpinner, IonText, IonTitle, IonToolbar } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { addOutline, banOutline, checkmarkCircleOutline, createOutline } from 'ionicons/icons';
import { Subscription, forkJoin } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { AuthService } from '../auth/auth.service';
import { ManagedUser, Role, USERS_PAGE_SIZE, UserChanges, UsersService } from './users.service';

/** Null while creating, the user being changed while editing. */
interface Editor {
  user: ManagedUser | null;
}

const PASSWORD_RULES = [Validators.minLength(8), Validators.maxLength(72)];
const notBlank = Validators.pattern(/\S/);

function errorKeyFor(err: HttpErrorResponse): string {
  if (err.error?.error?.code === 'AUTH_EMAIL_ALREADY_REGISTERED') {
    return 'errors.AUTH_EMAIL_ALREADY_REGISTERED';
  }
  if (err.status === 400) return 'admin.invalid_data';
  return err.status === 0 || err.status >= 500 ? 'errors.SERVER_NOT_REACHED' : 'errors.TRY_AGAIN';
}

@Component({
  selector: 'app-users',
  templateUrl: './users.page.html',
  styleUrls: ['./users.page.scss'],
  imports: [ReactiveFormsModule, IonBadge, IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonIcon, IonInput, IonInputPasswordToggle, IonItem, IonLabel, IonList, IonModal, IonNote, IonSelect, IonSelectOption, IonSpinner, IonText, IonTitle, IonToolbar, TranslatePipe],
})
export class UsersPage {
  private readonly usersService = inject(UsersService);
  private readonly auth = inject(AuthService);
  private readonly alerts = inject(AlertController);
  private readonly translate = inject(TranslateService);

  protected readonly users = signal<ManagedUser[]>([]);
  protected readonly roles = signal<Role[]>([]);
  protected readonly currentUserId = signal<string | null>(null);

  protected readonly isLoading = signal(false);
  protected readonly isLoadingMore = signal(false);
  protected readonly hasMore = signal(false);
  /** Replaces the list when it could not be loaded. */
  protected readonly loadErrorKey = signal<string | null>(null);
  /** Shown above the list when an action on a loaded row fails. */
  protected readonly actionErrorKey = signal<string | null>(null);

  protected readonly editor = signal<Editor | null>(null);
  protected readonly isSaving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);

  protected readonly form = new FormGroup({
    user_name: new FormControl('', { nonNullable: true, validators: [Validators.required, notBlank] }),
    user_email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    role_id: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true }),
  });

  private loadSubscription?: Subscription;

  constructor() {
    addIcons({
      'add-outline': addOutline,
      'ban-outline': banOutline,
      'checkmark-circle-outline': checkmarkCircleOutline,
      'create-outline': createOutline,
    });
  }

  // Ionic keeps pages alive between visits, and the signed-in user may have changed since the
  // last one, so this reloads on every entry instead of once in ngOnInit.
  ionViewWillEnter() {
    this.load();
  }

  protected get emailErrorKey(): string {
    return this.form.controls.user_email.hasError('required') ? 'no_email' : 'invalid_email';
  }

  protected get passwordErrorKey(): string {
    return this.form.controls.password.hasError('required') ? 'no_password' : 'password_rules.min';
  }

  protected isSelf(user: ManagedUser): boolean {
    return user.id === this.currentUserId();
  }

  protected load() {
    this.loadSubscription?.unsubscribe();
    this.isLoading.set(true);
    this.loadErrorKey.set(null);
    this.actionErrorKey.set(null);

    this.loadSubscription = forkJoin({
      me: this.auth.me(),
      roles: this.usersService.roles(),
      users: this.usersService.list(0),
    }).pipe(
      finalize(() => this.isLoading.set(false)),
    ).subscribe({
      next: ({ me, roles, users }) => {
        this.currentUserId.set(me.id);
        this.roles.set(roles);
        this.users.set(users);
        this.hasMore.set(users.length === USERS_PAGE_SIZE);
      },
      error: (err: HttpErrorResponse) => {
        this.users.set([]);
        this.hasMore.set(false);
        this.loadErrorKey.set(err.status === 403 ? 'errors.FORBIDDEN' : 'admin.load_error');
      },
    });
  }

  protected loadMore() {
    this.isLoadingMore.set(true);
    this.actionErrorKey.set(null);
    this.usersService.list(this.users().length).pipe(
      finalize(() => this.isLoadingMore.set(false)),
    ).subscribe({
      next: (users) => {
        this.users.update((current) => [...current, ...users]);
        this.hasMore.set(users.length === USERS_PAGE_SIZE);
      },
      error: () => this.actionErrorKey.set('admin.load_error'),
    });
  }

  protected openEditor(user: ManagedUser | null) {
    this.form.reset({
      user_name: user?.user_name ?? '',
      user_email: user?.user_email ?? '',
      role_id: user?.role_id ?? '',
      password: '',
    });

    // A blank password keeps the current one when editing, but a new user needs one.
    this.form.controls.password.setValidators(user ? PASSWORD_RULES : [Validators.required, ...PASSWORD_RULES]);
    this.form.controls.password.updateValueAndValidity();

    // The API refuses a change to your own role, which prevents locking out the last admin.
    if (user && this.isSelf(user)) {
      this.form.controls.role_id.disable();
    } else {
      this.form.controls.role_id.enable();
    }

    this.saveErrorKey.set(null);
    this.editor.set({ user });
  }

  protected closeEditor() {
    this.editor.set(null);
    // Don't leave a typed password in memory once the modal is closed.
    this.form.reset();
  }

  protected save() {
    const editor = this.editor();
    if (!editor || this.isSaving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const request = editor.user
      ? this.saveChanges(editor.user)
      : this.usersService.create(this.form.getRawValue());
    if (!request) {
      this.closeEditor();
      return;
    }

    this.isSaving.set(true);
    this.saveErrorKey.set(null);
    request.pipe(
      finalize(() => this.isSaving.set(false)),
    ).subscribe({
      next: (saved) => {
        this.replaceOrAdd(saved);
        this.closeEditor();
      },
      error: (err: HttpErrorResponse) => this.saveErrorKey.set(errorKeyFor(err)),
    });
  }

  protected async confirmDeactivate(user: ManagedUser) {
    const t = (key: string) => this.translate.instant(key) as string;
    const alert = await this.alerts.create({
      header: t('admin.deactivate'),
      message: `${t('admin.confirm_deactivate')} (${user.user_name})`,
      buttons: [
        { text: t('common.cancel'), role: 'cancel' },
        { text: t('admin.deactivate'), role: 'destructive', handler: () => this.setState(user, 'inactivo') },
      ],
    });
    await alert.present();
  }

  protected setState(user: ManagedUser, user_state: 'activo' | 'inactivo') {
    this.actionErrorKey.set(null);
    this.usersService.update(user.id, { user_state }).subscribe({
      next: (saved) => this.replaceOrAdd(saved),
      error: (err: HttpErrorResponse) => this.actionErrorKey.set(errorKeyFor(err)),
    });
  }

  /** Sends only what changed. Returns null when nothing did. */
  private saveChanges(user: ManagedUser) {
    const { user_name, user_email, role_id, password } = this.form.getRawValue();
    const changes: UserChanges = {};
    if (user_name !== user.user_name) changes.user_name = user_name;
    if (user_email !== user.user_email) changes.user_email = user_email;
    if (role_id !== user.role_id) changes.role_id = role_id;
    if (password) changes.password = password;
    return Object.keys(changes).length > 0 ? this.usersService.update(user.id, changes) : null;
  }

  private replaceOrAdd(saved: ManagedUser) {
    this.users.update((users) =>
      users.some((user) => user.id === saved.id)
        ? users.map((user) => (user.id === saved.id ? saved : user))
        // The API lists newest first, so a new user goes on top.
        : [saved, ...users],
    );
  }
}
