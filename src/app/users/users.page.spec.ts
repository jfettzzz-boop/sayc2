import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';

import { UsersPage } from './users.page';

const ADMIN = {
  id: 'admin-id', user_name: 'Admin', user_email: 'admin@sayc.com', user_state: 'activo',
  role_id: 'role-admin', role_name: 'Administrador', user_created_at: '', user_updated_at: '',
};
const EMPLOYEE = {
  ...ADMIN, id: 'emp-id', user_name: 'Emp', user_email: 'emp@sayc.com',
  role_id: 'role-emp', role_name: 'Empleado',
};
const ROLES = [
  { id: 'role-admin', role_name: 'Administrador', role_description: null },
  { id: 'role-emp', role_name: 'Empleado', role_description: null },
];

describe('UsersPage', () => {
  let page: any;
  let http: HttpTestingController;

  const usersUrl = (offset: number) => `/api/v1/users?limit=50&offset=${offset}`;

  function flushLoad(users = [ADMIN, EMPLOYEE]) {
    http.expectOne('/api/v1/auth/me').flush(ADMIN);
    http.expectOne('/api/v1/roles').flush(ROLES);
    http.expectOne(usersUrl(0)).flush(users);
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [UsersPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService(),
        provideIonicAngular(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    page = TestBed.createComponent(UsersPage).componentInstance;
    page.ionViewWillEnter();
  });

  afterEach(() => http.verify());

  it('loads users from the API on entry', () => {
    flushLoad();
    expect(page.users().map((u: any) => u.id)).toEqual(['admin-id', 'emp-id']);
    expect(page.roles()).toEqual(ROLES);
    expect(page.isLoading()).toBe(false);
    expect(page.hasMore()).toBe(false);
  });

  it('explains a 403 for non-administrators', () => {
    http.expectOne('/api/v1/auth/me').flush(EMPLOYEE);
    http.expectOne('/api/v1/roles').flush(null, { status: 403, statusText: 'x' });
    // The first failure cancels the rest of the load.
    expect(http.expectOne(usersUrl(0)).cancelled).toBe(true);
    expect(page.loadErrorKey()).toBe('errors.FORBIDDEN');
  });

  it('pages through long lists from the end of what is loaded', () => {
    const fullPage = Array.from({ length: 50 }, (_, i) => ({ ...EMPLOYEE, id: `u${i}` }));
    flushLoad(fullPage);
    expect(page.hasMore()).toBe(true);

    page.loadMore();
    http.expectOne(usersUrl(50)).flush([{ ...EMPLOYEE, id: 'last' }]);
    expect(page.users().length).toBe(51);
    expect(page.hasMore()).toBe(false);
  });

  it('requires valid fields before creating', () => {
    flushLoad();
    page.openEditor(null);
    page.form.setValue({ user_name: '   ', user_email: 'bad', role_id: '', password: 'short' });
    page.save();
    http.expectNone('/api/v1/users');
    expect(page.form.controls.user_name.invalid).toBe(true);
    expect(page.passwordErrorKey).toBe('password_rules.min');
    page.form.controls.password.setValue('');
    expect(page.passwordErrorKey).toBe('no_password');
  });

  it('creates a user, puts it on top and clears the form', () => {
    flushLoad();
    page.openEditor(null);
    const body = { user_name: 'New', user_email: 'new@sayc.com', role_id: 'role-emp', password: 'password1' };
    page.form.setValue(body);
    page.save();

    const req = http.expectOne('/api/v1/users');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush({ ...EMPLOYEE, id: 'new-id', user_name: 'New' });

    expect(page.users()[0].id).toBe('new-id');
    expect(page.editor()).toBeNull();
    expect(page.form.getRawValue().password).toBe('');
  });

  it('keeps the form open and explains a duplicate email', () => {
    flushLoad();
    page.openEditor(null);
    page.form.setValue({ user_name: 'New', user_email: 'admin@sayc.com', role_id: 'role-emp', password: 'password1' });
    page.save();
    http.expectOne('/api/v1/users').flush(
      { error: { code: 'AUTH_EMAIL_ALREADY_REGISTERED' } },
      { status: 409, statusText: 'x' },
    );
    expect(page.saveErrorKey()).toBe('errors.AUTH_EMAIL_ALREADY_REGISTERED');
    expect(page.editor()).not.toBeNull();
    expect(page.isSaving()).toBe(false);
  });

  it('sends only the changed fields when editing, and a blank password is not one', () => {
    flushLoad();
    page.openEditor(EMPLOYEE);
    page.form.controls.user_name.setValue('Renamed');
    page.save();

    const req = http.expectOne(`/api/v1/users/${EMPLOYEE.id}`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ user_name: 'Renamed' });
    req.flush({ ...EMPLOYEE, user_name: 'Renamed' });
    expect(page.users()[1].user_name).toBe('Renamed');
  });

  it('closes without a request when nothing changed', () => {
    flushLoad();
    page.openEditor(EMPLOYEE);
    page.save();
    http.expectNone(`/api/v1/users/${EMPLOYEE.id}`);
    expect(page.editor()).toBeNull();
  });

  it('locks the role when editing yourself, without sending it', () => {
    flushLoad();
    page.openEditor(ADMIN);
    expect(page.form.controls.role_id.disabled).toBe(true);
    page.form.controls.user_name.setValue('Me');
    page.save();
    const req = http.expectOne(`/api/v1/users/${ADMIN.id}`);
    expect(req.request.body).toEqual({ user_name: 'Me' });
    req.flush({ ...ADMIN, user_name: 'Me' });

    page.openEditor(EMPLOYEE);
    expect(page.form.controls.role_id.disabled).toBe(false);
    page.closeEditor();
  });

  it('changes a user state and reports a failure', () => {
    flushLoad();
    page.setState(EMPLOYEE, 'inactivo');
    const req = http.expectOne(`/api/v1/users/${EMPLOYEE.id}`);
    expect(req.request.body).toEqual({ user_state: 'inactivo' });
    req.flush({ ...EMPLOYEE, user_state: 'inactivo' });
    expect(page.users()[1].user_state).toBe('inactivo');

    page.setState(EMPLOYEE, 'activo');
    http.expectOne(`/api/v1/users/${EMPLOYEE.id}`).flush(null, { status: 500, statusText: 'x' });
    expect(page.actionErrorKey()).toBe('errors.SERVER_NOT_REACHED');
    expect(page.users()[1].user_state).toBe('inactivo');
  });
});
