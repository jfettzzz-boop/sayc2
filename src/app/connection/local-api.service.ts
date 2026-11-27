import { HttpErrorResponse, HttpEvent, HttpRequest, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, from, mergeMap, of, throwError } from 'rxjs';

import { LocalDbService, LocalTransaction, Param, Row } from './local-db.service';

const ROLE_ADMIN = 'Administrador';
const STATES = ['activo', 'inactivo'];
const MAX_MONEY = 99999999.99;
const MAX_STOCK = 2147483647;
const SESSION_SECONDS = 8 * 60 * 60;
const LIST_SIZE = 5;
const LOW_STOCK_LIST_SIZE = 10;
const SORT_COLUMNS: Record<string, string> = {
  name: 'product_name COLLATE NOCASE',
  stock: 'product_current_stock',
};
const PRODUCT_FIELDS = [
  'product_barcode', 'product_name', 'product_brand', 'product_description', 'product_sell_price',
  'product_costs', 'product_min_stock', 'product_api_origin', 'product_img_url',
];
const ORG_FIELDS = ['org_name', 'org_email', 'org_tax_id', 'org_phone', 'org_address'];
const AUDIT_TABLES = ['organizations', 'users', 'products', 'sales'];
const AUDIT_ACTIONS = ['INSERT', 'UPDATE', 'DELETE'];
const SECRET_COLUMNS = ['user_pass_hash'];

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

const invalid = (message = 'The request is not valid.') => new ApiError(400, 'VALIDATION_ERROR', message);
const notFound = (what: string) => new ApiError(404, 'NOT_FOUND', `${what} not found.`);
const toCents = (value: number) => Math.round(value * 100);
const round = (value: number) => Math.round(value * 100) / 100;

const isWhole = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

const isMoney = (value: unknown): value is number =>
  typeof value === 'number' && value >= 0 && value <= MAX_MONEY && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;

const isObject = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

function assertKnownFields(body: Row, allowed: string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw invalid();
}

function encodeToken(payload: object): string {
  return btoa(JSON.stringify(payload)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodeToken(token: string): { sub?: string; exp?: number } | null {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

function presentProduct(product: Row): Row {
  return { ...product, product_api_origin: Boolean(product['product_api_origin']) };
}

/** Keeps only the columns whose value differs, so an UPDATE entry shows just what changed. */
function changedColumns(before: Row, after: Row): { old: Row; now: Row } {
  const old: Row = {};
  const now: Row = {};
  for (const column of Object.keys(after)) {
    const was = typeof before[column] === 'number' && typeof after[column] === 'boolean' ? Boolean(before[column]) : before[column];
    if (String(was ?? '') !== String(after[column] ?? '')) {
      old[column] = was ?? null;
      now[column] = after[column] ?? null;
    }
  }
  return { old, now };
}

function snapshot(row: Row | null): string | null {
  if (!row) return null;
  return JSON.stringify(Object.fromEntries(Object.entries(row).filter(([column]) => !SECRET_COLUMNS.includes(column))));
}

interface AuditEntry {
  table: string;
  recordId: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  before?: Row | null;
  after?: Row | null;
}

/** Adds an entry to audit_log inside the transaction of the change it describes. */
function audit(tx: LocalTransaction, organizationId: string, userId: string, entry: AuditEntry) {
  tx.run(
    `INSERT INTO audit_log
       (organization_id, user_id, audit_table, audit_record_id, audit_action, audit_old, audit_new, audit_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [organizationId, userId, entry.table, entry.recordId, entry.action,
      snapshot(entry.before ?? null), snapshot(entry.after ?? null), new Date().toISOString()],
  );
}

const auditBy = (tx: LocalTransaction, user: Row, entry: AuditEntry) =>
  audit(tx, user['organization_id'], user['id'], entry);

interface Context {
  method: string;
  params: URLSearchParams;
  body: Row;
  token: string | null;
}

interface Result {
  status?: number;
  body?: unknown;
}

/**
 * The server's API, answered from the database inside the app. It follows server/src/routes:
 * the same paths, fields, permissions and error codes, so pages can't tell the difference.
 * A change to one of them should be made in the other.
 *
 * Permissions here shape what the app offers, and protect against mistakes. Someone in control
 * of the device could read the file directly, so this mode is for testing, not sensitive data.
 */
@Injectable({ providedIn: 'root' })
export class LocalApiService {
  private readonly db = inject(LocalDbService);

  handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
    return from(this.dispatch(req)).pipe(
      mergeMap(({ status, body }): Observable<HttpEvent<unknown>> =>
        of(new HttpResponse({ status: status ?? 200, body: body ?? null, url: req.url }))),
      (source) => new Observable<HttpEvent<unknown>>((subscriber) => source.subscribe({
        next: (event) => subscriber.next(event),
        complete: () => subscriber.complete(),
        error: (err) => {
          const failure = this.toApiError(err, req.method);
          throwError(() => new HttpErrorResponse({
            status: failure.status,
            url: req.url,
            error: { error: { code: failure.code, message: failure.message, details: failure.details } },
          })).subscribe(subscriber);
        },
      })),
    );
  }

  private toApiError(err: unknown, method: string): ApiError {
    if (err instanceof ApiError) return err;
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('UNIQUE constraint failed')) {
      return new ApiError(409, 'DUPLICATE_ENTRY', 'A record with that unique value already exists.');
    }
    if (message.includes('FOREIGN KEY constraint failed')) {
      return method === 'DELETE'
        ? new ApiError(409, 'RESOURCE_IN_USE', 'The record is referenced by other records.')
        : new ApiError(400, 'INVALID_REFERENCE', 'The request references a record that does not exist.');
    }
    console.error('Local database error', err);
    return new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }

  private async dispatch(req: HttpRequest<unknown>): Promise<Result> {
    const url = new URL(req.urlWithParams, 'http://local');
    const path = url.pathname.replace(/^\/api\/v1/, '').replace(/\/+$/, '');
    const authorization = req.headers.get('Authorization');
    const ctx: Context = {
      method: req.method,
      params: url.searchParams,
      // The same conversion a request to a server goes through, which drops undefined fields.
      body: JSON.parse(JSON.stringify(req.body ?? {})) as Row,
      token: authorization?.startsWith('Bearer ') ? authorization.slice(7) : null,
    };
    const segments = path.split('/').filter(Boolean).map(decodeURIComponent);
    const [resource, id, extra] = segments;
    const route = `${req.method} ${resource ?? ''}`;

    if (route === 'GET health') {
      await this.db.ready();
      return { body: { status: 'ok' } };
    }
    if (route === 'POST auth' && id === 'login') return this.login(ctx);
    if (route === 'POST auth' && id === 'register') return this.register(ctx);
    const user = await this.requireUser(ctx);

    switch (resource) {
      case 'auth':
        if (req.method === 'GET' && id === 'me') return { body: user };
        if (req.method === 'POST' && id === 'change-password') return this.changePassword(ctx, user);
        break;
      case 'organization':
        if (req.method === 'GET' && !id) return { body: await this.findOrganization(user['organization_id']) };
        this.requireAdmin(user);
        if (req.method === 'PATCH' && !id) return this.updateOrganization(ctx, user);
        if (req.method === 'GET' && id === 'audit-log') return this.auditLog(ctx, user);
        break;
      case 'roles':
        this.requireAdmin(user);
        if (req.method === 'GET' && !id) {
          return { body: await this.db.query('SELECT * FROM roles ORDER BY role_name') };
        }
        break;
      case 'users':
        this.requireAdmin(user);
        if (req.method === 'GET' && !id) return this.listUsers(ctx, user);
        if (req.method === 'GET') return { body: await this.findUser(id, user) };
        if (req.method === 'POST' && !id) return this.createUser(ctx, user);
        if (req.method === 'PATCH' && id) return this.updateUser(ctx, id, user);
        if (req.method === 'DELETE' && id) return this.deactivateUser(id, user);
        break;
      case 'products':
        if (req.method === 'GET' && id === 'barcode' && extra) return this.productByBarcode(extra, user);
        if (req.method === 'GET' && id && extra === 'price-history') return this.priceHistory(ctx, id, user);
        if (req.method === 'GET' && !id) return this.listProducts(ctx, user);
        if (req.method === 'GET' && !extra) return { body: await this.findProduct(id, user) };
        if (req.method === 'POST' && !id) return this.createProduct(ctx, user);
        if (req.method === 'PATCH' && id && !extra) return this.updateProduct(ctx, id, user);
        if (req.method === 'DELETE' && id && !extra) return this.deleteProduct(id, user);
        break;
      case 'sales':
        if (req.method === 'GET' && !id) return this.listSales(ctx, user);
        if (req.method === 'GET') return { body: await this.findSale(id, user) };
        if (req.method === 'POST' && !id) return this.createSale(ctx, user);
        break;
      case 'inventory':
        if (id === 'adjustments' && req.method === 'GET') return this.listAdjustments(ctx, user);
        if (id === 'adjustments' && req.method === 'POST') return this.createAdjustment(ctx, user);
        break;
      case 'dashboard':
        this.requireAdmin(user);
        if (req.method === 'GET' && !id) return this.dashboard(user);
        break;
    }
    throw new ApiError(404, 'NOT_FOUND', 'Route not found.');
  }

  // Sessions

  /** The user as a session describes them: role and organization, never the hash. */
  private readonly SESSION_USER = `
    SELECT u.id, u.user_name, u.user_email, u.user_state, u.role_id, r.role_name,
           u.organization_id, o.org_name, o.org_state
      FROM users u
      JOIN roles r ON r.id = u.role_id
      JOIN organizations o ON o.id = u.organization_id`;

  private canSignIn(user: Row | undefined): user is Row {
    return user?.['user_state'] === 'activo' && user['org_state'] === 'activo';
  }

  private session(userId: string): string {
    const payload = { sub: userId, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS };
    return `local.${encodeToken(payload)}.local`;
  }

  private async login({ body }: Context): Promise<Result> {
    if (!isText(body['email'], 150) || !isText(body['password'], 72)) throw invalid();
    const bcrypt = (await import('bcryptjs')).default;

    const [row] = await this.db.query(
      `SELECT u.user_pass_hash, s.* FROM users u JOIN (${this.SESSION_USER}) s ON s.id = u.id WHERE u.user_email = ?`,
      [body['email'].trim().toLowerCase()],
    );
    const valid = row ? await bcrypt.compare(body['password'], row['user_pass_hash']) : false;
    if (!valid || !this.canSignIn(row)) {
      throw new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials.');
    }

    const { user_pass_hash: _hash, org_state: _state, ...user } = row;
    return { body: { token: this.session(row['id']), user } };
  }

  /** Registers a company and its first administrator together, and signs that user in. */
  private async register({ body }: Context): Promise<Result> {
    assertKnownFields(body, ['organization', 'user']);
    const { organization, user } = body;
    if (!isObject(organization) || !isObject(user)) throw invalid();
    assertKnownFields(organization, ORG_FIELDS);
    assertKnownFields(user, ['user_name', 'user_email', 'password']);

    const org = this.organizationChanges(organization);
    if (org['org_name'] === undefined || org['org_email'] === undefined) throw invalid();
    const { user_name, user_email, password } = user;
    if (!isText(user_name, 100) || !user_name.trim() || !this.validEmail(user_email)
      || !isText(password, 72) || password.length < 8) throw invalid();

    const bcrypt = (await import('bcryptjs')).default;
    const hash = await bcrypt.hash(password, 10);
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    const email = user_email.trim().toLowerCase();

    try {
      await this.db.transaction((tx) => {
        const [adminRole] = tx.query('SELECT id FROM roles WHERE role_name = ?', [ROLE_ADMIN]);
        const row: Row = { id: organizationId, ...org, org_created_at: now, org_updated_at: now };
        const columns = Object.keys(row);
        tx.run(
          `INSERT INTO organizations (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
          columns.map((column) => row[column]),
        );
        tx.run(
          `INSERT INTO users (id, organization_id, user_name, user_email, user_pass_hash, role_id, user_created_at, user_updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, organizationId, user_name.trim(), email, hash, adminRole['id'], now, now],
        );
        const [created] = tx.query('SELECT * FROM organizations WHERE id = ?', [organizationId]);
        audit(tx, organizationId, userId, { table: 'organizations', recordId: organizationId, action: 'INSERT', after: created });
        audit(tx, organizationId, userId, {
          table: 'users', recordId: userId, action: 'INSERT',
          after: { id: userId, user_name: user_name.trim(), user_email: email, role_id: adminRole['id'] },
        });
      });
    } catch (err) {
      throw this.emailTaken(err);
    }

    const [row] = await this.db.query(`${this.SESSION_USER} WHERE u.id = ?`, [userId]);
    const { org_state: _state, ...sessionUser } = row;
    return { status: 201, body: { token: this.session(userId), user: sessionUser } };
  }

  /** Reads the user from the database each time, so a deactivation applies at once, as on the server. */
  private async requireUser({ token }: Context): Promise<Row> {
    const payload = token ? decodeToken(token) : null;
    const expired = !payload?.exp || payload.exp * 1000 <= Date.now();
    if (!payload?.sub || expired) throw new ApiError(401, 'AUTH_REQUIRED', 'A valid session is required.');

    const [row] = await this.db.query(`${this.SESSION_USER} WHERE u.id = ?`, [payload.sub]);
    if (!this.canSignIn(row)) throw new ApiError(401, 'AUTH_REQUIRED', 'A valid session is required.');
    const { org_state: _state, ...user } = row;
    return user;
  }

  private requireAdmin(user: Row) {
    if (user['role_name'] !== ROLE_ADMIN) throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to do this.');
  }

  private async changePassword({ body }: Context, user: Row): Promise<Result> {
    const { current_password, new_password } = body;
    if (!isText(current_password, 72) || !isText(new_password, 72) || new_password.length < 8) throw invalid();
    const bcrypt = (await import('bcryptjs')).default;

    const [row] = await this.db.query('SELECT user_pass_hash FROM users WHERE id = ?', [user['id']]);
    if (!(await bcrypt.compare(current_password, row['user_pass_hash']))) {
      throw new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials.');
    }
    const hash = await bcrypt.hash(new_password, 10);
    await this.db.transaction((tx) => {
      tx.run('UPDATE users SET user_pass_hash = ?, user_updated_at = ? WHERE id = ?', [hash, new Date().toISOString(), user['id']]);
      auditBy(tx, user, { table: 'users', recordId: user['id'], action: 'UPDATE', after: { password_changed: true } });
    });
    return { status: 204 };
  }

  // Organization

  private async findOrganization(id: string): Promise<Row> {
    const [org] = await this.db.query('SELECT * FROM organizations WHERE id = ?', [id]);
    return org;
  }

  /** Validates the organization fields present in body, trimming text and turning blanks into null. */
  private organizationChanges(body: Row): Record<string, Param> {
    const changes: Record<string, Param> = {};
    if ('org_name' in body) {
      if (!isText(body['org_name'], 150) || !body['org_name'].trim()) throw invalid();
      changes['org_name'] = body['org_name'].trim();
    }
    if ('org_email' in body) {
      if (!this.validEmail(body['org_email'])) throw invalid();
      changes['org_email'] = body['org_email'].trim().toLowerCase();
    }
    for (const [field, max] of [['org_tax_id', 30], ['org_phone', 30], ['org_address', 255]] as const) {
      if (!(field in body)) continue;
      const value = body[field];
      if (value !== null && !isText(value, max)) throw invalid();
      changes[field] = typeof value === 'string' ? value.trim() || null : null;
    }
    return changes;
  }

  private async updateOrganization({ body }: Context, user: Row): Promise<Result> {
    assertKnownFields(body, ORG_FIELDS);
    if (Object.keys(body).length === 0) throw invalid('No fields to update');
    const changes = this.organizationChanges(body);
    const id = user['organization_id'];

    await this.db.transaction((tx) => {
      const [before] = tx.query('SELECT * FROM organizations WHERE id = ?', [id]);
      this.updateRow(tx, 'organizations', changes, 'org_updated_at', id);
      const { old, now } = changedColumns(before, changes);
      if (Object.keys(now).length > 0) {
        auditBy(tx, user, { table: 'organizations', recordId: id, action: 'UPDATE', before: old, after: now });
      }
    });
    return { body: await this.findOrganization(id) };
  }

  private async auditLog({ params }: Context, user: Row): Promise<Result> {
    const [limit, offset] = this.page(params);
    const where = ['a.organization_id = ?'];
    const values: Param[] = [user['organization_id']];
    const filters: [string, string, string[] | null][] = [
      ['table', 'a.audit_table', AUDIT_TABLES],
      ['record_id', 'a.audit_record_id', null],
      ['action', 'a.audit_action', AUDIT_ACTIONS],
    ];
    for (const [param, column, allowed] of filters) {
      const value = params.get(param);
      if (value === null) continue;
      if (allowed ? !allowed.includes(value) : !isText(value, 36) || !value) throw invalid();
      where.push(`${column} = ?`);
      values.push(value);
    }

    const rows = await this.db.query(
      `SELECT a.*, u.user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.audit_date DESC, a.id DESC LIMIT ? OFFSET ?`,
      [...values, limit, offset],
    );
    const parse = (text: string | null) => (text === null ? null : JSON.parse(text));
    return { body: rows.map((row) => ({ ...row, audit_old: parse(row['audit_old']), audit_new: parse(row['audit_new']) })) };
  }

  // Lists

  private page(params: URLSearchParams): [number, number] {
    const limit = Number(params.get('limit') ?? 50);
    const offset = Number(params.get('offset') ?? 0);
    if (!isWhole(limit, 1, 200) || !isWhole(offset, 0, Number.MAX_SAFE_INTEGER)) throw invalid();
    return [limit, offset];
  }

  private likeContains(text: string): string {
    return `%${text.replace(/[\\%_]/g, '\\$&')}%`;
  }

  // Users

  private readonly PUBLIC_USER = `
    SELECT u.id, u.user_name, u.user_email, u.user_state, u.role_id, r.role_name,
           u.organization_id, u.user_created_at, u.user_updated_at
      FROM users u JOIN roles r ON r.id = u.role_id`;

  /** A user of another organization reads as missing, so ids cannot be probed. */
  private async findUser(id: string, user: Row): Promise<Row> {
    const [found] = await this.db.query(`${this.PUBLIC_USER} WHERE u.id = ? AND u.organization_id = ?`, [id, user['organization_id']]);
    if (!found) throw notFound('User');
    return found;
  }

  private async listUsers({ params }: Context, user: Row): Promise<Result> {
    const [limit, offset] = this.page(params);
    return {
      body: await this.db.query(
        `${this.PUBLIC_USER} WHERE u.organization_id = ? ORDER BY u.user_created_at DESC, u.id LIMIT ? OFFSET ?`,
        [user['organization_id'], limit, offset],
      ),
    };
  }

  private validEmail(email: unknown): email is string {
    return isText(email, 150) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  private async createUser({ body }: Context, user: Row): Promise<Result> {
    assertKnownFields(body, ['user_name', 'user_email', 'password', 'role_id']);
    const { user_name, user_email, password, role_id } = body;
    if (!isText(user_name, 100) || !user_name.trim() || !this.validEmail(user_email)
      || !isText(password, 72) || password.length < 8 || !isText(role_id, 36) || !role_id) throw invalid();

    const bcrypt = (await import('bcryptjs')).default;
    const hash = await bcrypt.hash(password, 10);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await this.db.transaction((tx) => {
        tx.run(
          `INSERT INTO users (id, organization_id, user_name, user_email, user_pass_hash, role_id, user_created_at, user_updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, user['organization_id'], user_name.trim(), user_email.trim().toLowerCase(), hash, role_id, now, now],
        );
        const [created] = tx.query(`${this.PUBLIC_USER} WHERE u.id = ?`, [id]);
        auditBy(tx, user, { table: 'users', recordId: id, action: 'INSERT', after: created });
      });
    } catch (err) {
      throw this.emailTaken(err);
    }
    return { status: 201, body: await this.findUser(id, user) };
  }

  private emailTaken(err: unknown): unknown {
    return err instanceof Error && err.message.includes('UNIQUE constraint failed')
      ? new ApiError(409, 'AUTH_EMAIL_ALREADY_REGISTERED', 'That email is already registered.')
      : err;
  }

  private async updateUser({ body }: Context, id: string, user: Row): Promise<Result> {
    assertKnownFields(body, ['user_name', 'user_email', 'password', 'role_id', 'user_state']);
    if (Object.keys(body).length === 0) throw invalid('No fields to update');
    if (id === user['id'] && (body['role_id'] || body['user_state'])) {
      throw new ApiError(409, 'CANNOT_MODIFY_SELF', 'You cannot change your own role or state.');
    }

    const changes: Record<string, Param> = {};
    if ('user_name' in body) {
      if (!isText(body['user_name'], 100) || !body['user_name'].trim()) throw invalid();
      changes['user_name'] = body['user_name'].trim();
    }
    if ('user_email' in body) {
      if (!this.validEmail(body['user_email'])) throw invalid();
      changes['user_email'] = body['user_email'].trim().toLowerCase();
    }
    if ('role_id' in body) {
      if (!isText(body['role_id'], 36) || !body['role_id']) throw invalid();
      changes['role_id'] = body['role_id'];
    }
    if ('user_state' in body) {
      if (!STATES.includes(body['user_state'])) throw invalid();
      changes['user_state'] = body['user_state'];
    }
    let passwordChanged = false;
    if ('password' in body) {
      if (!isText(body['password'], 72) || body['password'].length < 8) throw invalid();
      const bcrypt = (await import('bcryptjs')).default;
      changes['user_pass_hash'] = await bcrypt.hash(body['password'], 10);
      passwordChanged = true;
    }

    const before = await this.findUser(id, user);
    try {
      await this.db.transaction((tx) => {
        this.updateRow(tx, 'users', changes, 'user_updated_at', id);
        const { user_pass_hash: _hash, ...visible } = changes;
        const { old, now } = changedColumns(before, visible);
        if (passwordChanged) now['password_changed'] = true;
        auditBy(tx, user, { table: 'users', recordId: id, action: 'UPDATE', before: old, after: now });
      });
    } catch (err) {
      throw this.emailTaken(err);
    }
    return { body: await this.findUser(id, user) };
  }

  private async deactivateUser(id: string, user: Row): Promise<Result> {
    if (id === user['id']) throw new ApiError(409, 'CANNOT_MODIFY_SELF', 'You cannot deactivate your own account.');
    const before = await this.findUser(id, user);
    await this.db.transaction((tx) => {
      this.updateRow(tx, 'users', { user_state: 'inactivo' }, 'user_updated_at', id);
      auditBy(tx, user, {
        table: 'users', recordId: id, action: 'UPDATE',
        before: { user_state: before['user_state'] }, after: { user_state: 'inactivo' },
      });
    });
    return { status: 204 };
  }

  /** Column names only ever come from the fixed lists in this file, never from a request. */
  private updateRow(tx: LocalTransaction, table: string, changes: Record<string, Param>, stamp: string, id: string) {
    const columns = Object.keys(changes);
    const assignments = [...columns.map((column) => `${column} = ?`), `${stamp} = ?`].join(', ');
    tx.run(`UPDATE ${table} SET ${assignments} WHERE id = ?`, [
      ...columns.map((column) => changes[column]), new Date().toISOString(), id,
    ]);
  }

  // Products

  /** A product of another organization reads as missing, so ids cannot be probed. */
  private async findProduct(id: string, user: Row): Promise<Row> {
    const [product] = await this.db.query('SELECT * FROM products WHERE id = ? AND organization_id = ?', [id, user['organization_id']]);
    if (!product) throw notFound('Product');
    return presentProduct(product);
  }

  private async productByBarcode(barcode: string, user: Row): Promise<Result> {
    const [product] = await this.db.query(
      'SELECT * FROM products WHERE product_barcode = ? AND organization_id = ?', [barcode, user['organization_id']],
    );
    if (!product) throw notFound('Product');
    return { body: presentProduct(product) };
  }

  private async priceHistory({ params }: Context, id: string, user: Row): Promise<Result> {
    const [limit, offset] = this.page(params);
    await this.findProduct(id, user);
    return {
      body: await this.db.query(
        `SELECT h.*, u.user_name FROM product_price_history h JOIN users u ON u.id = h.user_id
          WHERE h.product_id = ? ORDER BY h.price_changed_at DESC, h.id DESC LIMIT ? OFFSET ?`,
        [id, limit, offset],
      ),
    };
  }

  /** Records a price or cost in product_price_history; previous is null for a new product. */
  private recordPrice(tx: LocalTransaction, user: Row, previous: Row | null, current: Row) {
    tx.run(
      `INSERT INTO product_price_history
         (organization_id, product_id, user_id, price_previous, price_new, cost_previous, cost_new, price_changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [user['organization_id'], current['id'], user['id'],
        previous?.['product_sell_price'] ?? null, current['product_sell_price'],
        previous?.['product_costs'] ?? null, current['product_costs'], new Date().toISOString()],
    );
  }

  private async listProducts({ params }: Context, user: Row): Promise<Result> {
    const [limit, offset] = this.page(params);
    const sort = params.get('sort') ?? 'name';
    const order = params.get('order') ?? 'asc';
    if (!(sort in SORT_COLUMNS) || !['asc', 'desc'].includes(order)) throw invalid();

    const where: string[] = ['organization_id = ?'];
    const values: Param[] = [user['organization_id']];
    const q = params.get('q')?.trim();
    if (q) {
      const term = this.likeContains(q);
      where.push(`(product_name LIKE ? ESCAPE '\\' OR product_brand LIKE ? ESCAPE '\\' OR product_barcode LIKE ? ESCAPE '\\')`);
      values.push(term, term, term);
    }
    if (params.get('low_stock') === 'true') where.push('product_current_stock <= product_min_stock');

    const rows = await this.db.query(
      `SELECT * FROM products
       WHERE ${where.join(' AND ')}
       ORDER BY ${SORT_COLUMNS[sort]} ${order === 'desc' ? 'DESC' : 'ASC'}, product_name COLLATE NOCASE, id
       LIMIT ? OFFSET ?`,
      [...values, limit, offset],
    );
    return { body: rows.map(presentProduct) };
  }

  private productChanges(body: Row): Record<string, Param> {
    const changes: Record<string, Param> = {};
    const optionalText = (field: string, max: number) => {
      if (!(field in body)) return;
      const value = body[field];
      if (value !== null && !isText(value, max)) throw invalid();
      changes[field] = typeof value === 'string' ? value.trim() || null : null;
    };
    optionalText('product_barcode', 100);
    optionalText('product_brand', 100);
    optionalText('product_description', 5000);

    if ('product_name' in body) {
      if (!isText(body['product_name'], 150) || !body['product_name'].trim()) throw invalid();
      changes['product_name'] = body['product_name'].trim();
    }
    for (const field of ['product_sell_price', 'product_costs']) {
      if (field in body) {
        if (!isMoney(body[field])) throw invalid();
        changes[field] = body[field];
      }
    }
    if ('product_min_stock' in body) {
      if (!isWhole(body['product_min_stock'], 0, MAX_STOCK)) throw invalid();
      changes['product_min_stock'] = body['product_min_stock'];
    }
    if ('product_api_origin' in body) {
      if (typeof body['product_api_origin'] !== 'boolean') throw invalid();
      changes['product_api_origin'] = body['product_api_origin'];
    }
    if ('product_img_url' in body) {
      const url = body['product_img_url'];
      if (url !== null && !(isText(url, 255) && /^https?:\/\/\S+$/i.test(url))) throw invalid();
      changes['product_img_url'] = url;
    }
    return changes;
  }

  private barcodeTaken(err: unknown): unknown {
    return err instanceof Error && err.message.includes('UNIQUE constraint failed')
      ? new ApiError(409, 'BARCODE_ALREADY_REGISTERED', 'A product with that barcode already exists.')
      : err;
  }

  private async createProduct({ body }: Context, user: Row): Promise<Result> {
    assertKnownFields(body, [...PRODUCT_FIELDS, 'product_current_stock']);
    const changes = this.productChanges(body);
    if (changes['product_name'] === undefined || changes['product_sell_price'] === undefined) throw invalid();
    if ('product_current_stock' in body) {
      if (!isWhole(body['product_current_stock'], 0, MAX_STOCK)) throw invalid();
      changes['product_current_stock'] = body['product_current_stock'];
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const row: Record<string, Param> = {
      id, organization_id: user['organization_id'], ...changes, product_created_at: now, product_updated_at: now,
    };
    const columns = Object.keys(row);
    try {
      await this.db.transaction((tx) => {
        tx.run(
          `INSERT INTO products (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
          columns.map((column) => row[column]),
        );
        const [created] = tx.query('SELECT * FROM products WHERE id = ?', [id]);
        this.recordPrice(tx, user, null, created);
        auditBy(tx, user, { table: 'products', recordId: id, action: 'INSERT', after: presentProduct(created) });
      });
    } catch (err) {
      throw this.barcodeTaken(err);
    }
    return { status: 201, body: await this.findProduct(id, user) };
  }

  private async updateProduct({ body }: Context, id: string, user: Row): Promise<Result> {
    // Stock is left out on purpose: it only changes through sales and adjustments.
    assertKnownFields(body, PRODUCT_FIELDS);
    if (Object.keys(body).length === 0) throw invalid('No fields to update');
    const changes = this.productChanges(body);

    await this.findProduct(id, user);
    try {
      await this.db.transaction((tx) => {
        const [before] = tx.query('SELECT * FROM products WHERE id = ?', [id]);
        this.updateRow(tx, 'products', changes, 'product_updated_at', id);
        const [after] = tx.query('SELECT * FROM products WHERE id = ?', [id]);
        if (before['product_sell_price'] !== after['product_sell_price'] || before['product_costs'] !== after['product_costs']) {
          this.recordPrice(tx, user, before, after);
        }
        const { old, now } = changedColumns(before, changes);
        if (Object.keys(now).length > 0) {
          auditBy(tx, user, { table: 'products', recordId: id, action: 'UPDATE', before: old, after: now });
        }
      });
    } catch (err) {
      throw this.barcodeTaken(err);
    }
    return { body: await this.findProduct(id, user) };
  }

  private async deleteProduct(id: string, user: Row): Promise<Result> {
    const before = await this.findProduct(id, user);
    await this.db.transaction((tx) => {
      tx.run('DELETE FROM products WHERE id = ?', [id]);
      auditBy(tx, user, { table: 'products', recordId: id, action: 'DELETE', before });
    });
    return { status: 204 };
  }

  // Sales

  private isAdmin(user: Row) {
    return user['role_name'] === ROLE_ADMIN;
  }

  /** Another employee's or organization's sale reads as missing, so ids cannot be probed. */
  private async findSale(id: string, user: Row): Promise<Row> {
    const [sale] = await this.db.query(
      `SELECT s.*, u.user_name FROM sales s JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.organization_id = ?`,
      [id, user['organization_id']],
    );
    if (!sale || (!this.isAdmin(user) && sale['user_id'] !== user['id'])) throw notFound('Sale');
    const items = await this.db.query(
      `SELECT d.*, p.product_name, p.product_barcode
         FROM sales_detail d JOIN products p ON p.id = d.product_id
        WHERE d.sales_id = ? ORDER BY p.product_name`,
      [id],
    );
    return { ...sale, items };
  }

  private async listSales({ params }: Context, user: Row): Promise<Result> {
    const [limit, offset] = this.page(params);
    const own = !this.isAdmin(user);
    return {
      body: await this.db.query(
        `SELECT s.*, u.user_name FROM sales s JOIN users u ON u.id = s.user_id
         WHERE s.organization_id = ? ${own ? 'AND s.user_id = ?' : ''}
         ORDER BY s.sales_date DESC, s.id LIMIT ? OFFSET ?`,
        own ? [user['organization_id'], user['id'], limit, offset] : [user['organization_id'], limit, offset],
      ),
    };
  }

  /** Prices come from the database rather than the request. */
  private async createSale({ body }: Context, user: Row): Promise<Result> {
    assertKnownFields(body, ['items', 'received_pay']);
    const { items, received_pay } = body;
    if (!Array.isArray(items) || items.length < 1 || items.length > 500 || !isMoney(received_pay)) throw invalid();

    const quantities = new Map<string, number>();
    for (const item of items as Row[]) {
      assertKnownFields(item, ['product_id', 'quantity']);
      if (!isText(item['product_id'], 36) || !item['product_id'] || !isWhole(item['quantity'], 1, 1000000)) throw invalid();
      quantities.set(item['product_id'], (quantities.get(item['product_id']) ?? 0) + item['quantity']);
    }

    const saleId = await this.db.transaction((tx) => {
      const ids = [...quantities.keys()];
      const products = tx.query(
        `SELECT id, product_name, product_sell_price, product_current_stock
           FROM products WHERE id IN (${ids.map(() => '?').join(', ')}) AND organization_id = ? ORDER BY id`,
        [...ids, user['organization_id']],
      );

      const found = new Set(products.map((product) => product['id']));
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'A product in the sale does not exist.', { missing });
      }

      const short = products.filter((p) => p['product_current_stock'] < quantities.get(p['id'])!);
      if (short.length > 0) {
        throw new ApiError(409, 'INSUFFICIENT_STOCK', 'There is not enough stock for this sale.', {
          products: short.map((p) => ({
            product_id: p['id'],
            product_name: p['product_name'],
            available: p['product_current_stock'],
            requested: quantities.get(p['id']),
          })),
        });
      }

      const lines = products.map((product) => {
        const quantity = quantities.get(product['id'])!;
        return { product, quantity, subtotalCents: toCents(product['product_sell_price']) * quantity };
      });
      const totalCents = lines.reduce((sum, line) => sum + line.subtotalCents, 0);
      const receivedCents = toCents(received_pay);
      if (receivedCents < totalCents) {
        throw new ApiError(422, 'INSUFFICIENT_PAYMENT', 'The payment does not cover the total.', {
          total: totalCents / 100,
          received: received_pay,
        });
      }

      const id = crypto.randomUUID();
      tx.run(
        `INSERT INTO sales (id, organization_id, user_id, sales_total, sales_received_pay, sales_change, sales_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, user['organization_id'], user['id'], totalCents / 100, received_pay, (receivedCents - totalCents) / 100, new Date().toISOString()],
      );
      for (const { product, quantity, subtotalCents } of lines) {
        tx.run(
          `INSERT INTO sales_detail (id, sales_id, product_id, detail_quantity, detail_unit_price, detail_subtotal)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), id, product['id'], quantity, product['product_sell_price'], subtotalCents / 100],
        );
        tx.run('UPDATE products SET product_current_stock = product_current_stock - ? WHERE id = ?', [quantity, product['id']]);
      }
      auditBy(tx, user, {
        table: 'sales', recordId: id, action: 'INSERT',
        after: {
          sales_total: totalCents / 100,
          sales_received_pay: received_pay,
          items: lines.map(({ product, quantity }) => ({ product_id: product['id'], quantity })),
        },
      });
      return id;
    });

    return { status: 201, body: await this.findSale(saleId, user) };
  }

  // Inventory

  private readonly ADJUSTMENT = `
    SELECT a.*, p.product_name, u.user_name
      FROM inventory_adjustments a
      JOIN products p ON p.id = a.product_id
      JOIN users u ON u.id = a.user_id`;

  private async listAdjustments({ params }: Context, user: Row): Promise<Result> {
    const [limit, offset] = this.page(params);
    const productId = params.get('product_id');
    return {
      body: await this.db.query(
        `${this.ADJUSTMENT}
         WHERE a.organization_id = ? ${productId ? 'AND a.product_id = ?' : ''}
         ORDER BY a.adj_date DESC, a.id LIMIT ? OFFSET ?`,
        productId ? [user['organization_id'], productId, limit, offset] : [user['organization_id'], limit, offset],
      ),
    };
  }

  private async createAdjustment({ body }: Context, user: Row): Promise<Result> {
    assertKnownFields(body, ['product_id', 'adj_type', 'adj_new_amount', 'adj_quantity', 'adj_motive']);
    const { product_id, adj_type, adj_new_amount, adj_quantity, adj_motive } = body;
    if (!isText(product_id, 36) || !product_id) throw invalid();
    if (!isText(adj_type, 50) || !adj_type.trim()) throw invalid();
    if ((adj_new_amount === undefined) === (adj_quantity === undefined)) {
      throw invalid('Send either adj_new_amount or adj_quantity');
    }
    if (adj_new_amount !== undefined && !isWhole(adj_new_amount, 0, MAX_STOCK)) throw invalid();
    if (adj_quantity !== undefined && (!isWhole(adj_quantity, -MAX_STOCK, MAX_STOCK) || adj_quantity === 0)) throw invalid();
    if (adj_motive !== undefined && adj_motive !== null && !isText(adj_motive, 5000)) throw invalid();

    const id = crypto.randomUUID();
    await this.db.transaction((tx) => {
      const [product] = tx.query(
        'SELECT product_current_stock FROM products WHERE id = ? AND organization_id = ?', [product_id, user['organization_id']],
      );
      if (!product) throw notFound('Product');

      const previous = product['product_current_stock'];
      const newAmount = adj_new_amount ?? previous + adj_quantity;
      if (newAmount < 0) {
        throw new ApiError(409, 'STOCK_WOULD_BE_NEGATIVE', 'There is not enough stock to subtract that amount.', { available: previous });
      }
      if (newAmount > MAX_STOCK) throw invalid('The resulting stock is too large.');

      tx.run(
        `INSERT INTO inventory_adjustments
           (id, organization_id, product_id, user_id, adj_type, adj_previous_amount, adj_new_amount, adj_motive, adj_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, user['organization_id'], product_id, user['id'], adj_type.trim(), previous, newAmount,
          adj_motive?.trim() || null, new Date().toISOString()],
      );
      tx.run('UPDATE products SET product_current_stock = ? WHERE id = ?', [newAmount, product_id]);
      auditBy(tx, user, {
        table: 'products', recordId: product_id, action: 'UPDATE',
        before: { product_current_stock: previous },
        after: { product_current_stock: newAmount, adjustment_id: id, adj_type: adj_type.trim() },
      });
    });

    const [adjustment] = await this.db.query(`${this.ADJUSTMENT} WHERE a.id = ?`, [id]);
    return { status: 201, body: adjustment };
  }

  // Dashboard

  private async dashboard(user: Row): Promise<Result> {
    const org = user['organization_id'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today);
    monthStart.setDate(monthStart.getDate() - 29);
    const since = [today.toISOString(), monthStart.toISOString()];

    const [users] = await this.db.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(user_state = 'activo'), 0) AS active FROM users WHERE organization_id = ?`, [org],
    );
    const [products] = await this.db.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(product_current_stock <= product_min_stock), 0) AS low_stock,
              COALESCE(SUM(product_current_stock = 0), 0) AS out_of_stock,
              COALESCE(SUM(product_current_stock * product_costs), 0) AS inventory_cost
         FROM products WHERE organization_id = ?`,
      [org],
    );
    const salesSince = async (date: string) => {
      const [row] = await this.db.query(
        'SELECT COUNT(*) AS count, COALESCE(SUM(sales_total), 0) AS total FROM sales WHERE organization_id = ? AND sales_date >= ?',
        [org, date],
      );
      return { count: row['count'], total: round(row['total']) };
    };

    return {
      body: {
        users,
        products: { ...products, inventory_cost: round(products['inventory_cost']) },
        sales: { today: await salesSince(since[0]), last_30_days: await salesSince(since[1]) },
        low_stock_products: await this.db.query(
          `SELECT id, product_name, product_brand, product_current_stock, product_min_stock
             FROM products WHERE organization_id = ? AND product_current_stock <= product_min_stock
            ORDER BY product_current_stock - product_min_stock, product_name COLLATE NOCASE LIMIT ?`,
          [org, LOW_STOCK_LIST_SIZE],
        ),
        recent_sales: await this.db.query(
          `SELECT s.id, s.sales_total, s.sales_date, u.user_name
             FROM sales s JOIN users u ON u.id = s.user_id
            WHERE s.organization_id = ?
            ORDER BY s.sales_date DESC, s.id LIMIT ?`,
          [org, LIST_SIZE],
        ),
        top_products: (await this.db.query(
          `SELECT p.id, p.product_name, SUM(d.detail_quantity) AS quantity, SUM(d.detail_subtotal) AS revenue
             FROM sales_detail d
             JOIN sales s ON s.id = d.sales_id
             JOIN products p ON p.id = d.product_id
            WHERE s.organization_id = ? AND s.sales_date >= ?
            GROUP BY p.id, p.product_name
            ORDER BY quantity DESC, p.product_name COLLATE NOCASE LIMIT ?`,
          [org, since[1], LIST_SIZE],
        )).map((row) => ({ ...row, revenue: round(row['revenue']) })),
        recent_adjustments: await this.db.query(
          `SELECT a.id, a.adj_type, a.adj_previous_amount, a.adj_new_amount, a.adj_date, p.product_name, u.user_name
             FROM inventory_adjustments a
             JOIN products p ON p.id = a.product_id
             JOIN users u ON u.id = a.user_id
            WHERE a.organization_id = ?
            ORDER BY a.adj_date DESC, a.id LIMIT ?`,
          [org, LIST_SIZE],
        ),
      },
    };
  }
}
