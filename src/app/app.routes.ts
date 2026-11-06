import { Routes } from '@angular/router';

import { adminGuard, authGuard, guestGuard } from './auth/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: 'folder/:folder',
    loadComponent: () =>
      import('./folder/folder.page').then((m) => m.FolderPage),
  },
  {
    path: 'home',
    canActivate: [authGuard],
    loadComponent: () => import('./home/home.page').then( m => m.HomePage)
  },
  {
    path: 'products',
    canActivate: [authGuard],
    loadComponent: () => import('./products/products.page').then( m => m.ProductsPage)
  },
  {
    path: 'sales',
    canActivate: [authGuard],
    loadComponent: () => import('./sales/sales.page').then( m => m.SalesPage)
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
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./login/login.page').then( m => m.LoginPage)
  },
];
