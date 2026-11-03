import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

describe('authInterceptor', () => {
  let client: HttpClient;
  let http: HttpTestingController;
  let auth: AuthService;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('sayc_token', 'jwt');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => http.verify());

  it('adds the token to backend requests', () => {
    client.get('/api/v1/users').subscribe();
    const req = http.expectOne('/api/v1/users');
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt');
    req.flush([]);
  });

  it('never sends the token to Open Food Facts', () => {
    client.get('/api/cgi/search.pl').subscribe();
    const req = http.expectOne('/api/cgi/search.pl');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('ends the session and goes to login on a 401', () => {
    client.get('/api/v1/users').subscribe({ error: () => undefined });
    http.expectOne('/api/v1/users').flush(null, { status: 401, statusText: 'x' });
    expect(auth.token()).toBeNull();
    expect(localStorage.getItem('sayc_token')).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/login', { replaceUrl: true });
  });

  it('keeps the session on a failed login attempt and on a 403', () => {
    client.post('/api/v1/auth/login', {}).subscribe({ error: () => undefined });
    http.expectOne('/api/v1/auth/login').flush(null, { status: 401, statusText: 'x' });
    client.get('/api/v1/users').subscribe({ error: () => undefined });
    http.expectOne('/api/v1/users').flush(null, { status: 403, statusText: 'x' });
    expect(auth.token()).toBe('jwt');
    expect(navigate).not.toHaveBeenCalled();
  });
});
