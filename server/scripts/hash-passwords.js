// Run once after loading database/schema.sql, whose seed users have plaintext passwords.
// Safe to run repeatedly: values that are already bcrypt hashes are left alone.
import { pool } from '../src/db.js';
import { hashPlaintextPasswords } from '../src/passwords.js';

try {
  const changed = await hashPlaintextPasswords(pool);
  console.log(`Hashed ${changed} plaintext password(s).`);
} finally {
  await pool.end();
}
