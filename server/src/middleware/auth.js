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

/**
 * The user as the API describes a session: their role and organization, never the hash.
 * Every route scopes its queries by organization_id, so a user only sees their company.
 */
export const SESSION_USER = `
  SELECT u.id, u.user_name, u.user_email, u.user_state, u.role_id, r.role_name,
         u.organization_id, o.org_name, o.org_state
    FROM users u
    JOIN roles r ON r.id = u.role_id
    JOIN organizations o ON o.id = u.organization_id`;

/** An inactive user, or anyone in an inactive organization, has no access. */
export const canSignIn = (user) => user.user_state === 'activo' && user.org_state === 'activo';

const unauthorized = () => new HttpError(401, 'AUTH_REQUIRED', 'A valid session is required.');

/**
 * Loads the user from the database on every request, so deactivating a user or their
 * organization, or changing their role, takes effect immediately rather than when the token expires.
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

  const [rows] = await pool.query(`${SESSION_USER} WHERE u.id = ?`, [userId]);
  if (rows.length === 0 || !canSignIn(rows[0])) throw unauthorized();

  const { org_state: _omitted, ...user } = rows[0];
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user.role_name !== ROLE_ADMIN) {
    throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to do this.');
  }
  next();
}
