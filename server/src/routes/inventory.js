import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db.js';
import { notFound } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { id, pagination } from '../validation.js';

const createSchema = z.strictObject({
  product_id: id,
  adj_type: z.string().trim().min(1).max(50),
  adj_new_amount: z.number().int().min(0).max(2147483647),
  adj_motive: z.string().trim().max(5000).nullable().optional(),
});

const listSchema = z.object({
  product_id: id.optional(),
  ...pagination,
});

const ADJUSTMENT = `
  SELECT a.*, p.product_name, u.user_name
    FROM inventory_adjustments a
    JOIN products p ON p.id = a.product_id
    JOIN users u ON u.id = a.user_id`;

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

inventoryRouter.get('/adjustments', async (req, res) => {
  const { product_id, limit, offset } = listSchema.parse(req.query);
  const [rows] = await pool.query(
    `${ADJUSTMENT}
     ${product_id ? 'WHERE a.product_id = ?' : ''}
     ORDER BY a.adj_date DESC, a.id LIMIT ? OFFSET ?`,
    product_id ? [product_id, limit, offset] : [limit, offset],
  );
  res.json(rows);
});

// Sets the stock of a product and records the change, atomically.
inventoryRouter.post('/adjustments', async (req, res) => {
  const { product_id, adj_type, adj_new_amount, adj_motive } = createSchema.parse(req.body);
  const adjustmentId = randomUUID();

  await withTransaction(async (connection) => {
    const [products] = await connection.query(
      'SELECT product_current_stock FROM products WHERE id = ? FOR UPDATE',
      [product_id],
    );
    if (products.length === 0) throw notFound('Product');

    await connection.query(
      `INSERT INTO inventory_adjustments
         (id, product_id, user_id, adj_type, adj_previous_amount, adj_new_amount, adj_motive)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        adjustmentId,
        product_id,
        req.user.id,
        adj_type,
        products[0].product_current_stock,
        adj_new_amount,
        adj_motive ?? null,
      ],
    );
    await connection.query('UPDATE products SET product_current_stock = ? WHERE id = ?', [
      adj_new_amount,
      product_id,
    ]);
  });

  const [rows] = await pool.query(`${ADJUSTMENT} WHERE a.id = ?`, [adjustmentId]);
  res.status(201).json(rows[0]);
});
