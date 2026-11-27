import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { authInterceptor } from '../auth/auth.interceptor';
import { connectionInterceptor } from './connection.interceptor';
import { ConnectionService, builtInServerUrl, isValidServerUrl, normalizeServerUrl } from './connection.service';

describe('server addresses', () => {
  it.each([
    ['https://x.com', 'https://x.com'],
    ['https://x.com/', 'https://x.com'],
    ['  https://x.com/api/v1/  ', 'https://x.com'],
    ['http://10.0.2.2:3000/API/V1', 'http://10.0.2.2:3000'],
    ['https://x.com/base/', 'https://x.com/base'],
  ])('tidies %s', (input, expected) => {
    expect(normalizeServerUrl(input)).toBe(expected);
  });

  it.each(['https://x.com', 'http://192.168.1.5:3000', 'https://x.com/base'])('accepts %s', (url) => {
    expect(isValidServerUrl(url)).toBe(true);
  });

  it.each(['', 'x.com', 'ftp://x.com', 'https://', 'https://a b.com', 'javascript:alert(1)'])('refuses %s', (url) => {
    expect(isValidServerUrl(url)).toBe(false);
  });
});

describe('connection routing', () => {
  let client: HttpClient;
  let http: HttpTestingController;
  let connection: ConnectionService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor, connectionInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
    connection = TestBed.inject(ConnectionService);
  });

  afterEach(() => http.verify());

  it('a browser with no setting uses the server it came from', () => {
    expect(connection.mode()).toBe('server');
    client.get('/api/v1/health').subscribe();
    http.expectOne('/api/v1/health').flush({});
  });

  describe('a build made for a separate API', () => {
    afterEach(() => vi.unstubAllGlobals());

    const fresh = () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          provideHttpClient(withInterceptors([authInterceptor, connectionInterceptor])),
          provideHttpClientTesting(),
        ],
      });
      return TestBed.inject(ConnectionService);
    };

    it('sends requests to the address it was built with', () => {
      vi.stubGlobal('SAYC_API_URL', 'https://sayc-api.onrender.com/');
      expect(builtInServerUrl()).toBe('https://sayc-api.onrender.com');
      expect(fresh().serverUrl()).toBe('https://sayc-api.onrender.com');
      TestBed.inject(HttpClient).get('/api/v1/health').subscribe();
      TestBed.inject(HttpTestingController).expectOne('https://sayc-api.onrender.com/api/v1/health').flush({});
    });

    it('still lets a saved address, but not a blank one, take its place', () => {
      vi.stubGlobal('SAYC_API_URL', 'https://sayc-api.onrender.com');
      localStorage.setItem('sayc_server_url', 'https://other.com');
      expect(fresh().serverUrl()).toBe('https://other.com');
      localStorage.setItem('sayc_server_url', '');
      expect(fresh().serverUrl()).toBe('https://sayc-api.onrender.com');
    });
  });

  it('goes to the configured address, with the session token', () => {
    localStorage.setItem('sayc_token', 'jwt');
    connection.save('server', 'https://x.com/api/v1/');
    expect(connection.serverUrl()).toBe('https://x.com');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor, connectionInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    TestBed.inject(HttpClient).get('/api/v1/products').subscribe();
    const req = TestBed.inject(HttpTestingController).expectOne('https://x.com/api/v1/products');
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt');
    req.flush([]);
  });

  it('leaves other addresses alone, and sends them no token', () => {
    localStorage.setItem('sayc_token', 'jwt');
    connection.save('server', 'https://x.com');
    client.get('https://world.openfoodfacts.org/x').subscribe();
    const req = http.expectOne('https://world.openfoodfacts.org/x');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('remembers the choice', () => {
    connection.save('local', 'https://x.com');
    expect(localStorage.getItem('sayc_connection_mode')).toBe('local');
    expect(localStorage.getItem('sayc_server_url')).toBe('https://x.com');
    expect(connection.isLocal()).toBe(true);
  });

  describe('testing a server', () => {
    const respond = (ok: boolean, body: unknown) =>
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok, json: async () => body } as Response);

    afterEach(() => vi.restoreAllMocks());

    it('passes on a healthy API, using the tidied address', async () => {
      const fetchSpy = respond(true, { status: 'ok' });
      expect(await connection.testServer('https://x.com/api/v1/')).toBe(true);
      expect(fetchSpy.mock.calls[0][0]).toBe('https://x.com/api/v1/health');
    });

    it('fails on an error, something else answering, or no answer', async () => {
      respond(false, {});
      expect(await connection.testServer('https://x.com')).toBe(false);
      vi.restoreAllMocks();
      respond(true, { hello: 'world' });
      expect(await connection.testServer('https://x.com')).toBe(false);
      vi.restoreAllMocks();
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed'));
      expect(await connection.testServer('https://x.com')).toBe(false);
    });
  });
});
