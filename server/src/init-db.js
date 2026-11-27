import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { hashPlaintextPasswords } from './passwords.js';

const SCHEMA_URL = new URL('../../database/schema.sql', import.meta.url);

/** Splits schema.sql into statements. Its statements end a line with ";" and its seed text has none. */
export function schemaStatements(sql) {
  return sql
    .replace(/^--.*$/gm, '')
    .split(/;\s*$/m)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * What a hosted database needs from schema.sql. The statements that drop and create sayc_db are
 * left out: a hosted database already exists, under whatever name the provider gave it.
 * 'schema' keeps the tables and the roles every company shares; 'demo' also keeps the sample companies.
 */
export function initStatements(sql, mode) {
  return schemaStatements(sql).filter((statement) => {
    if (/^(DROP|CREATE) DATABASE|^USE /i.test(statement)) return false;
    if (mode === 'demo' || /^CREATE TABLE/i.test(statement)) return true;
    return /^INSERT INTO roles\b/i.test(statement);
  });
}

/**
 * Creates the tables when the database has none yet, so a new deployment needs no manual SQL.
 * A database that already has them is never touched. Returns whether it created them.
 */
export async function initDatabaseIfEmpty(dbConfig, mode) {
  if (mode !== 'schema' && mode !== 'demo') return false;

  const connection = await mysql.createConnection({ ...dbConfig, multipleStatements: true, charset: 'utf8mb4' });
  try {
    const statements = initStatements(await readFile(SCHEMA_URL, 'utf8'), mode);
    const wanted = statements
      .map((statement) => /^CREATE TABLE (\w+)/i.exec(statement)?.[1])
      .filter(Boolean);
    const [existing] = await connection.query(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?)',
      [wanted],
    );
    if (existing.length === wanted.length) return false;
    if (existing.length > 0) {
      // Table creation can't be rolled back, so an interrupted first start leaves some behind.
      throw new Error(
        `The database has only some SAYC tables (${existing.map((t) => t.name).join(', ')}). ` +
          'Empty it and restart, or load database/schema.sql by hand.',
      );
    }

    await connection.query(statements.map((statement) => `${statement};`).join('\n'));
    // The sample users' passwords are stored in plaintext in schema.sql.
    if (mode === 'demo') await hashPlaintextPasswords(connection);
    return true;
  } finally {
    await connection.end();
  }
}
