import { Router } from 'express';
import { pool } from '../db.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

export const rolesRouter = Router();
rolesRouter.use(requireAuth, requireAdmin);

rolesRouter.get('/', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM roles ORDER BY role_name');
  res.json(rows);
});
