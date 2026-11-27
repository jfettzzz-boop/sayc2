import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { AuthService } from './auth.service';

/**
 * Requires a session and makes sure the user is loaded, so pages can rely on the role.
 * If the API can't be reached the page still opens, to show its own connection error.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const loginPage = inject(Router).createUrlTree(['/login']);

  if (!auth.isAuthenticated()) return loginPage;
  if (auth.currentUser()) return true;

  return auth.me().pipe(
    map(() => true),
    catchError((err: HttpErrorResponse) => of(err.status === 401 ? loginPage : true)),
  );
};

/** Sends users who already have a session past the login page. */
export const guestGuard: CanActivateFn = () =>
  inject(AuthService).isAuthenticated() ? inject(Router).createUrlTree(['/home']) : true;

/**
 * Restricts a page to administrators; others go to their home page. Runs after authGuard, which
 * has loaded the user, so the role is known. The API checks the role again on every request.
 */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isAdmin() ? true : inject(Router).createUrlTree([auth.currentUser() ? '/home' : '/login']);
};
