// Settings for hosting: CORS patterns, the proxy setting and creating the tables on first start.
// The database part runs only against a disposable MySQL server (TEST_DB_PORT, never 3306).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import mysql from 'mysql2/promise';

import { initDatabaseIfEmpty, initStatements } from '../src/init-db.js';

Object.assign(process.env, {
  DB_USER: process.env.DB_USER ?? 'root',
  JWT_SECRET: process.env.JWT_SECRET ?? 'test-secret-test-secret-test-secret-test',
  TRUST_PROXY: '1',
  CORS_ORIGINS: 'https://sayc.vercel.app, https://sayc-*.vercel.app,https://localhost',
});
const { config } = await import('../src/config.js');
const { corsOriginMatchers, createApp } = await import('../src/app.js');

describe('hosting settings', () => {
  it('reads the proxy setting', () => {
    assert.equal(config.trustProxy, 1);
    assert.equal(createApp().get('trust proxy'), 1);
  });

  it('matches CORS patterns only within one part of a host name', () => {
    const matchers = corsOriginMatchers(config.corsOrigins);
    const allowed = (origin) => matchers.some((m) => (typeof m === 'string' ? m === origin : m.test(origin)));

    assert.ok(allowed('https://sayc.vercel.app'));
    assert.ok(allowed('https://sayc-git-main-team.vercel.app'));
    assert.ok(allowed('https://localhost'));
    assert.ok(!allowed('https://other.vercel.app'));
    assert.ok(!allowed('https://sayc-x.vercel.app.evil.com'));
    assert.ok(!allowed('https://sayc-a.b.vercel.app'));
    assert.ok(!allowed('http://sayc-x.vercel.app'));
  });

  it('answers a preflight from an allowed origin and not from others', async () => {
    const server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v1/auth/login`;
    const preflight = (origin) =>
      fetch(base, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
    try {
      const ok = await preflight('https://sayc-git-main-team.vercel.app');
      assert.equal(ok.headers.get('access-control-allow-origin'), 'https://sayc-git-main-team.vercel.app');
      const other = await preflight('https://other.vercel.app');
      assert.equal(other.headers.get('access-control-allow-origin'), null);
    } finally {
      server.close();
    }
  });
});

describe('table creation statements', () => {
  let sql;
  before(async () => {
    sql = await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8');
  });

  it('never drops or switches databases', () => {
    for (const mode of ['schema', 'demo']) {
      assert.ok(initStatements(sql, mode).every((s) => !/^(DROP|CREATE) DATABASE|^USE /i.test(s)));
    }
  });

  it('keeps only tables and roles without the sample data', () => {
    const statements = initStatements(sql, 'schema');
    assert.equal(statements.filter((s) => /^CREATE TABLE/i.test(s)).length, 9);
    assert.deepEqual(
      statements.filter((s) => !/^CREATE TABLE/i.test(s)).map((s) => s.slice(0, 17)),
      ['INSERT INTO roles'],
    );
    assert.ok(initStatements(sql, 'demo').some((s) => /^INSERT INTO users/i.test(s)));
  });
});

const port = Number(process.env.TEST_DB_PORT);
const skip = !port
  ? 'Set TEST_DB_PORT to the port of a disposable MySQL server'
  : port === 3306
    ? 'Refusing to change a database on the default MySQL port'
    : false;

describe('creating the tables on first start', { skip }, () => {
  const DB = 'sayc_init_test';
  const server = {
    host: process.env.TEST_DB_HOST ?? '127.0.0.1',
    port,
    user: process.env.TEST_DB_USER ?? 'root',
    password: process.env.TEST_DB_PASSWORD ?? '',
  };
  let admin;

  const reset = async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
  };
  const count = async (table) => (await admin.query(`SELECT COUNT(*) AS n FROM ${DB}.${table}`))[0][0].n;

  before(async () => {
    admin = await mysql.createConnection(server);
  });
  after(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.end();
  });

  it('creates tables and roles in an empty database, then leaves it alone', async () => {
    await reset();
    assert.equal(await initDatabaseIfEmpty({ ...server, database: DB }, 'schema'), true);
    assert.equal(await count('roles'), 2);
    assert.equal(await count('organizations'), 0);
    assert.equal(await initDatabaseIfEmpty({ ...server, database: DB }, 'schema'), false);
  });

  it('adds the sample companies with hashed passwords in demo mode', async () => {
    await reset();
    assert.equal(await initDatabaseIfEmpty({ ...server, database: DB }, 'demo'), true);
    assert.equal(await count('organizations'), 2);
    const [users] = await admin.query(`SELECT user_pass_hash FROM ${DB}.users`);
    assert.ok(users.length > 0 && users.every((u) => u.user_pass_hash.startsWith('$2')));
  });

  it('does nothing when off, and refuses a half-created database', async () => {
    await reset();
    assert.equal(await initDatabaseIfEmpty({ ...server, database: DB }, 'off'), false);
    await admin.query(`CREATE TABLE ${DB}.organizations (id INT)`);
    await assert.rejects(initDatabaseIfEmpty({ ...server, database: DB }, 'schema'), /only some SAYC tables/);
  });
});
