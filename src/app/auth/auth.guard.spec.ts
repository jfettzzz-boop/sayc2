import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, provideRouter, Router, RouterStateSnapshot } from '@angular/router';

import { adminGuard, authGuard, guestGuard } from './auth.guard';
import { AuthService } from './auth.service';

function tokenExpiringIn(seconds: number): string {
  const payload = btoa(JSON.stringify({ sub: 'id', exp: Math.floor(Date.now() / 1000) + seconds }));
  return `header.${payload.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`;
}

describe('auth guards', () => {
  const run = (guard: CanActivateFn) =>
    TestBed.runInInjectionContext(() => guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));
  const redirect = (path: string) => TestBed.inject(Router).createUrlTree([path]).toString();
  const setup = (token?: string) => {
    localStorage.clear();
    if (token) localStorage.setItem('sayc_token', token);
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  };

  it('with a valid session: allows protected pages and skips login', () => {
    setup(tokenExpiringIn(60));
    expect(run(authGuard)).toBe(true);
    expect(run(guestGuard)!.toString()).toBe(redirect('/home'));
  });

  it('without a session: shows login and blocks protected pages', () => {
    setup();
    expect(run(guestGuard)).toBe(true);
    expect(run(authGuard)!.toString()).toBe(redirect('/login'));
  });

  it.each([
    ['expired', tokenExpiringIn(-60)],
    ['malformed', 'garbage'],
  ])('treats a token that is %s as no session and clears it', (_, token) => {
    setup(token);
    expect(run(guestGuard)).toBe(true);
    expect(localStorage.getItem('sayc_token')).toBeNull();
  });
});

describe('adminGuard', () => {
  const run = () =>
    TestBed.runInInjectionContext(() =>
      adminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
  const user = (role_name: string) => ({
    id: 'id', user_name: 'U', user_email: 'u@sayc.com', user_state: 'activo',
    role_id: 'r', role_name,
  });

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('sends visitors to login', () => {
    expect(run()!.toString()).toBe(TestBed.inject(Router).createUrlTree(['/login']).toString());
  });

  it('allows administrators and sends employees home', () => {
    localStorage.setItem('sayc_token', tokenExpiringIn(60));
    const auth = TestBed.inject(AuthService);

    auth.user.set(user('Administrador'));
    expect(run()).toBe(true);

    auth.user.set(user('Empleado'));
    expect(run()!.toString()).toBe(TestBed.inject(Router).createUrlTree(['/home']).toString());
  });
});
