import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { ROLE_ADMIN, requireAuth } from '../middleware/auth.js';
import { id, money, pagination, toCents } from '../validation.js';

const createSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        product_id: id,
        quantity: z.number().int().min(1).max(1000000),
      }),
    )
    .min(1)
    .max(500),
  received_pay: money,
});

const listSchema = z.object({ ...pagination });

const isAdmin = (user) => user.role_name === ROLE_ADMIN;

/**
 * Registers a sale. Prices come from the database rather than the client, and product rows
 * stay locked until commit, so concurrent sales cannot oversell the same stock.
 */
async function registerSale(userId, { items, received_pay }) {
  const quantities = new Map();
  for (const { product_id, quantity } of items) {
    quantities.set(product_id, (quantities.get(product_id) ?? 0) + quantity);
  }

  return withTransaction(async (connection) => {
    // ORDER BY gives concurrent sales one lock order, which prevents deadlocks.
    const [products] = await connection.query(
      `SELECT id, product_name, product_sell_price, product_current_stock
         FROM products WHERE id IN (?) ORDER BY id FOR UPDATE`,
      [[...quantities.keys()]],
    );

    const found = new Set(products.map((product) => product.id));
    const missing = [...quantities.keys()].filter((productId) => !found.has(productId));
    if (missing.length > 0) {
      throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'A product in the sale does not exist.', { missing });
    }

    const short = products.filter((p) => p.product_current_stock < quantities.get(p.id));
    if (short.length > 0) {
      throw new HttpError(409, 'INSUFFICIENT_STOCK', 'There is not enough stock for this sale.', {
        products: short.map((p) => ({
          product_id: p.id,
          product_name: p.product_name,
          available: p.product_current_stock,
          requested: quantities.get(p.id),
        })),
      });
    }

    // Totals are summed in integer cents to avoid floating point drift.
    const lines = products.map((product) => {
      const quantity = quantities.get(product.id);
      return { product, quantity, subtotalCents: toCents(product.product_sell_price) * quantity };
    });
    const totalCents = lines.reduce((sum, line) => sum + line.subtotalCents, 0);
    const receivedCents = toCents(received_pay);
    if (receivedCents < totalCents) {
      throw new HttpError(422, 'INSUFFICIENT_PAYMENT', 'The payment does not cover the total.', {
        total: totalCents / 100,
        received: received_pay,
      });
    }

    const saleId = randomUUID();
    await connection.query(
      `INSERT INTO sales (id, user_id, sales_total, sales_received_pay, sales_change)
       VALUES (?, ?, ?, ?, ?)`,
      [saleId, userId, totalCents / 100, received_pay, (receivedCents - totalCents) / 100],
    );

    for (const { product, quantity, subtotalCents } of lines) {
      await connection.query(
        `INSERT INTO sales_detail
           (id, sales_id, product_id, detail_quantity, detail_unit_price, detail_subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [randomUUID(), saleId, product.id, quantity, product.product_sell_price, subtotalCents / 100],
      );
      await connection.query(
        'UPDATE products SET product_current_stock = product_current_stock - ? WHERE id = ?',
        [quantity, product.id],
      );
    }

    return saleId;
  });
}

async function findSale(saleId, user) {
  const [rows] = await pool.query(
    `SELECT s.*, u.user_name FROM sales s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    [saleId],
  );
  // Another employee's sale reads as missing, so ids cannot be probed.
  if (rows.length === 0 || (!isAdmin(user) && rows[0].user_id !== user.id)) throw notFound('Sale');

  const [items] = await pool.query(
    `SELECT d.*, p.product_name, p.product_barcode
       FROM sales_detail d JOIN products p ON p.id = d.product_id
      WHERE d.sales_id = ?
      ORDER BY p.product_name`,
    [saleId],
  );
  return { ...rows[0], items };
}

export const salesRouter = Router();
salesRouter.use(requireAuth);

// Administrators see every sale; employees see their own.
salesRouter.get('/', async (req, res) => {
  const { limit, offset } = listSchema.parse(req.query);
  const own = !isAdmin(req.user);
  const [rows] = await pool.query(
    `SELECT s.*, u.user_name FROM sales s JOIN users u ON u.id = s.user_id
     ${own ? 'WHERE s.user_id = ?' : ''}
     ORDER BY s.sales_date DESC, s.id LIMIT ? OFFSET ?`,
    own ? [req.user.id, limit, offset] : [limit, offset],
  );
  res.json(rows);
});

salesRouter.get('/:id', async (req, res) => {
  res.json(await findSale(req.params.id, req.user));
});

salesRouter.post('/', async (req, res) => {
  const saleId = await registerSale(req.user.id, createSchema.parse(req.body));
  res.status(201).json(await findSale(saleId, req.user));
});
