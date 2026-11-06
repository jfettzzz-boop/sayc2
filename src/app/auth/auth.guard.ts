import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { AuthService } from './auth.service';

/** Sends visitors without a session to the login page. */
export const authGuard: CanActivateFn = () =>
  inject(AuthService).isAuthenticated() ? true : inject(Router).createUrlTree(['/login']);

/** Sends users who already have a session past the login page. */
export const guestGuard: CanActivateFn = () =>
  inject(AuthService).isAuthenticated() ? inject(Router).createUrlTree(['/home']) : true;

const ADMIN_ROLE = 'Administrador';

/**
 * Restricts a route to administrators. The role comes from /auth/me, so the
 * profile is fetched when it is not in memory yet (fresh app load).
 */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const allow = () => true;
  const deny = () => router.createUrlTree(['/home']);
  const toLogin = () => router.createUrlTree(['/login']);

  if (!auth.isAuthenticated()) return toLogin();

  const user = auth.user();
  if (user) return user.role_name === ADMIN_ROLE ? allow() : deny();

  return auth.me().pipe(
    map((loaded) => (loaded.role_name === ADMIN_ROLE ? allow() : deny())),
    catchError(() => of(toLogin())),
  );
};
