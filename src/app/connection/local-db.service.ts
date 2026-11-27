import { Injectable, InjectionToken, inject } from '@angular/core';
import type { Database, SqlValue } from 'sql.js';

const STORAGE_DB = 'sayc-local';
const STORAGE_STORE = 'files';
const STORAGE_KEY = 'database';
/** Raised when the tables change. A database saved by an older version is replaced. */
const SCHEMA_VERSION = 2;

export type Row = Record<string, any>;
export type Param = string | number | boolean | null | undefined;

export interface DatabaseStorage {
  load(): Promise<Uint8Array | null>;
  save(data: Uint8Array): Promise<void>;
}

/** Keeps the database file in IndexedDB, which survives closing the app. */
class IndexedDbStorage implements DatabaseStorage {
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(STORAGE_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORAGE_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async load(): Promise<Uint8Array | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORAGE_STORE).objectStore(STORAGE_STORE).get(STORAGE_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async save(data: Uint8Array): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORAGE_STORE, 'readwrite');
      transaction.objectStore(STORAGE_STORE).put(data, STORAGE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

export interface LocalDbConfig {
  storage?: DatabaseStorage;
  /** Lets tests supply the engine directly, where there is no server to fetch it from. */
  wasmBinary?: ArrayBuffer;
}

export const LOCAL_DB_CONFIG = new InjectionToken<LocalDbConfig>('LOCAL_DB_CONFIG', {
  providedIn: 'root',
  factory: () => ({}),
});

// The same tables and columns as database/schema.sql, in SQLite's dialect. Dates are ISO
// strings in UTC, and money is REAL, summed in cents wherever it's calculated.
const SCHEMA = `
  CREATE TABLE organizations (
    id TEXT PRIMARY KEY,
    org_name TEXT NOT NULL,
    org_tax_id TEXT,
    org_email TEXT NOT NULL,
    org_phone TEXT,
    org_address TEXT,
    org_state TEXT NOT NULL DEFAULT 'activo',
    org_created_at TEXT NOT NULL,
    org_updated_at TEXT NOT NULL
  );
  CREATE TABLE roles (
    id TEXT PRIMARY KEY,
    role_name TEXT NOT NULL UNIQUE,
    role_description TEXT
  );
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    user_name TEXT NOT NULL,
    user_email TEXT NOT NULL UNIQUE,
    user_pass_hash TEXT NOT NULL,
    role_id TEXT NOT NULL REFERENCES roles(id),
    user_state TEXT DEFAULT 'activo',
    user_created_at TEXT NOT NULL,
    user_updated_at TEXT NOT NULL
  );
  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    product_barcode TEXT,
    product_name TEXT NOT NULL,
    product_brand TEXT,
    product_description TEXT,
    product_sell_price REAL NOT NULL,
    product_costs REAL DEFAULT 0,
    product_current_stock INTEGER DEFAULT 0,
    product_min_stock INTEGER DEFAULT 5,
    product_api_origin INTEGER DEFAULT 0,
    product_img_url TEXT,
    product_created_at TEXT NOT NULL,
    product_updated_at TEXT NOT NULL,
    UNIQUE (organization_id, product_barcode)
  );
  CREATE TABLE sales (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    sales_total REAL NOT NULL,
    sales_received_pay REAL NOT NULL,
    sales_change REAL NOT NULL,
    sales_date TEXT NOT NULL
  );
  CREATE TABLE sales_detail (
    id TEXT PRIMARY KEY,
    sales_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    detail_quantity INTEGER NOT NULL,
    detail_unit_price REAL NOT NULL,
    detail_subtotal REAL NOT NULL
  );
  CREATE TABLE inventory_adjustments (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    adj_type TEXT NOT NULL,
    adj_previous_amount INTEGER NOT NULL,
    adj_new_amount INTEGER NOT NULL,
    adj_motive TEXT,
    adj_date TEXT NOT NULL
  );
  CREATE TABLE product_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    price_previous REAL,
    price_new REAL NOT NULL,
    cost_previous REAL,
    cost_new REAL NOT NULL,
    price_changed_at TEXT NOT NULL
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    user_id TEXT REFERENCES users(id),
    audit_table TEXT NOT NULL,
    audit_record_id TEXT NOT NULL,
    audit_action TEXT NOT NULL,
    audit_old TEXT,
    audit_new TEXT,
    audit_date TEXT NOT NULL
  );
`;

const DON_PEPE = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ESPERANZA = '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
const ADMIN_ROLE = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const EMPLOYEE_ROLE = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const ADMIN_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
const EMPLOYEE_ID = 'd4e5f6a7-b8c9-0123-defa-234567890123';
const ESPERANZA_ADMIN = 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b';
const ESPERANZA_CASHIER = 'f2a3b4c5-d6e7-4f8a-9b0c-1d2e3f4a5b6c';
const COCA = 'e5f6a7b8-c9d0-1234-efab-345678901234';
const SABRITAS = 'f6a7b8c9-d0e1-2345-fabc-456789012345';
const HUEVO = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d02';
const ATUN = 'c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e02';
const CAFE = 'c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e03';
const SALE = 'b8c9d0e1-f2a3-4678-bcde-678901234567';
const ESPERANZA_SALE = 'e4f5a6b7-c8d9-4e0f-1a2b-3c4d5e6f7a01';

/** The same test data as database/schema.sql, so testing on a device matches testing on a server. */
async function seed(db: Database) {
  const bcrypt = (await import('bcryptjs')).default;
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 1000).toISOString();
  const password = await bcrypt.hash('admin123', 10);

  const insertOrg = `INSERT INTO organizations
    (id, org_name, org_tax_id, org_email, org_phone, org_address, org_created_at, org_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(insertOrg, [DON_PEPE, 'Abarrotes Don Pepe', 'ADP010101AB1', 'contacto@donpepe.mx', '5551234567', 'Av. Juárez 120, Centro', now, now]);
  db.run(insertOrg, [ESPERANZA, 'Minisúper La Esperanza', 'MLE020202CD2', 'hola@laesperanza.mx', '5559876543', 'Calle Hidalgo 45, Col. Del Valle', now, now]);

  db.run('INSERT INTO roles VALUES (?, ?, ?)', [ADMIN_ROLE, 'Administrador', 'Control total del sistema y configuraciones']);
  db.run('INSERT INTO roles VALUES (?, ?, ?)', [EMPLOYEE_ROLE, 'Empleado', 'Acceso al módulo de ventas e inventario básico']);

  const insertUser = `INSERT INTO users
    (id, organization_id, user_name, user_email, user_pass_hash, role_id, user_state, user_created_at, user_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'activo', ?, ?)`;
  db.run(insertUser, [ADMIN_ID, DON_PEPE, 'Administrador 1', 'admin@sayc.com', password, ADMIN_ROLE, now, now]);
  db.run(insertUser, [EMPLOYEE_ID, DON_PEPE, 'Empleado 1', 'empleado@sayc.com', password, EMPLOYEE_ROLE, now, now]);
  db.run(insertUser, [ESPERANZA_ADMIN, ESPERANZA, 'Laura Méndez', 'admin@laesperanza.mx', password, ADMIN_ROLE, now, now]);
  db.run(insertUser, [ESPERANZA_CASHIER, ESPERANZA, 'Jorge Ruiz', 'cajero@laesperanza.mx', password, EMPLOYEE_ROLE, now, now]);

  const products: [string, string, string, string, string, string, number, number, number, number, string | null][] = [
    [COCA, DON_PEPE, '7501001112223', 'Coca Cola 600ml', 'Coca Cola', 'Refresco de cola no retornable', 18, 12, 25, 5,
      'https://tse3.mm.bing.net/th/id/OIP.TUaLsx-PqOHIyOfWZwxRxQHaHa?r=0&rs=1&pid=ImgDetMain&o=7&rm=3'],
    [SABRITAS, DON_PEPE, '7501003334445', 'Sabritas Original 45g', 'Sabritas', 'Papas fritas con sal', 17.5, 10, 15, 4,
      'https://cdn.shopify.com/s/files/1/0105/9212/4964/products/190_1600x.jpg?v=1579317290'],
    ['a7b8c9d0-e1f2-3456-abcd-567890123456', DON_PEPE, '7501005556667', 'Leche Entera 1L', 'Lala', 'Leche pasteurizada entera', 28, 22, 0, 3,
      'https://i5.walmartimages.com.mx/gr/images/product-images/img_large/00750179162193L.jpg?odnHeight=612&odnWidth=612&odnBg=FFFFFF'],
    ['b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d01', DON_PEPE, '7501000111206', 'Pan Blanco Grande', 'Bimbo', 'Pan de caja 680 g', 52, 41, 8, 3, null],
    [HUEVO, DON_PEPE, '7501052474403', 'Huevo Blanco 12 pzas', 'Bachoco', 'Docena de huevo blanco', 45, 36, 2, 4, null],
    ['c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e01', ESPERANZA, '7501001112223', 'Coca Cola 600ml', 'Coca Cola', 'Refresco de cola no retornable', 19, 12.5, 40, 10, null],
    [ATUN, ESPERANZA, '7501030426165', 'Atún en Agua 140g', 'Dolores', 'Atún aleta amarilla en agua', 24, 17, 30, 6, null],
    [CAFE, ESPERANZA, '7501008042953', 'Café Soluble 120g', 'Nescafé', 'Café clásico soluble', 89, 70, 5, 5, null],
  ];
  const insertProduct = `INSERT INTO products
    (id, organization_id, product_barcode, product_name, product_brand, product_description, product_sell_price, product_costs,
     product_current_stock, product_min_stock, product_img_url, product_created_at, product_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const insertPrice = `INSERT INTO product_price_history
    (organization_id, product_id, user_id, price_previous, price_new, cost_previous, cost_new, price_changed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  for (const product of products) {
    db.run(insertProduct, [...product, now, now]);
    const [id, org, , , , , price, cost] = product;
    db.run(insertPrice, [org, id, org === DON_PEPE ? ADMIN_ID : ESPERANZA_ADMIN, null, price, null, cost, now]);
  }
  db.run(insertPrice, [DON_PEPE, COCA, ADMIN_ID, 17, 18, 11.5, 12, later]);

  const insertSale = 'INSERT INTO sales VALUES (?, ?, ?, ?, ?, ?, ?)';
  db.run(insertSale, [SALE, DON_PEPE, EMPLOYEE_ID, 53.5, 100, 46.5, now]);
  db.run(insertSale, [ESPERANZA_SALE, ESPERANZA, ESPERANZA_CASHIER, 72, 100, 28, now]);
  db.run('INSERT INTO sales_detail VALUES (?, ?, ?, ?, ?, ?)', ['c9d0e1f2-a3b4-5789-cdef-789012345678', SALE, COCA, 2, 18, 36]);
  db.run('INSERT INTO sales_detail VALUES (?, ?, ?, ?, ?, ?)', ['d0e1f2a3-b4c5-6890-defa-890123456789', SALE, SABRITAS, 1, 17.5, 17.5]);
  db.run('INSERT INTO sales_detail VALUES (?, ?, ?, ?, ?, ?)', ['f5a6b7c8-d9e0-4f1a-2b3c-4d5e6f7a8b01', ESPERANZA_SALE, ATUN, 3, 24, 72]);

  const insertAdjustment = `INSERT INTO inventory_adjustments
    (id, organization_id, product_id, user_id, adj_type, adj_previous_amount, adj_new_amount, adj_motive, adj_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(insertAdjustment, ['a6b7c8d9-e0f1-4a2b-3c4d-5e6f7a8b9c01', DON_PEPE, HUEVO, EMPLOYEE_ID, 'merma', 4, 2, 'Dos piezas rotas al recibir', now]);
  db.run(insertAdjustment, ['a6b7c8d9-e0f1-4a2b-3c4d-5e6f7a8b9c02', ESPERANZA, CAFE, ESPERANZA_ADMIN, 'entrada', 0, 5, 'Compra a proveedor', now]);

  const insertAudit = `INSERT INTO audit_log
    (organization_id, user_id, audit_table, audit_record_id, audit_action, audit_old, audit_new, audit_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(insertAudit, [DON_PEPE, ADMIN_ID, 'organizations', DON_PEPE, 'INSERT', null,
    JSON.stringify({ org_name: 'Abarrotes Don Pepe' }), now]);
  db.run(insertAudit, [ESPERANZA, ESPERANZA_ADMIN, 'organizations', ESPERANZA, 'INSERT', null,
    JSON.stringify({ org_name: 'Minisúper La Esperanza' }), now]);
  db.run(insertAudit, [DON_PEPE, ADMIN_ID, 'products', COCA, 'UPDATE',
    JSON.stringify({ product_sell_price: 17, product_costs: 11.5 }), JSON.stringify({ product_sell_price: 18, product_costs: 12 }), now]);
}

@Injectable({ providedIn: 'root' })
export class LocalDbService {
  private readonly config = inject(LOCAL_DB_CONFIG);
  private readonly storage = this.config.storage ?? new IndexedDbStorage();
  private database?: Promise<Database>;
  private saving: Promise<void> = Promise.resolve();

  /** Opens the database on first use, so a server connection never loads the SQLite engine. */
  ready(): Promise<Database> {
    this.database ??= this.open();
    return this.database;
  }

  private async open(): Promise<Database> {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs(
      this.config.wasmBinary
        ? { wasmBinary: this.config.wasmBinary }
        : { locateFile: (file: string) => `assets/sqljs/${file}` },
    );

    const saved = await this.storage.load();
    let db = new SQL.Database(saved ?? undefined);
    // This mode holds test data only, so an older layout is started over rather than migrated.
    const current = saved !== null && db.exec('PRAGMA user_version')[0]?.values[0][0] === SCHEMA_VERSION;
    if (saved && !current) {
      db.close();
      db = new SQL.Database();
    }
    db.run('PRAGMA foreign_keys = ON');

    if (!current) {
      db.run(SCHEMA);
      await seed(db);
      db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      await this.persist(db);
    }
    return db;
  }

  async query(sql: string, params: Param[] = []): Promise<Row[]> {
    return this.select(await this.ready(), sql, params);
  }

  /** Runs a change and saves the database. */
  async run(sql: string, params: Param[] = []): Promise<void> {
    const db = await this.ready();
    db.run(sql, this.bind(params));
    await this.persist(db);
  }

  /** All of fn's changes apply and are saved together, or none do. */
  async transaction<T>(fn: (tx: LocalTransaction) => T): Promise<T> {
    const db = await this.ready();
    const tx: LocalTransaction = {
      query: (sql, params = []) => this.select(db, sql, params),
      run: (sql, params = []) => db.run(sql, this.bind(params)),
    };

    db.run('BEGIN');
    let result: T;
    try {
      result = fn(tx);
      db.run('COMMIT');
    } catch (err) {
      db.run('ROLLBACK');
      throw err;
    }
    await this.persist(db);
    return result;
  }

  private select(db: Database, sql: string, params: Param[]): Row[] {
    const statement = db.prepare(sql);
    try {
      statement.bind(this.bind(params));
      const rows: Row[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }

  private bind(params: Param[]): SqlValue[] {
    return params.map((value) => {
      if (value === undefined) return null;
      if (typeof value === 'boolean') return value ? 1 : 0;
      return value;
    });
  }

  /** Saves in order, so a slow save can't overwrite a newer one. */
  private persist(db: Database): Promise<void> {
    const data = db.export();
    // Exporting resets SQLite's per-connection settings.
    db.run('PRAGMA foreign_keys = ON');
    this.saving = this.saving.then(() => this.storage.save(data));
    return this.saving;
  }
}

export interface LocalTransaction {
  query(sql: string, params?: Param[]): Row[];
  run(sql: string, params?: Param[]): void;
}
