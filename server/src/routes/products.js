import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { insertClause, likeContains, money, pagination, setClause } from '../validation.js';

const stockAmount = z.number().int().min(0).max(2147483647);

const imageUrl = z
  .url({ protocol: /^https?$/ })
  .max(255)
  .nullable();

const fields = {
  product_barcode: z.string().trim().min(1).max(100).nullable().optional(),
  product_name: z.string().trim().min(1).max(150),
  product_brand: z.string().trim().max(100).nullable().optional(),
  product_description: z.string().max(5000).nullable().optional(),
  product_sell_price: money,
  product_costs: money.optional(),
  product_min_stock: stockAmount.optional(),
  product_api_origin: z.boolean().optional(),
  product_img_url: imageUrl.optional(),
};

const createSchema = z.strictObject({
  ...fields,
  product_current_stock: stockAmount.optional(),
});

// Stock is deliberately not editable here: changes go through /inventory/adjustments,
// which keeps the audit trail complete.
const updateSchema = z
  .strictObject(fields)
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

const listSchema = z.object({
  q: z.string().trim().max(150).optional(),
  low_stock: z.enum(['true', 'false']).optional(),
  ...pagination,
});

const present = (product) => ({
  ...product,
  product_api_origin: Boolean(product.product_api_origin),
});

async function findProduct(productId) {
  const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [productId]);
  if (rows.length === 0) throw notFound('Product');
  return present(rows[0]);
}

const barcodeTaken = () =>
  new HttpError(409, 'BARCODE_ALREADY_REGISTERED', 'A product with that barcode already exists.');

export const productsRouter = Router();
productsRouter.use(requireAuth);

productsRouter.get('/', async (req, res) => {
  const { q, low_stock, limit, offset } = listSchema.parse(req.query);

  const where = [];
  const params = [];
  if (q) {
    const term = likeContains(q);
    where.push('(product_name LIKE ? OR product_brand LIKE ? OR product_barcode LIKE ?)');
    params.push(term, term, term);
  }
  if (low_stock === 'true') where.push('product_current_stock <= product_min_stock');

  const [rows] = await pool.query(
    `SELECT * FROM products
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY product_name, id LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  res.json(rows.map(present));
});

// Exact lookup for the point of sale, where a barcode scanner supplies the code.
productsRouter.get('/barcode/:barcode', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM products WHERE product_barcode = ?', [
    req.params.barcode,
  ]);
  if (rows.length === 0) throw notFound('Product');
  res.json(present(rows[0]));
});

productsRouter.get('/:id', async (req, res) => {
  res.json(await findProduct(req.params.id));
});

productsRouter.post('/', async (req, res) => {
  const productId = randomUUID();
  const { columns, placeholders, values } = insertClause({
    id: productId,
    ...createSchema.parse(req.body),
  });
  try {
    await pool.query(`INSERT INTO products (${columns}) VALUES (${placeholders})`, values);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw barcodeTaken();
    throw err;
  }
  res.status(201).json(await findProduct(productId));
});

productsRouter.patch('/:id', requireAdmin, async (req, res) => {
  const { sql, values } = setClause(updateSchema.parse(req.body));
  await findProduct(req.params.id);
  try {
    await pool.query(`UPDATE products SET ${sql} WHERE id = ?`, [...values, req.params.id]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw barcodeTaken();
    throw err;
  }
  res.json(await findProduct(req.params.id));
});

// Products with sales or adjustments are protected by foreign keys, which surfaces as a 409.
productsRouter.delete('/:id', requireAdmin, async (req, res) => {
  const [result] = await pool.query('DELETE FROM products WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) throw notFound('Product');
  res.status(204).end();
});
