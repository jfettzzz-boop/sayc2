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

describe('SAYC API', { skip }, () => {
  let server, base, pool, admin, employee;

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

    assert.equal(await hashPlaintextPasswords(pool), 2);
    assert.equal(await hashPlaintextPasswords(pool), 0);

    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/v1`;

    const login = async (email) =>
      (await call('POST', '/auth/login', { body: { email, password: 'admin123' } })).body.token;
    admin = await login('admin@sayc.com');
    employee = await login('empleado@sayc.com');
  });

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
        `INSERT INTO users (id, user_name, user_email, user_pass_hash, role_id)
         VALUES ('plain-user', 'Plain', 'plain@sayc.com', 'plain-secret', ?)`,
        [ROLE_EMPLOYEE],
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
      assert.equal(body.user_pass_hash, undefined);
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
      const data = { user_name: 'Nuevo', user_email: 'Nuevo@Sayc.com', password: 'password1', role_id: ROLE_EMPLOYEE };
      const created = await call('POST', '/users', { token: admin, body: data });
      assert.equal(created.status, 201);
      assert.equal(created.body.user_email, 'nuevo@sayc.com');

      const duplicate = await call('POST', '/users', { token: admin, body: data });
      assert.equal(duplicate.status, 409);
      assert.equal(duplicate.body.error.code, 'AUTH_EMAIL_ALREADY_REGISTERED');

      const { token } = (await call('POST', '/auth/login', { body: { email: 'nuevo@sayc.com', password: 'password1' } })).body;
      assert.equal((await call('GET', '/auth/me', { token })).status, 200);

      assert.equal((await call('DELETE', `/users/${created.body.id}`, { token: admin })).status, 204);
      assert.equal((await call('GET', '/auth/me', { token })).status, 401);
      assert.equal(
        (await call('POST', '/auth/login', { body: { email: 'nuevo@sayc.com', password: 'password1' } })).status,
        401,
      );
    });

    it('rejects an unknown role', async () => {
      const res = await call('POST', '/users', {
        token: admin,
        body: { user_name: 'X', user_email: 'x@sayc.com', password: 'password1', role_id: 'missing' },
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
        body: { user_name: 'Cambio', user_email: email, password: 'password1', role_id: ROLE_EMPLOYEE },
      });
      const { token } = (await call('POST', '/auth/login', { body: { email, password: 'password1' } })).body;

      const wrong = await call('POST', '/auth/change-password', {
        token,
        body: { current_password: 'wrong', new_password: 'password2' },
      });
      assert.equal(wrong.status, 401);

      const ok = await call('POST', '/auth/change-password', {
        token,
        body: { current_password: 'password1', new_password: 'password2' },
      });
      assert.equal(ok.status, 204);
      assert.equal((await call('POST', '/auth/login', { body: { email, password: 'password1' } })).status, 401);
      assert.equal((await call('POST', '/auth/login', { body: { email, password: 'password2' } })).status, 200);
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

    it('allows only administrators to edit, and never stock', async () => {
      const edit = { product_sell_price: 19 };
      assert.equal((await call('PATCH', `/products/${LECHE}`, { token: employee, body: edit })).status, 403);
      const res = await call('PATCH', `/products/${LECHE}`, { token: admin, body: { product_sell_price: 29 } });
      assert.equal(res.body.product_sell_price, 29);
      const stock = await call('PATCH', `/products/${LECHE}`, { token: admin, body: { product_current_stock: 9 } });
      assert.equal(stock.status, 400);
    });

    it('refuses to delete a product with sales history', async () => {
      const res = await call('DELETE', `/products/${COCA}`, { token: admin });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'RESOURCE_IN_USE');
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
