import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';

export const ROLE_ADMIN = 'Administrador';

export function signToken(userId) {
  return jwt.sign({}, config.jwt.secret, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: config.jwt.expiresIn,
  });
}

const unauthorized = () => new HttpError(401, 'AUTH_REQUIRED', 'A valid session is required.');

/**
 * Loads the user from the database on every request, so deactivating a user or
 * changing their role takes effect immediately rather than when the token expires.
 */
export async function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();

  let userId;
  try {
    userId = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] }).sub;
  } catch {
    throw unauthorized();
  }

  const [rows] = await pool.query(
    `SELECT u.id, u.user_name, u.user_email, u.user_state, u.role_id, r.role_name
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?`,
    [userId],
  );
  if (rows.length === 0 || rows[0].user_state !== 'activo') throw unauthorized();

  req.user = rows[0];
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user.role_name !== ROLE_ADMIN) {
    throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to do this.');
  }
  next();
}
