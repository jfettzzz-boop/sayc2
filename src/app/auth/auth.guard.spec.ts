import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, provideRouter, Router, RouterStateSnapshot } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';

import { adminGuard, authGuard, guestGuard } from './auth.guard';
import { AuthService, AuthUser } from './auth.service';

function tokenExpiringIn(seconds: number): string {
  const payload = btoa(JSON.stringify({ sub: 'id', exp: Math.floor(Date.now() / 1000) + seconds }));
  return `header.${payload.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`;
}

const USER = { id: 'id', role_name: 'Empleado' } as AuthUser;

describe('auth guards', () => {
  const run = (guard: CanActivateFn) =>
    TestBed.runInInjectionContext(() => guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));
  const redirect = (path: string) => TestBed.inject(Router).createUrlTree([path]).toString();
  const setup = (token?: string) => {
    localStorage.clear();
    if (token) localStorage.setItem('sayc_token', token);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  };

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('skips the login page with a valid session', () => {
    setup(tokenExpiringIn(60));
    expect(run(guestGuard)!.toString()).toBe(redirect('/home'));
  });

  it('allows a protected page immediately when the user is already loaded', () => {
    setup(tokenExpiringIn(60));
    TestBed.inject(AuthService).currentUser.set(USER);
    expect(run(authGuard)).toBe(true);
  });

  it('loads the user after a reload, before allowing the page', async () => {
    setup(tokenExpiringIn(60));
    const result = firstValueFrom(run(authGuard) as Observable<unknown>);
    TestBed.inject(HttpTestingController).expectOne('/api/v1/auth/me').flush(USER);
    expect(await result).toBe(true);
    expect(TestBed.inject(AuthService).currentUser()).toEqual(USER);
  });

  it('sends a token the API rejects to login', async () => {
    setup(tokenExpiringIn(60));
    const result = firstValueFrom(run(authGuard) as Observable<unknown>);
    TestBed.inject(HttpTestingController).expectOne('/api/v1/auth/me').flush(null, { status: 401, statusText: 'x' });
    expect(String(await result)).toBe(redirect('/login'));
  });

  it('still opens the page when the API is unreachable', async () => {
    setup(tokenExpiringIn(60));
    const result = firstValueFrom(run(authGuard) as Observable<unknown>);
    TestBed.inject(HttpTestingController).expectOne('/api/v1/auth/me').error(new ProgressEvent('error'));
    expect(await result).toBe(true);
  });

  it('opens admin pages only for administrators', () => {
    setup(tokenExpiringIn(60));
    const auth = TestBed.inject(AuthService);
    auth.currentUser.set(USER);
    expect(run(adminGuard)!.toString()).toBe(redirect('/home'));
    auth.currentUser.set({ ...USER, role_name: 'Administrador' });
    expect(run(adminGuard)).toBe(true);
  });

  it('runs authGuard before adminGuard on admin pages', () => {
    setup(tokenExpiringIn(60));
    expect(run(adminGuard)!.toString()).toBe(redirect('/login'));
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
