import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { audit } from '../audit.js';
import { pool, withTransaction } from '../db.js';
import { HttpError } from '../errors.js';
import { ROLE_ADMIN, SESSION_USER, canSignIn, requireAuth, signToken } from '../middleware/auth.js';
import { hashPassword, verifyPassword } from '../passwords.js';

export const newPassword = z.string().min(8).max(72);
export const email = z.email().trim().toLowerCase().max(150);

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();

const loginSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(150),
  password: z.string().max(72),
});

const changePasswordSchema = z.strictObject({
  current_password: z.string().max(72),
  new_password: newPassword,
});

const registerSchema = z.strictObject({
  organization: z.strictObject({
    org_name: z.string().trim().min(1).max(150),
    org_email: email,
    org_tax_id: optionalText(30),
    org_phone: optionalText(30),
    org_address: optionalText(255),
  }),
  user: z.strictObject({
    user_name: z.string().trim().min(1).max(100),
    user_email: email,
    password: newPassword,
  }),
});

const limiter = (limit, message, options = {}) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    ...options,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res, next) => next(new HttpError(429, 'TOO_MANY_ATTEMPTS', message)),
  });

const loginLimiter = limiter(20, 'Too many login attempts. Try again later.');
// Counts organizations created, not attempts, so a mistyped form doesn't use up the limit.
const registerLimiter = limiter(5, 'Too many registrations. Try again later.', { skipFailedRequests: true });

async function sessionUser(db, userId) {
  const [rows] = await db.query(`${SESSION_USER} WHERE u.id = ?`, [userId]);
  const { org_state: _omitted, ...user } = rows[0];
  return user;
}

export const authRouter = Router();

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const [rows] = await pool.query(
    `SELECT u.user_pass_hash, s.*
       FROM users u JOIN (${SESSION_USER}) s ON s.id = u.id
      WHERE u.user_email = ?`,
    [email],
  );
  const user = rows[0];
  const valid = await verifyPassword(password, user?.user_pass_hash ?? null);
  if (!valid || !canSignIn(user)) {
    throw new HttpError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials.');
  }

  const { user_pass_hash: _hash, org_state: _state, ...publicUser } = user;
  res.json({ token: signToken(user.id), user: publicUser });
});

// Registers a company and its first administrator together, and signs that user in.
authRouter.post('/register', registerLimiter, async (req, res) => {
  const { organization, user } = registerSchema.parse(req.body);
  const organizationId = randomUUID();
  const userId = randomUUID();
  const passHash = await hashPassword(user.password);

  const created = await withTransaction(async (connection) => {
    const [[adminRole]] = await connection.query('SELECT id FROM roles WHERE role_name = ?', [ROLE_ADMIN]);
    await connection.query(
      `INSERT INTO organizations (id, org_name, org_email, org_tax_id, org_phone, org_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        organizationId,
        organization.org_name,
        organization.org_email,
        organization.org_tax_id ?? null,
        organization.org_phone ?? null,
        organization.org_address ?? null,
      ],
    );
    try {
      await connection.query(
        `INSERT INTO users (id, organization_id, user_name, user_email, user_pass_hash, role_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, organizationId, user.user_name, user.user_email, passHash, adminRole.id],
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw new HttpError(409, 'AUTH_EMAIL_ALREADY_REGISTERED', 'That email is already registered.');
      }
      throw err;
    }

    const [[org]] = await connection.query('SELECT * FROM organizations WHERE id = ?', [organizationId]);
    const sessionData = await sessionUser(connection, userId);
    const entry = { organizationId, userId, action: 'INSERT' };
    await audit(connection, { ...entry, table: 'organizations', recordId: organizationId, after: org });
    await audit(connection, {
      ...entry,
      table: 'users',
      recordId: userId,
      after: { id: userId, user_name: user.user_name, user_email: user.user_email, role_id: adminRole.id },
    });
    return sessionData;
  });

  res.status(201).json({ token: signToken(userId), user: created });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password } = changePasswordSchema.parse(req.body);

  const [rows] = await pool.query('SELECT user_pass_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await verifyPassword(current_password, rows[0]?.user_pass_hash ?? null))) {
    throw new HttpError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials.');
  }

  await pool.query('UPDATE users SET user_pass_hash = ? WHERE id = ?', [
    await hashPassword(new_password),
    req.user.id,
  ]);
  await audit(pool, {
    organizationId: req.user.organization_id,
    userId: req.user.id,
    table: 'users',
    recordId: req.user.id,
    action: 'UPDATE',
    // The hash itself is never logged; the entry only records that the password changed.
    after: { password_changed: true },
  });
  res.status(204).end();
});
