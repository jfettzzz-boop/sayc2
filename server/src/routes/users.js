import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { hashPassword } from '../passwords.js';
import { id, pagination, setClause } from '../validation.js';
import { newPassword } from './auth.js';

const STATES = ['activo', 'inactivo'];

const createSchema = z.strictObject({
  user_name: z.string().trim().min(1).max(100),
  user_email: z.email().trim().toLowerCase().max(150),
  password: newPassword,
  role_id: id,
});

const updateSchema = createSchema
  .partial()
  .extend({ user_state: z.enum(STATES).optional() })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

const listSchema = z.object({ ...pagination });

// Never selects user_pass_hash: every user response is built from these columns.
const PUBLIC_USER = `
  SELECT u.id, u.user_name, u.user_email, u.user_state, u.role_id, r.role_name,
         u.user_created_at, u.user_updated_at
    FROM users u JOIN roles r ON r.id = u.role_id`;

async function findUser(userId) {
  const [rows] = await pool.query(`${PUBLIC_USER} WHERE u.id = ?`, [userId]);
  if (rows.length === 0) throw notFound('User');
  return rows[0];
}

const emailTaken = () =>
  new HttpError(409, 'AUTH_EMAIL_ALREADY_REGISTERED', 'That email is already registered.');

export const usersRouter = Router();
usersRouter.use(requireAuth, requireAdmin);

usersRouter.get('/', async (req, res) => {
  const { limit, offset } = listSchema.parse(req.query);
  const [rows] = await pool.query(
    `${PUBLIC_USER} ORDER BY u.user_created_at DESC, u.id LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  res.json(rows);
});

usersRouter.get('/:id', async (req, res) => {
  res.json(await findUser(req.params.id));
});

usersRouter.post('/', async (req, res) => {
  const { password, ...data } = createSchema.parse(req.body);
  const userId = randomUUID();
  try {
    await pool.query(
      `INSERT INTO users (id, user_name, user_email, user_pass_hash, role_id)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, data.user_name, data.user_email, await hashPassword(password), data.role_id],
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw emailTaken();
    throw err;
  }
  res.status(201).json(await findUser(userId));
});

usersRouter.patch('/:id', async (req, res) => {
  const { password, ...data } = updateSchema.parse(req.body);

  // Keeps the last administrator from locking everyone out by accident.
  if (req.params.id === req.user.id && (data.role_id || data.user_state)) {
    throw new HttpError(409, 'CANNOT_MODIFY_SELF', 'You cannot change your own role or state.');
  }

  const columns = { ...data };
  if (password) columns.user_pass_hash = await hashPassword(password);
  const { sql, values } = setClause(columns);

  await findUser(req.params.id);
  try {
    await pool.query(`UPDATE users SET ${sql} WHERE id = ?`, [...values, req.params.id]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw emailTaken();
    throw err;
  }
  res.json(await findUser(req.params.id));
});

// Users are referenced by sales and inventory history, so "delete" deactivates them.
usersRouter.delete('/:id', async (req, res) => {
  if (req.params.id === req.user.id) {
    throw new HttpError(409, 'CANNOT_MODIFY_SELF', 'You cannot deactivate your own account.');
  }
  await findUser(req.params.id);
  await pool.query(`UPDATE users SET user_state = 'inactivo' WHERE id = ?`, [req.params.id]);
  res.status(204).end();
});
