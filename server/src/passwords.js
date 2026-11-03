import bcrypt from 'bcryptjs';

const COST = 12;
const BCRYPT_PREFIX = /^\$2[aby]\$/;

// Compared against when the email is unknown, so login takes the same time either way.
const DUMMY_HASH = bcrypt.hashSync('sayc-timing-placeholder', COST);

export const hashPassword = (password) => bcrypt.hash(password, COST);

/** Accepts null for the hash when no user matched. Plaintext stored values never match. */
export async function verifyPassword(password, hash) {
  const isHash = typeof hash === 'string' && BCRYPT_PREFIX.test(hash);
  const matches = await bcrypt.compare(password, isHash ? hash : DUMMY_HASH);
  return isHash && matches;
}

/**
 * database/schema.sql seeds user_pass_hash with plaintext passwords. This replaces any
 * value that is not already a bcrypt hash with its hash. Returns the number of users changed.
 */
export async function hashPlaintextPasswords(pool) {
  const [users] = await pool.query('SELECT id, user_pass_hash FROM users');
  const plaintext = users.filter((user) => !BCRYPT_PREFIX.test(user.user_pass_hash));
  for (const user of plaintext) {
    await pool.query('UPDATE users SET user_pass_hash = ? WHERE id = ?', [
      await hashPassword(user.user_pass_hash),
      user.id,
    ]);
  }
  return plaintext.length;
}
