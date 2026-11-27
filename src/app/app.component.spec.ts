import { TestBed } from '@angular/core/testing';

import { AlertController, MenuController, NavController } from '@ionic/angular';

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
    const urls = () => app.appPages().map((p: { url: string }) => p.url);

    expect(urls()).toEqual(['/home', '/charge', '/inventory', '/food-search']);

    TestBed.inject(AuthService).currentUser.set(EMPLOYEE as any);
    expect(urls()).not.toContain('/users');

    TestBed.inject(AuthService).currentUser.set(ADMIN as any);
    expect(urls()).toEqual(['/home', '/charge', '/inventory', '/users', '/food-search']);
  });

  describe('menu button', () => {
    const setup = (paneVisible: boolean) => {
      const fixture = TestBed.createComponent(AppComponent);
      const app = fixture.componentInstance as any;
      app.isPaneVisible.set(paneVisible);
      const close = vi.spyOn(TestBed.inject(MenuController), 'close').mockResolvedValue(true);
      return { app, close };
    };

    it('narrows and restores a menu beside the page', () => {
      const { app, close } = setup(true);
      app.toggleCollapse();
      expect(app.isNarrow).toBe(true);
      app.toggleCollapse();
      expect(app.isNarrow).toBe(false);
      expect(close).not.toHaveBeenCalled();
    });

    it('closes a menu opened over the page, without narrowing it', () => {
      const { app, close } = setup(false);
      app.toggleCollapse();
      expect(close).toHaveBeenCalledOnce();
      expect(app.isNarrow).toBe(false);
    });

    it('does not carry a narrow menu over to a small screen', () => {
      const { app } = setup(true);
      app.toggleCollapse();
      app.isPaneVisible.set(false);
      expect(app.isNarrow).toBe(false);
      app.isPaneVisible.set(true);
      expect(app.isNarrow).toBe(true);
    });
  });

  describe('logging out', () => {
    function setup() {
      const fixture = TestBed.createComponent(AppComponent);
      const auth = TestBed.inject(AuthService);
      const clearSession = vi.spyOn(auth, 'clearSession');
      const navigateRoot = vi.spyOn(TestBed.inject(NavController), 'navigateRoot').mockResolvedValue(true);
      const present = vi.fn().mockResolvedValue(undefined);
      const create = vi.spyOn(TestBed.inject(AlertController), 'create').mockResolvedValue({ present } as any);
      return { app: fixture.componentInstance as any, clearSession, navigateRoot, present, create };
    }

    it('asks first, and keeps the session until confirmed', async () => {
      const { app, clearSession, navigateRoot, present } = setup();
      await app.confirmLogout();
      expect(present).toHaveBeenCalledOnce();
      expect(clearSession).not.toHaveBeenCalled();
      expect(navigateRoot).not.toHaveBeenCalled();
    });

    it('cancelling changes nothing, and only the confirm button logs out', async () => {
      const { app, clearSession, navigateRoot, create } = setup();
      await app.confirmLogout();
      const [cancel, confirm] = create.mock.calls[0][0]!.buttons as any[];

      expect(cancel.role).toBe('cancel');
      expect(cancel.handler).toBeUndefined();

      confirm.handler();
      expect(clearSession).toHaveBeenCalledOnce();
      expect(navigateRoot).toHaveBeenCalledWith('/login');
    });
  });
});
