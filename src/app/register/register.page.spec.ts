import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';

import { AuthService, REGISTER_URL } from '../auth/auth.service';
import { RegisterPage, registerErrorKey } from './register.page';

describe('registerErrorKey', () => {
  it.each([
    [409, 'errors.AUTH_EMAIL_ALREADY_REGISTERED'],
    [429, 'errors.TOO_MANY_ATTEMPTS'],
    [400, 'org_register.invalid'],
    [0, 'errors.SERVER_NOT_REACHED'],
    [503, 'errors.SERVER_NOT_REACHED'],
    [418, 'errors.TRY_AGAIN'],
  ])('maps %i to %s', (status, key) => {
    expect(registerErrorKey(new HttpErrorResponse({ status }))).toBe(key);
  });
});

describe('RegisterPage', () => {
  let fixture: ComponentFixture<RegisterPage>;
  let page: any;
  let http: HttpTestingController;
  let router: Router;

  const fill = (overrides: Record<string, unknown> = {}) =>
    page.form.setValue({
      org_name: ' Tienda Nueva ',
      org_email: 'tienda@example.com',
      org_tax_id: '',
      org_phone: ' 5551234567 ',
      org_address: '',
      user_name: 'Dueña',
      user_email: 'duena@example.com',
      passwords: { password: 'password1', confirm: 'password1' },
      ...overrides,
    });

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [RegisterPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), provideTranslateService(), provideIonicAngular()],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(RegisterPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('sends trimmed details, leaving out blank optional fields, and signs in', () => {
    fill();
    page.submit();

    const req = http.expectOne(REGISTER_URL);
    expect(req.request.body).toEqual({
      organization: { org_name: 'Tienda Nueva', org_email: 'tienda@example.com', org_phone: '5551234567' },
      user: { user_name: 'Dueña', user_email: 'duena@example.com', password: 'password1' },
    });
    const header = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
    req.flush({ token: `x.${header}.y`, user: { id: 'u', org_name: 'Tienda Nueva', role_name: 'Administrador' } });

    const auth = TestBed.inject(AuthService);
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.isAdmin()).toBe(true);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/home', { replaceUrl: true });
    expect(page.form.controls.passwords.controls.password.value).toBe('');
  });

  it('sends nothing while the form is incomplete or the passwords differ', () => {
    page.submit();
    fill({ passwords: { password: 'password1', confirm: 'password2' } });
    page.submit();
    fill({ passwords: { password: 'short', confirm: 'short' } });
    page.submit();
    fill({ org_email: 'not-an-email' });
    page.submit();
    http.expectNone(REGISTER_URL);
  });

  it('shows why the registration failed, and allows another try', () => {
    fill();
    page.submit();
    http.expectOne(REGISTER_URL).flush({ error: { code: 'AUTH_EMAIL_ALREADY_REGISTERED' } }, { status: 409, statusText: 'Conflict' });
    expect(page.errorKey()).toBe('errors.AUTH_EMAIL_ALREADY_REGISTERED');
    expect(page.isLoading()).toBe(false);
    expect(router.navigateByUrl).not.toHaveBeenCalled();

    page.submit();
    http.expectOne(REGISTER_URL);
  });
});
