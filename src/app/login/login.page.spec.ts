import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import { LoginPage } from './login.page';

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  let page: any;
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  const fill = (email: string, password: string) => page.form.setValue({ email, password });

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideTranslateService()],
    });
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(LoginPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('does not call the API with an invalid form', () => {
    fill('not-an-email', '');
    page.submit();
    http.expectNone('/api/v1/auth/login');
    expect(page.form.controls.email.touched).toBe(true);
    expect(page.emailErrorKey).toBe('invalid_email');
  });

  it('logs in, stores the token, clears the form and goes home', () => {
    fill('admin@sayc.com', 'admin123');
    page.submit();

    const req = http.expectOne('/api/v1/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'admin@sayc.com', password: 'admin123' });
    expect(page.isLoading()).toBe(true);
    req.flush({ token: 'jwt', user: {} });

    expect(localStorage.getItem('sayc_token')).toBe('jwt');
    expect(page.isLoading()).toBe(false);
    expect(page.form.getRawValue().password).toBe('');
    expect(navigate).toHaveBeenCalledWith('/home', { replaceUrl: true });
  });

  it('ignores a second submit while one is in flight', () => {
    fill('admin@sayc.com', 'admin123');
    page.submit();
    page.submit();
    http.expectOne('/api/v1/auth/login').flush({ token: 'jwt', user: {} });
  });

  it.each([
    [401, 'errors.AUTH_INVALID_CREDENTIALS'],
    [429, 'errors.TOO_MANY_ATTEMPTS'],
    [503, 'errors.SERVER_NOT_REACHED'],
    [418, 'errors.TRY_AGAIN'],
  ])('shows the right message for status %i', (status, key) => {
    fill('admin@sayc.com', 'wrong');
    page.submit();
    http.expectOne('/api/v1/auth/login').flush(null, { status, statusText: 'x' });

    expect(page.errorKey()).toBe(key);
    expect(page.isLoading()).toBe(false);
    expect(localStorage.getItem('sayc_token')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reports a network failure as an unreachable server', () => {
    fill('admin@sayc.com', 'admin123');
    page.submit();
    http.expectOne('/api/v1/auth/login').error(new ProgressEvent('error'));

    expect(page.errorKey()).toBe('errors.SERVER_NOT_REACHED');
    expect(page.isLoading()).toBe(false);
  });
});
