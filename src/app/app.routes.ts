import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './auth/auth.guard';

// Every page requires a session except login. New pages should use authGuard too;
// app.routes.spec.ts fails if one doesn't.
export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
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
    canActivate: [authGuard],
    loadComponent: () => import('./users/users.page').then( m => m.UsersPage)
  },
  {
    path: 'food-search',
    canActivate: [authGuard],
    loadComponent: () => import('./food-search/food-search.page').then( m => m.FoodSearchPage)
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./login/login.page').then( m => m.LoginPage)
  },
];
