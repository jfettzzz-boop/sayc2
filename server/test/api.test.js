// Integration tests. They run database/schema.sql, which DROPS sayc_db, so they only run
// when pointed at a disposable MySQL server through TEST_DB_PORT, and never on port 3306.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import mysql from 'mysql2/promise';

const port = Number(process.env.TEST_DB_PORT);
const skip = !port
  ? 'Set TEST_DB_PORT to the port of a disposable MySQL server'
  : port === 3306
    ? 'Refusing to reset a database on the default MySQL port'
    : false;

const COCA = 'e5f6a7b8-c9d0-1234-efab-345678901234'; // price 18.00, stock 25
const SABRITAS = 'f6a7b8c9-d0e1-2345-fabc-456789012345'; // price 17.50, stock 15
const LECHE = 'a7b8c9d0-e1f2-3456-abcd-567890123456'; // stock 0
const ROLE_EMPLOYEE = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const DON_PEPE = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ESPERANZA = '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
const ESPERANZA_COCA = 'c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e01';

describe('SAYC API', { skip }, () => {
  let server, base, pool, admin, employee, otherAdmin;

  async function call(method, path, { token, body } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  }

  const stockOf = async (id) => (await call('GET', `/products/${id}`, { token: admin })).body.product_current_stock;

  before(async () => {
    const connection = {
      host: process.env.TEST_DB_HOST ?? '127.0.0.1',
      port,
      user: process.env.TEST_DB_USER ?? 'root',
      password: process.env.TEST_DB_PASSWORD ?? '',
    };
    const schema = await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8');
    const setup = await mysql.createConnection({ ...connection, multipleStatements: true, charset: 'utf8mb4' });
    await setup.query(schema);
    await setup.end();

    Object.assign(process.env, {
      DB_HOST: connection.host,
      DB_PORT: String(port),
      DB_USER: connection.user,
      DB_PASSWORD: connection.password,
      DB_NAME: 'sayc_db',
      JWT_SECRET: 'test-secret-test-secret-test-secret-test',
    });

    const { createApp } = await import('../src/app.js');
    const { hashPlaintextPasswords } = await import('../src/passwords.js');
    ({ pool } = await import('../src/db.js'));

    assert.equal(await hashPlaintextPasswords(pool), 4);
    assert.equal(await hashPlaintextPasswords(pool), 0);

    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/v1`;

    const login = async (email) =>
      (await call('POST', '/auth/login', { body: { email, password: 'admin123' } })).body.token;
    admin = await login('admin@sayc.com');
    employee = await login('empleado@sayc.com');
    otherAdmin = await login('admin@laesperanza.mx');
  });

  const auditEntries = async (table, recordId) =>
    (await pool.query(
      'SELECT * FROM audit_log WHERE audit_table = ? AND audit_record_id = ? ORDER BY id',
      [table, recordId],
    ))[0];

  after(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await pool?.end();
  });

  it('reports health', async () => {
    assert.deepEqual((await call('GET', '/health')).body, { status: 'ok' });
  });

  describe('auth', () => {
    it('rejects a wrong password and an unknown email with the same error', async () => {
      const wrong = await call('POST', '/auth/login', { body: { email: 'admin@sayc.com', password: 'nope' } });
      const unknown = await call('POST', '/auth/login', { body: { email: 'x@sayc.com', password: 'nope' } });
      assert.equal(wrong.status, 401);
      assert.deepEqual(wrong.body, unknown.body);
      assert.equal(wrong.body.error.code, 'AUTH_INVALID_CREDENTIALS');
    });

    it('does not accept a plaintext value stored as the hash', async () => {
      await pool.query(
        `INSERT INTO users (id, organization_id, user_name, user_email, user_pass_hash, role_id)
         VALUES ('plain-user', ?, 'Plain', 'plain@sayc.com', 'plain-secret', ?)`,
        [DON_PEPE, ROLE_EMPLOYEE],
      );
      const res = await call('POST', '/auth/login', { body: { email: 'plain@sayc.com', password: 'plain-secret' } });
      assert.equal(res.status, 401);
      await pool.query(`DELETE FROM users WHERE id = 'plain-user'`);
    });

    it('requires a valid token', async () => {
      assert.equal((await call('GET', '/products')).status, 401);
      assert.equal((await call('GET', '/products', { token: 'garbage' })).status, 401);
    });

    it('returns the current user without the password hash', async () => {
      const { body } = await call('GET', '/auth/me', { token: employee });
      assert.equal(body.role_name, 'Empleado');
      assert.equal(body.organization_id, DON_PEPE);
      assert.equal(body.org_name, 'Abarrotes Don Pepe');
      assert.equal(body.user_pass_hash, undefined);
      assert.equal(body.org_state, undefined);
    });
  });

  describe('organization registration', () => {
    const registration = (suffix) => ({
      organization: { org_name: `Tienda ${suffix}`, org_email: `tienda${suffix}@example.com`, org_phone: '' },
      user: { user_name: `Dueña ${suffix}`, user_email: `Duena${suffix}@Example.com`, password: 'Password1!' },
    });

    it('creates the organization and its administrator, signed in, starting empty', async () => {
      const res = await call('POST', '/auth/register', { body: registration('A') });
      assert.equal(res.status, 201);
      const { token, user } = res.body;
      assert.equal(user.role_name, 'Administrador');
      assert.equal(user.org_name, 'Tienda A');
      assert.equal(user.user_email, 'duenaa@example.com');
      assert.equal(user.user_pass_hash, undefined);

      const org = (await call('GET', '/organization', { token })).body;
      assert.equal(org.id, user.organization_id);
      assert.equal(org.org_phone, null);

      assert.deepEqual((await call('GET', '/products', { token })).body, []);
      assert.deepEqual((await call('GET', '/sales', { token })).body, []);
      const users = (await call('GET', '/users', { token })).body;
      assert.deepEqual(users.map((u) => u.id), [user.id]);

      const log = (await call('GET', '/organization/audit-log', { token })).body;
      assert.deepEqual(log.map((e) => e.audit_table).sort(), ['organizations', 'users']);
      assert.ok(log.every((e) => e.audit_action === 'INSERT' && e.user_name === 'Dueña A'));
      assert.ok(!JSON.stringify(log).includes('$2'));

      const login = await call('POST', '/auth/login', { body: { email: 'duenaa@example.com', password: 'Password1!' } });
      assert.equal(login.status, 200);
    });

    it('rejects a taken email without leaving an empty organization behind', async () => {
      const [[{ count: before }]] = await pool.query('SELECT COUNT(*) AS count FROM organizations');
      const body = registration('B');
      body.user.user_email = 'admin@sayc.com';
      const res = await call('POST', '/auth/register', { body });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'AUTH_EMAIL_ALREADY_REGISTERED');
      const [[{ count: afterwards }]] = await pool.query('SELECT COUNT(*) AS count FROM organizations');
      assert.equal(afterwards, before);
    });

    it('validates input, and never lets the client pick a role or organization', async () => {
      const changes = [
        (b) => { b.user.password = 'short'; },
        (b) => { b.organization.org_name = ' '; },
        (b) => { b.organization.org_email = 'nope'; },
        (b) => { b.user.role_id = ROLE_EMPLOYEE; },
        (b) => { b.organization.id = DON_PEPE; },
        (b) => { delete b.user; },
      ];
      for (const change of changes) {
        const body = registration('C');
        change(body);
        const res = await call('POST', '/auth/register', { body });
        assert.equal(res.status, 400, JSON.stringify(body));
      }
    });

    it('locks out every user of a deactivated organization', async () => {
      const { token, user } = (await call('POST', '/auth/register', { body: registration('D') })).body;
      await pool.query(`UPDATE organizations SET org_state = 'inactivo' WHERE id = ?`, [user.organization_id]);
      assert.equal((await call('GET', '/auth/me', { token })).status, 401);
      const login = await call('POST', '/auth/login', { body: { email: 'duenad@example.com', password: 'Password1!' } });
      assert.equal(login.status, 401);
    });

    it('lets an administrator edit the organization, logging what changed', async () => {
      assert.equal((await call('PATCH', '/organization', { token: employee, body: { org_phone: '1' } })).status, 403);
      const res = await call('PATCH', '/organization', { token: admin, body: { org_phone: '5550000000' } });
      assert.equal(res.status, 200);
      assert.equal(res.body.org_phone, '5550000000');
      const [last] = (await auditEntries('organizations', DON_PEPE)).slice(-1);
      assert.deepEqual(last.audit_old, { org_phone: '5551234567' });
      assert.deepEqual(last.audit_new, { org_phone: '5550000000' });
    });
  });

  describe('organization isolation', () => {
    it('shows each organization only its own products, sales, users and dashboard', async () => {
      const mine = (await call('GET', '/products?limit=200', { token: admin })).body;
      const theirs = (await call('GET', '/products?limit=200', { token: otherAdmin })).body;
      assert.ok(mine.every((p) => p.organization_id === DON_PEPE));
      assert.ok(theirs.every((p) => p.organization_id === ESPERANZA));
      assert.ok(theirs.some((p) => p.id === ESPERANZA_COCA));

      // The same barcode is a different product in each organization.
      assert.equal((await call('GET', '/products/barcode/7501001112223', { token: admin })).body.id, COCA);
      assert.equal((await call('GET', '/products/barcode/7501001112223', { token: otherAdmin })).body.id, ESPERANZA_COCA);

      assert.ok((await call('GET', '/users', { token: otherAdmin })).body.every((u) => u.organization_id === ESPERANZA));
      assert.ok((await call('GET', '/sales', { token: otherAdmin })).body.every((s) => s.organization_id === ESPERANZA));
      const dashboard = (await call('GET', '/dashboard', { token: otherAdmin })).body;
      assert.ok(!dashboard.recent_sales.some((s) => s.user_name === 'Empleado 1'));
    });

    it("treats another organization's records as missing, for reading and writing", async () => {
      assert.equal((await call('GET', `/products/${COCA}`, { token: otherAdmin })).status, 404);
      assert.equal((await call('PATCH', `/products/${COCA}`, { token: otherAdmin, body: { product_sell_price: 1 } })).status, 404);
      assert.equal((await call('DELETE', `/products/${COCA}`, { token: otherAdmin })).status, 404);
      assert.equal((await call('GET', `/products/${COCA}/price-history`, { token: otherAdmin })).status, 404);
      const me = (await call('GET', '/auth/me', { token: admin })).body;
      assert.equal((await call('GET', `/users/${me.id}`, { token: otherAdmin })).status, 404);
      assert.equal((await call('PATCH', `/users/${me.id}`, { token: otherAdmin, body: { user_name: 'x' } })).status, 404);

      const sale = await call('POST', '/sales', {
        token: otherAdmin,
        body: { items: [{ product_id: COCA, quantity: 1 }], received_pay: 100 },
      });
      assert.equal(sale.status, 404);
      const adjust = await call('POST', '/inventory/adjustments', {
        token: otherAdmin,
        body: { product_id: COCA, adj_type: 'x', adj_new_amount: 0 },
      });
      assert.equal(adjust.status, 404);
      assert.equal((await call('GET', `/products/${COCA}`, { token: admin })).body.product_sell_price, 18);
    });

    it("puts new users and products in the creator's organization", async () => {
      const user = await call('POST', '/users', {
        token: otherAdmin,
        body: { user_name: 'Cajera', user_email: 'cajera@laesperanza.mx', password: 'Password1!', role_id: ROLE_EMPLOYEE },
      });
      assert.equal(user.body.organization_id, ESPERANZA);
      const product = await call('POST', '/products', {
        token: otherAdmin,
        body: { product_barcode: '7501003334445', product_name: 'Sabritas', product_sell_price: 18 },
      });
      assert.equal(product.status, 201);
      assert.equal(product.body.organization_id, ESPERANZA);
    });
  });

  describe('history', () => {
    it('records the price and cost a product starts with and every change to them', async () => {
      const created = (await call('POST', '/products', {
        token: employee,
        body: { product_name: 'Historial', product_sell_price: 10, product_costs: 6 },
      })).body;
      const history = async () =>
        (await call('GET', `/products/${created.id}/price-history`, { token: employee })).body;

      const [opening] = await history();
      assert.equal(opening.price_previous, null);
      assert.equal(opening.price_new, 10);
      assert.equal(opening.cost_new, 6);
      assert.equal(opening.user_name, 'Empleado 1');

      await call('PATCH', `/products/${created.id}`, { token: admin, body: { product_sell_price: 12 } });
      await call('PATCH', `/products/${created.id}`, { token: admin, body: { product_name: 'Historial 2' } });
      const entries = await history();
      assert.equal(entries.length, 2, 'a change that leaves price and cost alone adds no row');
      assert.equal(entries[0].price_previous, 10);
      assert.equal(entries[0].price_new, 12);
      assert.equal(entries[0].cost_previous, 6);
      assert.equal(entries[0].user_name, 'Administrador 1');
    });

    it('logs inserts, updates with only the changed values, and deletes', async () => {
      const created = (await call('POST', '/products', {
        token: employee,
        body: { product_name: 'Registro', product_sell_price: 5 },
      })).body;
      await call('PATCH', `/products/${created.id}`, {
        token: admin,
        body: { product_name: 'Registro 2', product_sell_price: 5 },
      });
      await call('DELETE', `/products/${created.id}`, { token: admin });

      const entries = await auditEntries('products', created.id);
      assert.deepEqual(entries.map((e) => e.audit_action), ['INSERT', 'UPDATE', 'DELETE']);
      assert.equal(entries[0].audit_new.product_name, 'Registro');
      assert.deepEqual(entries[1].audit_old, { product_name: 'Registro' });
      assert.deepEqual(entries[1].audit_new, { product_name: 'Registro 2' });
      assert.equal(entries[2].audit_old.product_name, 'Registro 2');
      assert.equal(entries[2].audit_new, null);

      const filtered = (await call('GET', `/organization/audit-log?table=products&record_id=${created.id}`, {
        token: admin,
      })).body;
      assert.deepEqual(filtered.map((e) => e.audit_action), ['DELETE', 'UPDATE', 'INSERT']);
      assert.equal((await call('GET', '/organization/audit-log', { token: employee })).status, 403);
      assert.equal((await call('GET', '/organization/audit-log?table=roles', { token: admin })).status, 400);
    });

    it('logs sales, stock adjustments and user changes, never a password hash', async () => {
      const sale = (await call('POST', '/sales', {
        token: employee,
        body: { items: [{ product_id: COCA, quantity: 1 }], received_pay: 20 },
      })).body;
      const [saleEntry] = await auditEntries('sales', sale.id);
      assert.equal(saleEntry.audit_new.sales_total, 18);

      const stock = await stockOf(LECHE);
      const adjustment = (await call('POST', '/inventory/adjustments', {
        token: employee,
        body: { product_id: LECHE, adj_type: 'entrada', adj_quantity: 1 },
      })).body;
      const [stockEntry] = (await auditEntries('products', LECHE)).slice(-1);
      assert.deepEqual(stockEntry.audit_old, { product_current_stock: stock });
      assert.equal(stockEntry.audit_new.adjustment_id, adjustment.id);
      // Later tests rely on LECHE being out of stock.
      await call('POST', '/inventory/adjustments', {
        token: employee,
        body: { product_id: LECHE, adj_type: 'salida', adj_quantity: -1 },
      });

      const user = (await call('POST', '/users', {
        token: admin,
        body: { user_name: 'Auditado', user_email: 'auditado@sayc.com', password: 'Password1!', role_id: ROLE_EMPLOYEE },
      })).body;
      await call('PATCH', `/users/${user.id}`, { token: admin, body: { password: 'Password2!' } });
      await call('DELETE', `/users/${user.id}`, { token: admin });
      const userEntries = await auditEntries('users', user.id);
      assert.deepEqual(userEntries.map((e) => e.audit_action), ['INSERT', 'UPDATE', 'UPDATE']);
      assert.equal(userEntries[1].audit_new.password_changed, true);
      assert.deepEqual(userEntries[2].audit_new, { user_state: 'inactivo' });
      assert.ok(!JSON.stringify(userEntries).includes('$2'));
    });

    it('rolls the log back with a change that fails', async () => {
      const [[{ count: before }]] = await pool.query('SELECT COUNT(*) AS count FROM audit_log');
      const res = await call('POST', '/products', {
        token: admin,
        body: { product_barcode: '7501001112223', product_name: 'Duplicado', product_sell_price: 1 },
      });
      assert.equal(res.status, 409);
      const [[{ count: afterwards }]] = await pool.query('SELECT COUNT(*) AS count FROM audit_log');
      assert.equal(afterwards, before);
    });
  });

  describe('users', () => {
    it('is restricted to administrators and never exposes hashes', async () => {
      assert.equal((await call('GET', '/users', { token: employee })).status, 403);
      const { status, body } = await call('GET', '/users', { token: admin });
      assert.equal(status, 200);
      assert.ok(body.length >= 2);
      assert.ok(body.every((user) => user.user_pass_hash === undefined));
    });

    it('creates a user, rejects duplicates, and locks out on deactivation', async () => {
      const data = { user_name: 'Nuevo', user_email: 'Nuevo@Sayc.com', password: 'Password1!', role_id: ROLE_EMPLOYEE };
      const created = await call('POST', '/users', { token: admin, body: data });
      assert.equal(created.status, 201);
      assert.equal(created.body.user_email, 'nuevo@sayc.com');

      const duplicate = await call('POST', '/users', { token: admin, body: data });
      assert.equal(duplicate.status, 409);
      assert.equal(duplicate.body.error.code, 'AUTH_EMAIL_ALREADY_REGISTERED');

      const { token } = (await call('POST', '/auth/login', { body: { email: 'nuevo@sayc.com', password: 'Password1!' } })).body;
      assert.equal((await call('GET', '/auth/me', { token })).status, 200);

      assert.equal((await call('DELETE', `/users/${created.body.id}`, { token: admin })).status, 204);
      assert.equal((await call('GET', '/auth/me', { token })).status, 401);
      assert.equal(
        (await call('POST', '/auth/login', { body: { email: 'nuevo@sayc.com', password: 'Password1!' } })).status,
        401,
      );
    });

    it('rejects an unknown role', async () => {
      const res = await call('POST', '/users', {
        token: admin,
        body: { user_name: 'X', user_email: 'x@sayc.com', password: 'Password1!', role_id: 'missing' },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INVALID_REFERENCE');
    });

    it('stops an administrator changing their own role or deactivating themselves', async () => {
      const me = (await call('GET', '/auth/me', { token: admin })).body;
      assert.equal((await call('DELETE', `/users/${me.id}`, { token: admin })).status, 409);
      const res = await call('PATCH', `/users/${me.id}`, { token: admin, body: { user_state: 'inactivo' } });
      assert.equal(res.status, 409);
    });

    it('changes a password', async () => {
      const email = 'cambio@sayc.com';
      await call('POST', '/users', {
        token: admin,
        body: { user_name: 'Cambio', user_email: email, password: 'Password1!', role_id: ROLE_EMPLOYEE },
      });
      const { token } = (await call('POST', '/auth/login', { body: { email, password: 'Password1!' } })).body;

      const wrong = await call('POST', '/auth/change-password', {
        token,
        body: { current_password: 'wrong', new_password: 'Password2!' },
      });
      assert.equal(wrong.status, 401);

      // Long enough, but with no capital letter or symbol.
      const weak = await call('POST', '/auth/change-password', {
        token,
        body: { current_password: 'Password1!', new_password: 'longbutsimple1' },
      });
      assert.equal(weak.status, 400);

      const ok = await call('POST', '/auth/change-password', {
        token,
        body: { current_password: 'Password1!', new_password: 'Password2!' },
      });
      assert.equal(ok.status, 204);
      assert.equal((await call('POST', '/auth/login', { body: { email, password: 'Password1!' } })).status, 401);
      assert.equal((await call('POST', '/auth/login', { body: { email, password: 'Password2!' } })).status, 200);
    });
  });

  describe('products', () => {
    it('lists with numeric prices and boolean flags', async () => {
      const { body } = await call('GET', `/products/${COCA}`, { token: employee });
      assert.equal(body.product_sell_price, 18);
      assert.equal(body.product_api_origin, false);
    });

    it('searches, treating wildcards literally', async () => {
      const found = await call('GET', '/products?q=sabritas', { token: employee });
      assert.deepEqual(found.body.map((p) => p.id), [SABRITAS]);
      const wildcard = await call('GET', `/products?q=${encodeURIComponent('%')}`, { token: employee });
      assert.deepEqual(wildcard.body, []);
    });

    it('filters low stock and finds by barcode', async () => {
      const low = await call('GET', '/products?low_stock=true', { token: employee });
      assert.ok(low.body.some((p) => p.id === LECHE));
      assert.ok(!low.body.some((p) => p.id === COCA));
      const scanned = await call('GET', '/products/barcode/7501001112223', { token: employee });
      assert.equal(scanned.body.id, COCA);
    });

    it('sorts by name or stock, in either direction', async () => {
      const list = async (params) => (await call('GET', `/products?limit=200&${params}`, { token: employee })).body;
      const names = (products) => products.map((p) => p.product_name);
      const stocks = (products) => products.map((p) => p.product_current_stock);
      const ordered = (values, compare) => values.every((v, i) => i === 0 || compare(values[i - 1], v) <= 0);
      const byName = (a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' });

      const standard = await list('');
      assert.ok(ordered(names(standard), byName));
      assert.deepEqual(names(await list('sort=name&order=asc')), names(standard));
      assert.ok(ordered(names(await list('sort=name&order=desc')), (a, b) => byName(b, a)));
      assert.ok(ordered(stocks(await list('sort=stock&order=asc')), (a, b) => a - b));
      assert.ok(ordered(stocks(await list('sort=stock&order=desc')), (a, b) => b - a));
    });

    it('breaks stock ties by name, so paging is stable', async () => {
      const { body } = await call('GET', '/products?limit=200&sort=stock&order=desc', { token: employee });
      for (let i = 1; i < body.length; i++) {
        if (body[i - 1].product_current_stock === body[i].product_current_stock) {
          assert.ok(body[i - 1].product_name.localeCompare(body[i].product_name, 'es', { sensitivity: 'base' }) <= 0);
        }
      }
    });

    it('rejects a sort it does not know, including SQL', async () => {
      for (const params of ['sort=id', 'sort=product_name;DROP TABLE products', 'order=sideways']) {
        const res = await call('GET', `/products?${params}`, { token: employee });
        assert.equal(res.status, 400, params);
      }
    });

    it('creates from Open Food Facts data, including a barcode conflict', async () => {
      const body = { product_barcode: '3017620422003', product_name: 'Nutella', product_sell_price: 95.5, product_api_origin: true };
      const created = await call('POST', '/products', { token: employee, body });
      assert.equal(created.status, 201);
      assert.equal(created.body.product_api_origin, true);
      assert.equal(created.body.product_min_stock, 5);
      const again = await call('POST', '/products', { token: employee, body });
      assert.equal(again.status, 409);
      assert.equal(again.body.error.code, 'BARCODE_ALREADY_REGISTERED');
    });

    it('validates input', async () => {
      for (const body of [
        { product_name: 'x' },
        { product_name: 'x', product_sell_price: -1 },
        { product_name: 'x', product_sell_price: 1.234 },
        { product_name: 'x', product_sell_price: 1, product_img_url: 'javascript:alert(1)' },
        { product_name: 'x', product_sell_price: 1, id: 'chosen-id' },
      ]) {
        const res = await call('POST', '/products', { token: admin, body });
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      }
    });

    it('lets employees and administrators manage products, but never edit stock directly', async () => {
      const byEmployee = await call('PATCH', `/products/${LECHE}`, { token: employee, body: { product_sell_price: 28.5 } });
      assert.equal(byEmployee.status, 200);
      assert.equal(byEmployee.body.product_sell_price, 28.5);
      const res = await call('PATCH', `/products/${LECHE}`, { token: admin, body: { product_sell_price: 29 } });
      assert.equal(res.body.product_sell_price, 29);

      const temporary = await call('POST', '/products', { token: employee, body: { product_name: 'Temporal', product_sell_price: 1 } });
      assert.equal((await call('DELETE', `/products/${temporary.body.id}`, { token: employee })).status, 204);
      assert.equal((await call('GET', `/products/${temporary.body.id}`, { token: employee })).status, 404);
      assert.equal((await call('PATCH', `/products/${LECHE}`, { body: { product_sell_price: 1 } })).status, 401);
      assert.equal((await call('DELETE', `/products/${LECHE}`)).status, 401);

      const stock = await call('PATCH', `/products/${LECHE}`, { token: admin, body: { product_current_stock: 9 } });
      assert.equal(stock.status, 400);
    });

    it('refuses to delete a product with sales history, for any role', async () => {
      for (const token of [admin, employee]) {
        const res = await call('DELETE', `/products/${COCA}`, { token });
        assert.equal(res.status, 409);
        assert.equal(res.body.error.code, 'RESOURCE_IN_USE');
      }
    });

    it('rejects malformed JSON as a client error', async () => {
      const res = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{bad',
      });
      assert.equal(res.status, 400);
    });
  });

  describe('sales', () => {
    it('registers a sale at database prices, merging lines and reducing stock', async () => {
      const coca = await stockOf(COCA);
      const sabritas = await stockOf(SABRITAS);
      const res = await call('POST', '/sales', {
        token: employee,
        body: {
          items: [
            { product_id: COCA, quantity: 1 },
            { product_id: SABRITAS, quantity: 1 },
            { product_id: COCA, quantity: 1 },
          ],
          received_pay: 100,
        },
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.sales_total, 53.5);
      assert.equal(res.body.sales_change, 46.5);
      assert.equal(res.body.items.length, 2);
      assert.equal(res.body.items.find((i) => i.product_id === COCA).detail_subtotal, 36);
      assert.equal(await stockOf(COCA), coca - 2);
      assert.equal(await stockOf(SABRITAS), sabritas - 1);
    });

    it('rejects a client-supplied price', async () => {
      const res = await call('POST', '/sales', {
        token: employee,
        body: { items: [{ product_id: COCA, quantity: 1, detail_unit_price: 0.01 }], received_pay: 1 },
      });
      assert.equal(res.status, 400);
    });

    it('rolls nothing in when stock, payment or product checks fail', async () => {
      const coca = await stockOf(COCA);
      const [{ count: before }] = (await pool.query('SELECT COUNT(*) AS count FROM sales'))[0];

      const noStock = await call('POST', '/sales', {
        token: employee,
        body: { items: [{ product_id: COCA, quantity: 1 }, { product_id: LECHE, quantity: 1 }], received_pay: 1000 },
      });
      assert.equal(noStock.status, 409);
      assert.equal(noStock.body.error.code, 'INSUFFICIENT_STOCK');

      const noPay = await call('POST', '/sales', {
        token: employee,
        body: { items: [{ product_id: COCA, quantity: 1 }], received_pay: 17.99 },
      });
      assert.equal(noPay.status, 422);
      assert.equal(noPay.body.error.code, 'INSUFFICIENT_PAYMENT');

      const noProduct = await call('POST', '/sales', {
        token: employee,
        body: { items: [{ product_id: 'missing', quantity: 1 }], received_pay: 100 },
      });
      assert.equal(noProduct.status, 404);

      assert.equal(await stockOf(COCA), coca);
      const [{ count: afterwards }] = (await pool.query('SELECT COUNT(*) AS count FROM sales'))[0];
      assert.equal(afterwards, before);
    });

    it('cannot oversell under concurrent requests', async () => {
      const adjust = await call('POST', '/inventory/adjustments', {
        token: admin,
        body: { product_id: SABRITAS, adj_type: 'test', adj_new_amount: 3 },
      });
      assert.equal(adjust.status, 201);

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          call('POST', '/sales', {
            token: employee,
            body: { items: [{ product_id: SABRITAS, quantity: 1 }], received_pay: 20 },
          }),
        ),
      );
      assert.equal(results.filter((r) => r.status === 201).length, 3);
      assert.equal(results.filter((r) => r.status === 409).length, 5);
      assert.equal(await stockOf(SABRITAS), 0);
    });

    it('limits employees to their own sales', async () => {
      const sale = (await call('POST', '/sales', {
        token: admin,
        body: { items: [{ product_id: COCA, quantity: 1 }], received_pay: 18 },
      })).body;
      assert.equal(sale.sales_change, 0);

      assert.equal((await call('GET', `/sales/${sale.id}`, { token: admin })).status, 200);
      assert.equal((await call('GET', `/sales/${sale.id}`, { token: employee })).status, 404);

      const mine = (await call('GET', '/sales', { token: employee })).body;
      assert.ok(mine.length > 0);
      assert.ok(!mine.some((s) => s.id === sale.id));
      const all = (await call('GET', '/sales', { token: admin })).body;
      assert.ok(all.some((s) => s.id === sale.id));
    });
  });

  describe('dashboard', () => {
    it('is restricted to administrators', async () => {
      assert.equal((await call('GET', '/dashboard')).status, 401);
      assert.equal((await call('GET', '/dashboard', { token: employee })).status, 403);
    });

    it('matches the tables', async () => {
      const { status, body } = await call('GET', '/dashboard', { token: admin });
      assert.equal(status, 200);

      const one = async (sql) => (await pool.query(sql, [DON_PEPE]))[0][0];
      assert.deepEqual(body.users, await one(
        `SELECT COUNT(*) AS total, SUM(user_state = 'activo') AS active FROM users WHERE organization_id = ?`,
      ));
      const products = await one(
        `SELECT COUNT(*) AS total, SUM(product_current_stock <= product_min_stock) AS low_stock,
                SUM(product_current_stock = 0) AS out_of_stock,
                SUM(product_current_stock * product_costs) AS inventory_cost
           FROM products WHERE organization_id = ?`,
      );
      assert.deepEqual(body.products, products);
      const sales = await one(`SELECT COUNT(*) AS count, SUM(sales_total) AS total FROM sales WHERE organization_id = ?`);
      assert.deepEqual(body.sales.today, sales);
      assert.deepEqual(body.sales.last_30_days, sales);
      assert.ok(body.sales.today.count > 0);

      assert.equal(body.low_stock_products.length, products.low_stock);
      assert.ok(body.low_stock_products.every((p) => p.product_current_stock <= p.product_min_stock));
      assert.ok(body.recent_sales.length > 0 && body.recent_sales.length <= 5);
      assert.ok(body.recent_sales[0].user_name);

      const quantities = body.top_products.map((p) => p.quantity);
      assert.deepEqual(quantities, [...quantities].sort((a, b) => b - a));
      assert.ok(body.top_products.some((p) => p.id === COCA));
      assert.ok(body.recent_adjustments.some((a) => a.adj_type === 'test'));
    });
  });

  describe('inventory', () => {
    it('sets the stock and records previous and new amounts', async () => {
      const previous = await stockOf(LECHE);
      const res = await call('POST', '/inventory/adjustments', {
        token: employee,
        body: { product_id: LECHE, adj_type: 'entrada', adj_new_amount: previous + 12, adj_motive: 'Compra' },
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.adj_previous_amount, previous);
      assert.equal(res.body.adj_new_amount, previous + 12);
      assert.equal(res.body.user_name, 'Empleado 1');
      assert.equal(await stockOf(LECHE), previous + 12);

      const list = await call('GET', `/inventory/adjustments?product_id=${LECHE}`, { token: employee });
      assert.ok(list.body.some((a) => a.id === res.body.id));
    });

    describe('by a relative quantity', () => {
      let productId;
      const adjust = (body, token = employee) =>
        call('POST', '/inventory/adjustments', { token, body: { product_id: productId, adj_type: 'x', ...body } });

      before(async () => {
        const created = await call('POST', '/products', {
          token: admin,
          body: { product_name: 'Relativo', product_sell_price: 1, product_current_stock: 10 },
        });
        productId = created.body.id;
      });

      it('adds and subtracts any amount, recording both totals', async () => {
        const added = await adjust({ adj_quantity: 7 });
        assert.equal(added.status, 201);
        assert.equal(added.body.adj_previous_amount, 10);
        assert.equal(added.body.adj_new_amount, 17);
        assert.equal(await stockOf(productId), 17);

        const removed = await adjust({ adj_quantity: -12 });
        assert.equal(removed.body.adj_new_amount, 5);
        assert.equal(await stockOf(productId), 5);
      });

      it('applies to the current stock, so it never overwrites a concurrent change', async () => {
        const start = await stockOf(productId);
        const results = await Promise.all(Array.from({ length: 8 }, () => adjust({ adj_quantity: 1 })));
        assert.ok(results.every((r) => r.status === 201));
        assert.equal(await stockOf(productId), start + 8);
      });

      it('allows subtracting down to 0 but no further, leaving nothing changed', async () => {
        const start = await stockOf(productId);
        const [{ count: before }] = (await pool.query(
          'SELECT COUNT(*) AS count FROM inventory_adjustments WHERE product_id = ?',
          [productId],
        ))[0];

        const tooMany = await adjust({ adj_quantity: -(start + 1) });
        assert.equal(tooMany.status, 409);
        assert.equal(tooMany.body.error.code, 'STOCK_WOULD_BE_NEGATIVE');
        assert.equal(tooMany.body.error.details.available, start);
        assert.equal(await stockOf(productId), start);
        const [{ count: afterwards }] = (await pool.query(
          'SELECT COUNT(*) AS count FROM inventory_adjustments WHERE product_id = ?',
          [productId],
        ))[0];
        assert.equal(afterwards, before);

        const toZero = await adjust({ adj_quantity: -start });
        assert.equal(toZero.status, 201);
        assert.equal(await stockOf(productId), 0);
      });

      it('rejects bad requests', async () => {
        for (const body of [
          {},
          { adj_quantity: 0 },
          { adj_quantity: 1.5 },
          { adj_quantity: '5' },
          { adj_quantity: 1, adj_new_amount: 1 },
        ]) {
          const res = await adjust(body);
          assert.equal(res.status, 400, JSON.stringify(body));
        }
        await adjust({ adj_new_amount: 2147483647 });
        assert.equal((await adjust({ adj_quantity: 1 })).status, 400);
        await adjust({ adj_new_amount: 0 });
      });
    });

    it('returns 404 for an unknown product and rejects negative stock', async () => {
      const missing = await call('POST', '/inventory/adjustments', {
        token: admin,
        body: { product_id: 'missing', adj_type: 'x', adj_new_amount: 1 },
      });
      assert.equal(missing.status, 404);
      const negative = await call('POST', '/inventory/adjustments', {
        token: admin,
        body: { product_id: COCA, adj_type: 'x', adj_new_amount: -1 },
      });
      assert.equal(negative.status, 400);
    });
  });
});
