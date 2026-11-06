import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { hashPassword, verifyPassword } from '../passwords.js';

// Policy from the project spec: 8+ chars with lower, upper, digit and symbol.
// The 72-char cap matches bcrypt's input limit.
export const newPassword = z
  .string()
  .min(8)
  .max(72)
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/, 'Password does not meet complexity requirements.');

const loginSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(150),
  password: z.string().max(72),
});

const changePasswordSchema = z.strictObject({
  current_password: z.string().max(72),
  new_password: newPassword,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res, next) =>
    next(new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many login attempts. Try again later.')),
});

export const authRouter = Router();

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const [rows] = await pool.query(
    `SELECT u.id, u.user_name, u.user_email, u.user_state, u.user_pass_hash, u.role_id, r.role_name
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.user_email = ?`,
    [email],
  );
  const user = rows[0];
  const valid = await verifyPassword(password, user?.user_pass_hash ?? null);
  if (!valid || user.user_state !== 'activo') {
    throw new HttpError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials.');
  }

  const { user_pass_hash: _omitted, ...publicUser } = user;
  res.json({ token: signToken(user.id), user: publicUser });
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
  res.status(204).end();
});
