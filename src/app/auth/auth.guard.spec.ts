import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, provideRouter, Router, RouterStateSnapshot } from '@angular/router';

import { authGuard, guestGuard } from './auth.guard';

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
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient()] });
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
