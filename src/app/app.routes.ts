import { Routes } from '@angular/router';

import { adminGuard, authGuard, guestGuard } from './auth/auth.guard';

// Every page requires a session except the public ones in PUBLIC_PAGES. New pages should use
// authGuard too; app.routes.spec.ts fails if one doesn't.
export const PUBLIC_PAGES = ['welcome', 'register', 'login'];

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'welcome',
    pathMatch: 'full',
  },
  {
    path: 'folder/:folder',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./folder/folder.page').then((m) => m.FolderPage),
  },
  {
    path: 'home',
    canActivate: [authGuard],
    loadComponent: () => import('./home/home.page').then( m => m.HomePage)
  },
  {
    path: 'charge',
    canActivate: [authGuard],
    loadComponent: () => import('./charge/charge.page').then( m => m.ChargePage)
  },
  {
    path: 'inventory',
    canActivate: [authGuard],
    loadComponent: () => import('./inventory/inventory.page').then( m => m.InventoryPage)
  },
  {
    path: 'users',
    canActivate: [authGuard, adminGuard],
    loadComponent: () => import('./users/users.page').then( m => m.UsersPage)
  },
  {
    path: 'food-search',
    canActivate: [authGuard],
    loadComponent: () => import('./food-search/food-search.page').then( m => m.FoodSearchPage)
  },
  {
    path: 'welcome',
    canActivate: [guestGuard],
    loadComponent: () => import('./landing/landing.page').then((m) => m.LandingPage),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./register/register.page').then((m) => m.RegisterPage),
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./login/login.page').then( m => m.LoginPage)
  },
];
