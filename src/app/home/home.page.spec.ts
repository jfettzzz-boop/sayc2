import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { provideTranslateService } from '@ngx-translate/core';

import { AuthService, AuthUser } from '../auth/auth.service';
import { HomePage } from './home.page';

const user = (role_name: string) => ({ id: 'id', user_name: 'Ana', role_name }) as AuthUser;

describe('HomePage', () => {
  let fixture: ComponentFixture<HomePage>;
  let http: HttpTestingController;
  let auth: AuthService;

  const show = (selector: string) => fixture.nativeElement.querySelector(selector) !== null;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService(),
        provideIonicAngular(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    fixture = TestBed.createComponent(HomePage);
  });

  it('shows the dashboard to an administrator', () => {
    auth.currentUser.set(user('Administrador'));
    fixture.detectChanges();
    expect(show('app-admin-dashboard')).toBe(true);
    expect(show('app-employee-home')).toBe(false);
  });

  it('shows the employee home to an employee, without requesting dashboard data', () => {
    auth.currentUser.set(user('Empleado'));
    fixture.detectChanges();
    expect(show('app-employee-home')).toBe(true);
    expect(show('app-admin-dashboard')).toBe(false);
    http.expectNone('/api/v1/dashboard');
  });

  it('gives an unrecognized role the employee home, not administrator data', () => {
    auth.currentUser.set(user('Otro'));
    fixture.detectChanges();
    expect(show('app-employee-home')).toBe(true);
    expect(show('app-admin-dashboard')).toBe(false);
  });

  it('follows a role change when refreshed on entry', () => {
    auth.currentUser.set(user('Empleado'));
    fixture.componentInstance.ionViewWillEnter();
    http.expectOne('/api/v1/auth/me').flush(user('Administrador'));
    fixture.detectChanges();
    expect(show('app-admin-dashboard')).toBe(true);
  });

  it('offers a retry when the user could not be loaded', () => {
    fixture.componentInstance.ionViewWillEnter();
    http.expectOne('/api/v1/auth/me').error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-button')).not.toBeNull();

    (fixture.componentInstance as any).refresh();
    http.expectOne('/api/v1/auth/me').flush(user('Empleado'));
    fixture.detectChanges();
    expect(show('app-employee-home')).toBe(true);
  });
});
