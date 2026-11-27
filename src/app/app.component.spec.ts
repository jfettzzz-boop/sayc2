import { TestBed } from '@angular/core/testing';

import { AppComponent } from './app.component';
import { AuthService } from './auth/auth.service';

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';

const ADMIN = {
  id: 'admin-id', user_name: 'Admin', user_email: 'admin@sayc.com', user_state: 'activo',
  role_id: 'role-admin', role_name: 'Administrador',
};
const EMPLOYEE = { ...ADMIN, id: 'emp-id', role_name: 'Empleado' };

describe('AppComponent', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({
          fallbackLang: 'es',
          loader: provideTranslateHttpLoader({
            prefix: './assets/i18n/',
            suffix: '.json'
          })
        })
      ]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('hides admin-only pages for employees and guests', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    const urls = () => app.visiblePages().map((p: { url: string }) => p.url);

    expect(urls()).not.toContain('/users');
    expect(urls()).toContain('/sales');
    expect(urls()).toContain('/products');

    TestBed.inject(AuthService).user.set(EMPLOYEE);
    expect(urls()).not.toContain('/users');

    TestBed.inject(AuthService).user.set(ADMIN);
    expect(urls()).toContain('/users');
  });
});
