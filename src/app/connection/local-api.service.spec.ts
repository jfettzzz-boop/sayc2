import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { authInterceptor } from '../auth/auth.interceptor';
import { AuthService } from '../auth/auth.service';
import { connectionInterceptor } from './connection.interceptor';
import { ConnectionService } from './connection.service';
import { DatabaseStorage, LOCAL_DB_CONFIG, LocalDbService } from './local-db.service';

// These run real SQLite through the same interceptors the app uses, and cover the same
// behaviors as server/test/api.test.js, so the two ways of storing data can't drift apart.

const fs = (globalThis as any).process.getBuiltinModule('fs');
const path = (globalThis as any).process.getBuiltinModule('path');
const wasm = fs.readFileSync(path.join((globalThis as any).process.cwd(), 'node_modules/sql.js/dist/sql-wasm-browser.wasm'));
const wasmBinary = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);

const COCA = 'e5f6a7b8-c9d0-1234-efab-345678901234';
const SABRITAS = 'f6a7b8c9-d0e1-2345-fabc-456789012345';
const LECHE = 'a7b8c9d0-e1f2-3456-abcd-567890123456';
const PAN = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d01';
const HUEVO = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d02';
const EMPLOYEE_ROLE = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const DON_PEPE = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ESPERANZA = '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
const ESPERANZA_COCA = 'c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e01';

class MemoryStorage implements DatabaseStorage {
  saved: Uint8Array | null = null;
  saves = 0;
  async load() { return this.saved; }
  async save(data: Uint8Array) { this.saved = data; this.saves++; }
}

function setup(storage: DatabaseStorage = new MemoryStorage()) {
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([authInterceptor, connectionInterceptor])),
      { provide: LOCAL_DB_CONFIG, useValue: { storage, wasmBinary } },
    ],
  });
  TestBed.inject(ConnectionService).save('local', '');
  return TestBed.inject(HttpClient);
}

describe('Local API', () => {
  let http: HttpClient;
  let auth: AuthService;

  /** Answers with { status, body }, whether it succeeded or not. */
  async function call(method: string, url: string, body?: unknown) {
    try {
      const res = await firstValueFrom(http.request(method, `/api/v1${url}`, { body, observe: 'response' }));
      return { status: res.status, body: res.body as any };
    } catch (err: any) {
      return { status: err.status, body: err.error, code: err.error?.error?.code };
    }
  }
  const login = async (email: string, password = 'admin123') => {
    auth.clearSession();
    return firstValueFrom(auth.login(email, password));
  };
  const asAdmin = () => login('admin@sayc.com');
  const asEmployee = () => login('empleado@sayc.com');
  const stockOf = async (id: string) => (await call('GET', `/products/${id}`)).body.product_current_stock;

  beforeEach(() => {
    http = setup();
    auth = TestBed.inject(AuthService);
  });

  it('reports health without a session', async () => {
    expect((await call('GET', '/health')).body).toEqual({ status: 'ok' });
  });

  describe('sessions', () => {
    it('logs in with a token the app accepts, and no password hash', async () => {
      const { token, user } = await asAdmin();
      expect(auth.isAuthenticated()).toBe(true);
      expect(token.split('.').length).toBe(3);
      expect(user.role_name).toBe('Administrador');
      expect((user as any).user_pass_hash).toBeUndefined();
    });

    it('rejects a wrong password and an unknown email alike', async () => {
      const wrong = await call('POST', '/auth/login', { email: 'admin@sayc.com', password: 'nope' });
      const unknown = await call('POST', '/auth/login', { email: 'x@sayc.com', password: 'nope' });
      expect(wrong.status).toBe(401);
      expect(wrong.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(unknown.body).toEqual(wrong.body);
    });

    it('requires a session everywhere else', async () => {
      for (const path of ['/products', '/sales', '/users', '/dashboard', '/inventory/adjustments', '/auth/me']) {
        expect((await call('GET', path)).status).toBe(401);
      }
    });

    it('rejects an expired token', async () => {
      await asAdmin();
      const expired = btoa(JSON.stringify({ sub: 'x', exp: 1000 })).replace(/=+$/, '');
      auth.token.set(`local.${expired}.local`);
      expect((await call('GET', '/products')).status).toBe(401);
    });

    it('changes a password', async () => {
      await asEmployee();
      expect((await call('POST', '/auth/change-password', { current_password: 'admin123', new_password: 'short' })).status).toBe(400);
      expect((await call('POST', '/auth/change-password', { current_password: 'wrong', new_password: 'password2' })).status).toBe(401);
      // A 401 ends the session in the interceptor, the same as with a server.
      await asEmployee();
      expect((await call('POST', '/auth/change-password', { current_password: 'admin123', new_password: 'password2' })).status).toBe(204);
      await login('empleado@sayc.com', 'password2');
      expect(auth.isAuthenticated()).toBe(true);
    });
  });

  describe('permissions', () => {
    it('keeps employees out of administration, and in inventory', async () => {
      await asEmployee();
      expect((await call('GET', '/users')).status).toBe(403);
      expect((await call('GET', '/roles')).status).toBe(403);
      expect((await call('GET', '/dashboard')).status).toBe(403);
      expect((await call('PATCH', `/products/${LECHE}`, { product_sell_price: 29 })).status).toBe(200);
    });
  });

  describe('users', () => {
    it('creates, rejects duplicates, and locks out on deactivation', async () => {
      await asAdmin();
      const data = { user_name: 'Nuevo', user_email: 'Nuevo@Sayc.com', password: 'password1', role_id: EMPLOYEE_ROLE };
      const created = await call('POST', '/users', data);
      expect(created.status).toBe(201);
      expect(created.body.user_email).toBe('nuevo@sayc.com');
      expect(created.body.user_pass_hash).toBeUndefined();

      const duplicate = await call('POST', '/users', data);
      expect(duplicate.status).toBe(409);
      expect(duplicate.code).toBe('AUTH_EMAIL_ALREADY_REGISTERED');

      expect((await call('DELETE', `/users/${created.body.id}`)).status).toBe(204);
      expect((await call('POST', '/auth/login', { email: 'nuevo@sayc.com', password: 'password1' })).status).toBe(401);
      const list = (await call('GET', '/users')).body;
      expect(list.find((u: any) => u.id === created.body.id).user_state).toBe('inactivo');
      expect(list.every((u: any) => u.user_pass_hash === undefined)).toBe(true);

      expect((await call('PATCH', `/users/${created.body.id}`, { user_state: 'activo' })).body.user_state).toBe('activo');
    });

    it('rejects an unknown role', async () => {
      await asAdmin();
      const res = await call('POST', '/users', { user_name: 'X', user_email: 'x@sayc.com', password: 'password1', role_id: 'missing' });
      expect(res.status).toBe(400);
      expect(res.code).toBe('INVALID_REFERENCE');
    });

    it('stops an administrator locking themselves out', async () => {
      const { user } = await asAdmin();
      expect((await call('DELETE', `/users/${user.id}`)).status).toBe(409);
      expect((await call('PATCH', `/users/${user.id}`, { user_state: 'inactivo' })).status).toBe(409);
      expect((await call('PATCH', `/users/${user.id}`, { user_name: 'Otro' })).body.user_name).toBe('Otro');
    });
  });

  describe('products', () => {
    beforeEach(() => asEmployee());

    it('returns numeric prices and boolean flags', async () => {
      const { body } = await call('GET', `/products/${COCA}`);
      expect(body.product_sell_price).toBe(18);
      expect(body.product_api_origin).toBe(false);
    });

    it('searches any case by name, brand or barcode, treating wildcards literally', async () => {
      const names = async (q: string) => (await call('GET', `/products?q=${encodeURIComponent(q)}`)).body.map((p: any) => p.id);
      expect(await names('SABRITAS')).toEqual([SABRITAS]);
      expect(await names('lala')).toEqual([LECHE]);
      expect(await names('7501001')).toEqual([COCA]);
      expect(await names('%')).toEqual([]);
      expect(await names('_')).toEqual([]);
    });

    it('filters low stock and finds by barcode', async () => {
      const low = (await call('GET', '/products?low_stock=true')).body.map((p: any) => p.id);
      expect(low).toEqual([HUEVO, LECHE]);
      expect((await call('GET', '/products/barcode/7501001112223')).body.id).toBe(COCA);
      expect((await call('GET', '/products/barcode/000')).status).toBe(404);
    });

    it('sorts by name or stock, in either direction', async () => {
      const list = async (query: string) => (await call('GET', `/products?${query}`)).body.map((p: any) => p.id);
      expect(await list('sort=name&order=asc')).toEqual([COCA, HUEVO, LECHE, PAN, SABRITAS]);
      expect(await list('sort=name&order=desc')).toEqual([SABRITAS, PAN, LECHE, HUEVO, COCA]);
      expect(await list('sort=stock&order=asc')).toEqual([LECHE, HUEVO, PAN, SABRITAS, COCA]);
      expect(await list('sort=stock&order=desc')).toEqual([COCA, SABRITAS, PAN, HUEVO, LECHE]);
      expect((await call('GET', '/products?sort=id')).status).toBe(400);
      expect((await call('GET', '/products?order=sideways')).status).toBe(400);
    });

    it('pages', async () => {
      const first = (await call('GET', '/products?limit=2&offset=0')).body;
      const last = (await call('GET', '/products?limit=2&offset=4')).body;
      expect(first.length).toBe(2);
      expect(last.length).toBe(1);
      expect((await call('GET', '/products?limit=999')).status).toBe(400);
    });

    it('creates with database defaults, and refuses a duplicate barcode', async () => {
      const body = { product_barcode: '301', product_name: 'Nutella', product_sell_price: 95.5, product_api_origin: true };
      const created = await call('POST', '/products', body);
      expect(created.status).toBe(201);
      expect(created.body.product_api_origin).toBe(true);
      expect(created.body.product_min_stock).toBe(5);
      expect(created.body.product_current_stock).toBe(0);
      const again = await call('POST', '/products', body);
      expect(again.status).toBe(409);
      expect(again.code).toBe('BARCODE_ALREADY_REGISTERED');
    });

    it('treats blank optional fields as a server does, since forms send them as undefined', async () => {
      const created = await call('POST', '/products', {
        product_name: 'Sin datos',
        product_sell_price: 12.5,
        product_barcode: undefined,
        product_brand: undefined,
        product_current_stock: 7,
      });
      expect(created.status).toBe(201);
      expect(created.body.product_barcode).toBeNull();
      expect(created.body.product_current_stock).toBe(7);
    });

    it('validates input', async () => {
      for (const body of [
        { product_name: 'x' },
        { product_name: ' ', product_sell_price: 1 },
        { product_name: 'x', product_sell_price: -1 },
        { product_name: 'x', product_sell_price: 1.234 },
        { product_name: 'x', product_sell_price: '1' },
        { product_name: 'x', product_sell_price: 1, product_img_url: 'javascript:alert(1)' },
        { product_name: 'x', product_sell_price: 1, id: 'chosen' },
      ]) {
        const res = await call('POST', '/products', body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(res.code).toBe('VALIDATION_ERROR');
      }
    });

    it('edits, clears optional text, and never edits stock directly', async () => {
      const edited = await call('PATCH', `/products/${LECHE}`, { product_sell_price: 29, product_brand: null });
      expect(edited.body.product_sell_price).toBe(29);
      expect(edited.body.product_brand).toBeNull();
      expect((await call('PATCH', `/products/${LECHE}`, { product_current_stock: 9 })).status).toBe(400);
      expect((await call('PATCH', `/products/${LECHE}`, {})).status).toBe(400);
      expect((await call('PATCH', '/products/missing', { product_sell_price: 1 })).status).toBe(404);
    });

    it('deletes only a product with no history', async () => {
      const temporary = await call('POST', '/products', { product_name: 'Temporal', product_sell_price: 1 });
      expect((await call('DELETE', `/products/${temporary.body.id}`)).status).toBe(204);
      expect((await call('GET', `/products/${temporary.body.id}`)).status).toBe(404);

      const inUse = await call('DELETE', `/products/${COCA}`);
      expect(inUse.status).toBe(409);
      expect(inUse.code).toBe('RESOURCE_IN_USE');
      expect((await call('GET', `/products/${COCA}`)).status).toBe(200);
    });
  });

  describe('sales', () => {
    beforeEach(() => asEmployee());

    it('uses database prices, merges lines and reduces stock', async () => {
      const res = await call('POST', '/sales', {
        items: [{ product_id: COCA, quantity: 1 }, { product_id: SABRITAS, quantity: 1 }, { product_id: COCA, quantity: 1 }],
        received_pay: 100,
      });
      expect(res.status).toBe(201);
      expect(res.body.sales_total).toBe(53.5);
      expect(res.body.sales_change).toBe(46.5);
      expect(res.body.items.length).toBe(2);
      expect(res.body.items.find((i: any) => i.product_id === COCA).detail_subtotal).toBe(36);
      expect(await stockOf(COCA)).toBe(23);
      expect(await stockOf(SABRITAS)).toBe(14);
    });

    it('rejects a price from the request', async () => {
      const res = await call('POST', '/sales', { items: [{ product_id: COCA, quantity: 1, detail_unit_price: 0.01 }], received_pay: 1 });
      expect(res.status).toBe(400);
    });

    it('changes nothing when stock, payment or product checks fail', async () => {
      const salesBefore = (await call('GET', '/sales')).body.length;

      const noStock = await call('POST', '/sales', { items: [{ product_id: COCA, quantity: 1 }, { product_id: LECHE, quantity: 1 }], received_pay: 1000 });
      expect(noStock.status).toBe(409);
      expect(noStock.code).toBe('INSUFFICIENT_STOCK');
      expect(noStock.body.error.details.products[0].available).toBe(0);

      const noPay = await call('POST', '/sales', { items: [{ product_id: COCA, quantity: 1 }], received_pay: 17.99 });
      expect(noPay.status).toBe(422);
      expect(noPay.code).toBe('INSUFFICIENT_PAYMENT');

      const noProduct = await call('POST', '/sales', { items: [{ product_id: 'missing', quantity: 1 }], received_pay: 100 });
      expect(noProduct.status).toBe(404);
      expect(noProduct.code).toBe('PRODUCT_NOT_FOUND');

      expect(await stockOf(COCA)).toBe(25);
      expect((await call('GET', '/sales')).body.length).toBe(salesBefore);
    });

    it('cannot oversell when sales arrive together', async () => {
      await call('POST', '/inventory/adjustments', { product_id: SABRITAS, adj_type: 'test', adj_new_amount: 3 });
      const results = await Promise.all(Array.from({ length: 8 }, () =>
        call('POST', '/sales', { items: [{ product_id: SABRITAS, quantity: 1 }], received_pay: 20 })));
      expect(results.filter((r) => r.status === 201).length).toBe(3);
      expect(results.filter((r) => r.status === 409).length).toBe(5);
      expect(await stockOf(SABRITAS)).toBe(0);
    });

    it('limits employees to their own sales', async () => {
      await asAdmin();
      const sale = (await call('POST', '/sales', { items: [{ product_id: COCA, quantity: 1 }], received_pay: 18 })).body;
      expect(sale.sales_change).toBe(0);
      expect((await call('GET', `/sales/${sale.id}`)).status).toBe(200);
      expect((await call('GET', '/sales')).body.some((s: any) => s.id === sale.id)).toBe(true);

      await asEmployee();
      expect((await call('GET', `/sales/${sale.id}`)).status).toBe(404);
      const mine = (await call('GET', '/sales')).body;
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.some((s: any) => s.id === sale.id)).toBe(false);
    });
  });

  describe('inventory', () => {
    beforeEach(() => asEmployee());
    const adjust = (body: object) => call('POST', '/inventory/adjustments', { product_id: COCA, adj_type: 'entrada', ...body });

    it('sets an exact amount, and records both amounts and who did it', async () => {
      const res = await adjust({ adj_new_amount: 40, adj_motive: ' Compra ' });
      expect(res.status).toBe(201);
      expect(res.body.adj_previous_amount).toBe(25);
      expect(res.body.adj_new_amount).toBe(40);
      expect(res.body.adj_motive).toBe('Compra');
      expect(res.body.user_name).toBe('Empleado 1');
      expect(await stockOf(COCA)).toBe(40);

      const list = (await call('GET', `/inventory/adjustments?product_id=${COCA}`)).body;
      expect(list.map((a: any) => a.id)).toContain(res.body.id);
      expect((await call('GET', `/inventory/adjustments?product_id=${LECHE}`)).body).toEqual([]);
    });

    it('adds and subtracts relative to the current stock', async () => {
      expect((await adjust({ adj_quantity: 7 })).body.adj_new_amount).toBe(32);
      expect((await adjust({ adj_quantity: -12 })).body.adj_new_amount).toBe(20);
      const together = await Promise.all(Array.from({ length: 8 }, () => adjust({ adj_quantity: 1 })));
      expect(together.every((r) => r.status === 201)).toBe(true);
      expect(await stockOf(COCA)).toBe(28);
    });

    it('allows reaching 0 but no further', async () => {
      const tooMany = await adjust({ adj_quantity: -26 });
      expect(tooMany.status).toBe(409);
      expect(tooMany.code).toBe('STOCK_WOULD_BE_NEGATIVE');
      expect(tooMany.body.error.details.available).toBe(25);
      expect(await stockOf(COCA)).toBe(25);
      expect((await adjust({ adj_quantity: -25 })).status).toBe(201);
      expect(await stockOf(COCA)).toBe(0);
    });

    it('rejects bad requests', async () => {
      for (const body of [{}, { adj_quantity: 0 }, { adj_quantity: 1.5 }, { adj_quantity: '5' }, { adj_quantity: 1, adj_new_amount: 1 }, { adj_new_amount: -1 }]) {
        expect((await adjust(body)).status, JSON.stringify(body)).toBe(400);
      }
      expect((await adjust({ product_id: 'missing', adj_quantity: 1 })).status).toBe(404);
    });
  });

  describe('dashboard', () => {
    it('adds up what is in the tables', async () => {
      await asAdmin();
      await call('POST', '/sales', { items: [{ product_id: COCA, quantity: 2 }], received_pay: 36 });
      await call('POST', '/inventory/adjustments', { product_id: SABRITAS, adj_type: 'merma', adj_quantity: -13 });
      const { status, body } = await call('GET', '/dashboard');

      expect(status).toBe(200);
      expect(body.users).toEqual({ total: 2, active: 2 });
      expect(body.products.total).toBe(5);
      expect(body.products.low_stock).toBe(3);
      expect(body.products.out_of_stock).toBe(1);
      expect(body.products.inventory_cost).toBe(23 * 12 + 2 * 10 + 8 * 41 + 2 * 36);
      expect(body.sales.today).toEqual({ count: 2, total: 89.5 });
      expect(body.sales.last_30_days).toEqual({ count: 2, total: 89.5 });
      expect(body.low_stock_products.map((p: any) => p.id)).toEqual([LECHE, HUEVO, SABRITAS]);
      expect(body.recent_sales.length).toBe(2);
      expect(body.recent_sales[0].user_name).toBeTruthy();
      expect(body.top_products[0]).toEqual({ id: COCA, product_name: 'Coca Cola 600ml', quantity: 4, revenue: 72 });
      expect(body.recent_adjustments[0].adj_type).toBe('merma');
    });
  });

  describe('organizations', () => {
    const registration = () => ({
      organization: { org_name: ' Tienda Nueva ', org_email: 'tienda@example.com', org_phone: '' },
      user: { user_name: 'Dueña', user_email: 'Duena@Example.com', password: 'password1' },
    });

    it('registers a company with its administrator, signed in and starting empty', async () => {
      auth.clearSession();
      const res = await call('POST', '/auth/register', registration());
      expect(res.status).toBe(201);
      expect(res.body.user.role_name).toBe('Administrador');
      expect(res.body.user.org_name).toBe('Tienda Nueva');
      expect(res.body.user.user_pass_hash).toBeUndefined();

      await login('duena@example.com', 'password1');
      expect((await call('GET', '/organization')).body.org_phone).toBeNull();
      expect((await call('GET', '/products')).body).toEqual([]);
      expect((await call('GET', '/users')).body.length).toBe(1);
      const log = (await call('GET', '/organization/audit-log')).body;
      expect(log.map((e: any) => e.audit_table).sort()).toEqual(['organizations', 'users']);
      expect(JSON.stringify(log)).not.toContain('$2');
    });

    it('rejects a taken email, leaving no organization behind, and bad input', async () => {
      const body = registration();
      body.user.user_email = 'admin@sayc.com';
      const taken = await call('POST', '/auth/register', body);
      expect(taken.status).toBe(409);
      expect(taken.code).toBe('AUTH_EMAIL_ALREADY_REGISTERED');
      const db = TestBed.inject(LocalDbService);
      expect((await db.query('SELECT COUNT(*) AS n FROM organizations'))[0]['n']).toBe(2);

      const changes = [
        (b: any) => { b.user.password = 'short'; },
        (b: any) => { b.organization.org_name = ' '; },
        (b: any) => { b.user.role_id = EMPLOYEE_ROLE; },
        (b: any) => { b.organization.id = DON_PEPE; },
      ];
      for (const change of changes) {
        const bad: any = registration();
        change(bad);
        expect((await call('POST', '/auth/register', bad)).status).toBe(400);
      }
    });

    it('keeps the records of each company to itself', async () => {
      await login('admin@laesperanza.mx');
      const theirs = (await call('GET', '/products')).body;
      expect(theirs.every((p: any) => p.organization_id === ESPERANZA)).toBe(true);
      expect((await call('GET', '/products/barcode/7501001112223')).body.id).toBe(ESPERANZA_COCA);
      expect((await call('GET', `/products/${COCA}`)).status).toBe(404);
      expect((await call('PATCH', `/products/${COCA}`, { product_sell_price: 1 })).status).toBe(404);
      expect((await call('POST', '/sales', { items: [{ product_id: COCA, quantity: 1 }], received_pay: 100 })).status).toBe(404);
      expect((await call('POST', '/inventory/adjustments', { product_id: COCA, adj_type: 'x', adj_quantity: 1 })).status).toBe(404);
      expect((await call('GET', '/users')).body.every((u: any) => u.organization_id === ESPERANZA)).toBe(true);
      expect((await call('GET', '/dashboard')).body.products.total).toBe(3);

      const created = await call('POST', '/products', { product_barcode: '7501003334445', product_name: 'Sabritas', product_sell_price: 18 });
      expect(created.status).toBe(201);
      expect(created.body.organization_id).toBe(ESPERANZA);
    });

    it('locks out a deactivated organization', async () => {
      await asEmployee();
      await TestBed.inject(LocalDbService).run(`UPDATE organizations SET org_state = 'inactivo' WHERE id = ?`, [DON_PEPE]);
      expect((await call('GET', '/auth/me')).status).toBe(401);
      expect((await call('POST', '/auth/login', { email: 'admin@sayc.com', password: 'admin123' })).status).toBe(401);
    });

    it('lets only an administrator edit it, logging what changed', async () => {
      await asEmployee();
      expect((await call('PATCH', '/organization', { org_phone: '1' })).status).toBe(403);
      await asAdmin();
      expect((await call('PATCH', '/organization', { org_phone: '5550000000' })).body.org_phone).toBe('5550000000');
      const [entry] = (await call('GET', '/organization/audit-log?table=organizations&action=UPDATE')).body;
      expect(entry.audit_old).toEqual({ org_phone: '5551234567' });
      expect(entry.audit_new).toEqual({ org_phone: '5550000000' });
      expect((await call('GET', '/organization/audit-log?table=roles')).status).toBe(400);
    });
  });

  describe('history', () => {
    beforeEach(() => asAdmin());

    it('records opening and changed prices, and nothing for other edits', async () => {
      const created = (await call('POST', '/products', { product_name: 'Historial', product_sell_price: 10, product_costs: 6 })).body;
      await call('PATCH', `/products/${created.id}`, { product_sell_price: 12 });
      await call('PATCH', `/products/${created.id}`, { product_name: 'Historial 2' });
      const history = (await call('GET', `/products/${created.id}/price-history`)).body;
      expect(history.map((h: any) => [h.price_previous, h.price_new])).toEqual([[10, 12], [null, 10]]);
      expect(history[0].cost_previous).toBe(6);
      expect(history[0].user_name).toBe('Administrador 1');
      expect((await call('GET', `/products/${COCA}/price-history`)).body.length).toBe(2);
    });

    it('logs inserts, updates with only what changed, deletes, sales and stock changes', async () => {
      const created = (await call('POST', '/products', { product_name: 'Registro', product_sell_price: 5 })).body;
      await call('PATCH', `/products/${created.id}`, { product_name: 'Registro 2', product_sell_price: 5, product_api_origin: false });
      await call('DELETE', `/products/${created.id}`);
      const entries = (await call('GET', `/organization/audit-log?record_id=${created.id}`)).body;
      expect(entries.map((e: any) => e.audit_action)).toEqual(['DELETE', 'UPDATE', 'INSERT']);
      expect(entries[1].audit_old).toEqual({ product_name: 'Registro' });
      expect(entries[1].audit_new).toEqual({ product_name: 'Registro 2' });
      expect(entries[0].audit_new).toBeNull();

      const sale = (await call('POST', '/sales', { items: [{ product_id: COCA, quantity: 1 }], received_pay: 20 })).body;
      const [saleEntry] = (await call('GET', `/organization/audit-log?record_id=${sale.id}`)).body;
      expect(saleEntry.audit_new.sales_total).toBe(18);

      await call('POST', '/inventory/adjustments', { product_id: LECHE, adj_type: 'entrada', adj_quantity: 4 });
      const [stock] = (await call('GET', `/organization/audit-log?record_id=${LECHE}`)).body;
      expect(stock.audit_old).toEqual({ product_current_stock: 0 });
      expect(stock.audit_new.product_current_stock).toBe(4);
    });

    it('rolls the log back with a change that fails', async () => {
      const before = (await call('GET', '/organization/audit-log?limit=200')).body.length;
      const duplicate = await call('POST', '/products', { product_barcode: '7501001112223', product_name: 'x', product_sell_price: 1 });
      expect(duplicate.status).toBe(409);
      expect((await call('GET', '/organization/audit-log?limit=200')).body.length).toBe(before);
    });
  });

  it('answers an unknown route with a 404', async () => {
    await asAdmin();
    expect((await call('GET', '/nothing')).status).toBe(404);
  });
});

describe('Local database', () => {
  it('replaces a database saved before organizations existed', async () => {
    const storage = new MemoryStorage();
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs({ wasmBinary });
    const old = new SQL.Database();
    old.run('CREATE TABLE products (id TEXT PRIMARY KEY); PRAGMA user_version = 1');
    storage.saved = old.export();

    setup(storage);
    const db = TestBed.inject(LocalDbService);
    expect((await db.query('SELECT COUNT(*) AS n FROM organizations'))[0]['n']).toBe(2);
    expect((await db.query('PRAGMA user_version'))[0]['user_version']).toBe(2);
  });

  it('keeps data across restarts of the app', async () => {
    const storage = new MemoryStorage();
    setup(storage);
    await firstValueFrom(TestBed.inject(AuthService).login('admin@sayc.com', 'admin123'));
    const http = TestBed.inject(HttpClient);
    await firstValueFrom(http.post('/api/v1/inventory/adjustments', { product_id: COCA, adj_type: 'entrada', adj_new_amount: 99 }));
    expect(storage.saved).not.toBeNull();

    // A new app instance, opening the saved file.
    const reopened = setup(storage);
    await firstValueFrom(TestBed.inject(AuthService).login('admin@sayc.com', 'admin123'));
    const product: any = await firstValueFrom(reopened.get(`/api/v1/products/${COCA}`));
    expect(product.product_current_stock).toBe(99);
  });

  it('does not save a change that failed, and still enforces references after saving', async () => {
    const storage = new MemoryStorage();
    setup(storage);
    const db = TestBed.inject(LocalDbService);
    await db.ready();
    const savesBefore = storage.saves;

    await expect(db.transaction((tx) => {
      tx.run(`UPDATE products SET product_current_stock = 1 WHERE id = ?`, [COCA]);
      throw new Error('stop');
    })).rejects.toThrow('stop');
    expect(storage.saves).toBe(savesBefore);
    expect((await db.query('SELECT product_current_stock AS s FROM products WHERE id = ?', [COCA]))[0]['s']).toBe(25);

    // Exporting the file resets SQLite's settings, which must not switch off these checks.
    await db.run('UPDATE products SET product_min_stock = 1 WHERE id = ?', [COCA]);
    await expect(db.run('DELETE FROM products WHERE id = ?', [COCA])).rejects.toThrow('FOREIGN KEY');
  });
});

describe('Connection routing', () => {
  it('does not load the local database for a server connection', async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor, connectionInterceptor]))],
    });
    const ready = vi.spyOn(TestBed.inject(LocalDbService), 'ready');
    expect(TestBed.inject(ConnectionService).mode()).toBe('server');
    expect(ready).not.toHaveBeenCalled();
  });
});
