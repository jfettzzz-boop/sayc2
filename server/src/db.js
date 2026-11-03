import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.db,
  connectionLimit: 10,
  charset: 'utf8mb4',
  // DECIMAL columns come back as numbers rather than strings.
  decimalNumbers: true,
  // A value that is unexpectedly an object must never expand into SQL fragments.
  stringifyObjects: true,
});

/** Runs fn inside a transaction, committing on success and rolling back on any throw. */
export async function withTransaction(fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
