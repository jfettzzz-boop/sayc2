import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { auditBy } from '../audit.js';
import { pool, withTransaction } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { id, pagination } from '../validation.js';

const MAX_STOCK = 2147483647;

const createSchema = z
  .strictObject({
    product_id: id,
    adj_type: z.string().trim().min(1).max(50),
    // Either the exact new stock, or a signed amount to add to the current stock.
    adj_new_amount: z.number().int().min(0).max(MAX_STOCK).optional(),
    adj_quantity: z
      .number()
      .int()
      .min(-MAX_STOCK)
      .max(MAX_STOCK)
      .refine((quantity) => quantity !== 0, { message: 'Must not be 0' })
      .optional(),
    adj_motive: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((data) => (data.adj_new_amount === undefined) !== (data.adj_quantity === undefined), {
    message: 'Send either adj_new_amount or adj_quantity',
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
     WHERE a.organization_id = ? ${product_id ? 'AND a.product_id = ?' : ''}
     ORDER BY a.adj_date DESC, a.id LIMIT ? OFFSET ?`,
    product_id
      ? [req.user.organization_id, product_id, limit, offset]
      : [req.user.organization_id, limit, offset],
  );
  res.json(rows);
});

// Changes the stock of a product and records the change, atomically. A relative change is
// applied to the locked row, so it can't overwrite a sale that happened meanwhile.
inventoryRouter.post('/adjustments', async (req, res) => {
  const { product_id, adj_type, adj_new_amount, adj_quantity, adj_motive } = createSchema.parse(req.body);
  const adjustmentId = randomUUID();

  await withTransaction(async (connection) => {
    const [products] = await connection.query(
      'SELECT product_current_stock FROM products WHERE id = ? AND organization_id = ? FOR UPDATE',
      [product_id, req.user.organization_id],
    );
    if (products.length === 0) throw notFound('Product');

    const previous = products[0].product_current_stock;
    const newAmount = adj_new_amount ?? previous + adj_quantity;
    if (newAmount < 0) {
      throw new HttpError(409, 'STOCK_WOULD_BE_NEGATIVE', 'There is not enough stock to subtract that amount.', {
        available: previous,
      });
    }
    if (newAmount > MAX_STOCK) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'The resulting stock is too large.');
    }

    await connection.query(
      `INSERT INTO inventory_adjustments
         (id, organization_id, product_id, user_id, adj_type, adj_previous_amount, adj_new_amount, adj_motive)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        adjustmentId,
        req.user.organization_id,
        product_id,
        req.user.id,
        adj_type,
        previous,
        newAmount,
        adj_motive ?? null,
      ],
    );
    await connection.query('UPDATE products SET product_current_stock = ? WHERE id = ?', [
      newAmount,
      product_id,
    ]);
    await auditBy(connection, req.user, {
      table: 'products',
      recordId: product_id,
      action: 'UPDATE',
      before: { product_current_stock: previous },
      after: { product_current_stock: newAmount, adjustment_id: adjustmentId, adj_type },
    });
  });

  const [rows] = await pool.query(`${ADJUSTMENT} WHERE a.id = ?`, [adjustmentId]);
  res.status(201).json(rows[0]);
});
