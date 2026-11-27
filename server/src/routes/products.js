import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { auditBy, changedColumns } from '../audit.js';
import { pool, withTransaction } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
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

// Only these reach the ORDER BY, because the schema limits sort to these keys.
const SORT_COLUMNS = { name: 'product_name', stock: 'product_current_stock' };

const listSchema = z.object({
  q: z.string().trim().max(150).optional(),
  low_stock: z.enum(['true', 'false']).optional(),
  sort: z.enum(['name', 'stock']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
  ...pagination,
});

const historySchema = z.object({ ...pagination });

const present = (product) => ({
  ...product,
  product_api_origin: Boolean(product.product_api_origin),
});

/** A product of another organization reads as missing, so ids cannot be probed. */
async function findProduct(db, productId, organizationId, lock = false) {
  const [rows] = await db.query(
    `SELECT * FROM products WHERE id = ? AND organization_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [productId, organizationId],
  );
  if (rows.length === 0) throw notFound('Product');
  return present(rows[0]);
}

/** Records a price or cost in product_price_history; previous is null for a new product. */
async function recordPrice(db, user, previous, current) {
  await db.query(
    `INSERT INTO product_price_history
       (organization_id, product_id, user_id, price_previous, price_new, cost_previous, cost_new)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      user.organization_id,
      current.id,
      user.id,
      previous?.product_sell_price ?? null,
      current.product_sell_price,
      previous?.product_costs ?? null,
      current.product_costs,
    ],
  );
}

const barcodeTaken = () =>
  new HttpError(409, 'BARCODE_ALREADY_REGISTERED', 'A product with that barcode already exists.');

export const productsRouter = Router();
productsRouter.use(requireAuth);

productsRouter.get('/', async (req, res) => {
  const { q, low_stock, sort, order, limit, offset } = listSchema.parse(req.query);

  const where = ['organization_id = ?'];
  const params = [req.user.organization_id];
  if (q) {
    const term = likeContains(q);
    where.push('(product_name LIKE ? OR product_brand LIKE ? OR product_barcode LIKE ?)');
    params.push(term, term, term);
  }
  if (low_stock === 'true') where.push('product_current_stock <= product_min_stock');

  const [rows] = await pool.query(
    `SELECT * FROM products
     WHERE ${where.join(' AND ')}
     ORDER BY ${SORT_COLUMNS[sort]} ${order === 'desc' ? 'DESC' : 'ASC'}, product_name, id LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  res.json(rows.map(present));
});

// Exact lookup for the point of sale, where a barcode scanner supplies the code.
productsRouter.get('/barcode/:barcode', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM products WHERE product_barcode = ? AND organization_id = ?',
    [req.params.barcode, req.user.organization_id],
  );
  if (rows.length === 0) throw notFound('Product');
  res.json(present(rows[0]));
});

productsRouter.get('/:id', async (req, res) => {
  res.json(await findProduct(pool, req.params.id, req.user.organization_id));
});

// Every price and cost the product has had, newest first.
productsRouter.get('/:id/price-history', async (req, res) => {
  const { limit, offset } = historySchema.parse(req.query);
  await findProduct(pool, req.params.id, req.user.organization_id);
  const [rows] = await pool.query(
    `SELECT h.*, u.user_name
       FROM product_price_history h JOIN users u ON u.id = h.user_id
      WHERE h.product_id = ?
      ORDER BY h.price_changed_at DESC, h.id DESC LIMIT ? OFFSET ?`,
    [req.params.id, limit, offset],
  );
  res.json(rows);
});

productsRouter.post('/', async (req, res) => {
  const productId = randomUUID();
  const { columns, placeholders, values } = insertClause({
    id: productId,
    organization_id: req.user.organization_id,
    ...createSchema.parse(req.body),
  });

  const product = await withTransaction(async (connection) => {
    try {
      await connection.query(`INSERT INTO products (${columns}) VALUES (${placeholders})`, values);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw barcodeTaken();
      throw err;
    }
    const created = await findProduct(connection, productId, req.user.organization_id);
    await recordPrice(connection, req.user, null, created);
    await auditBy(connection, req.user, { table: 'products', recordId: productId, action: 'INSERT', after: created });
    return created;
  });
  res.status(201).json(product);
});

productsRouter.patch('/:id', async (req, res) => {
  const data = updateSchema.parse(req.body);
  const { sql, values } = setClause(data);

  const product = await withTransaction(async (connection) => {
    const before = await findProduct(connection, req.params.id, req.user.organization_id, true);
    try {
      await connection.query(`UPDATE products SET ${sql} WHERE id = ?`, [...values, req.params.id]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw barcodeTaken();
      throw err;
    }
    const after = await findProduct(connection, req.params.id, req.user.organization_id);

    if (
      before.product_sell_price !== after.product_sell_price ||
      before.product_costs !== after.product_costs
    ) {
      await recordPrice(connection, req.user, before, after);
    }
    const { old, now } = changedColumns(before, data);
    if (Object.keys(now).length > 0) {
      await auditBy(connection, req.user, {
        table: 'products',
        recordId: req.params.id,
        action: 'UPDATE',
        before: old,
        after: now,
      });
    }
    return after;
  });
  res.json(product);
});

// Products with sales or adjustments are protected by foreign keys, which surfaces as a 409.
productsRouter.delete('/:id', async (req, res) => {
  await withTransaction(async (connection) => {
    const before = await findProduct(connection, req.params.id, req.user.organization_id, true);
    await connection.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    await auditBy(connection, req.user, { table: 'products', recordId: req.params.id, action: 'DELETE', before });
  });
  res.status(204).end();
});
