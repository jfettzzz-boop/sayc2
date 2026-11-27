import { Router } from 'express';
import { z } from 'zod';
import { auditBy, changedColumns } from '../audit.js';
import { pool, withTransaction } from '../db.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { id, pagination, setClause } from '../validation.js';
import { email } from './auth.js';

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable();

const updateSchema = z
  .strictObject({
    org_name: z.string().trim().min(1).max(150),
    org_email: email,
    org_tax_id: optionalText(30),
    org_phone: optionalText(30),
    org_address: optionalText(255),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

const TABLES = ['organizations', 'users', 'products', 'sales'];
const ACTIONS = ['INSERT', 'UPDATE', 'DELETE'];

const auditListSchema = z.object({
  table: z.enum(TABLES).optional(),
  record_id: id.optional(),
  action: z.enum(ACTIONS).optional(),
  ...pagination,
});

async function findOrganization(db, organizationId) {
  const [[org]] = await db.query('SELECT * FROM organizations WHERE id = ?', [organizationId]);
  return org;
}

/** The signed-in user's organization: its details, and the log of changes made in it. */
export const organizationRouter = Router();
organizationRouter.use(requireAuth);

organizationRouter.get('/', async (req, res) => {
  res.json(await findOrganization(pool, req.user.organization_id));
});

organizationRouter.patch('/', requireAdmin, async (req, res) => {
  const data = updateSchema.parse(req.body);
  const { sql, values } = setClause(data);

  const org = await withTransaction(async (connection) => {
    const before = await findOrganization(connection, req.user.organization_id);
    await connection.query(`UPDATE organizations SET ${sql} WHERE id = ?`, [...values, before.id]);
    const { old, now } = changedColumns(before, data);
    if (Object.keys(now).length > 0) {
      await auditBy(connection, req.user, {
        table: 'organizations',
        recordId: before.id,
        action: 'UPDATE',
        before: old,
        after: now,
      });
    }
    return findOrganization(connection, before.id);
  });
  res.json(org);
});

// Newest first. Filters narrow it to one table, one record, or one kind of change.
organizationRouter.get('/audit-log', requireAdmin, async (req, res) => {
  const { table, record_id, action, limit, offset } = auditListSchema.parse(req.query);
  const where = ['a.organization_id = ?'];
  const params = [req.user.organization_id];
  if (table) {
    where.push('a.audit_table = ?');
    params.push(table);
  }
  if (record_id) {
    where.push('a.audit_record_id = ?');
    params.push(record_id);
  }
  if (action) {
    where.push('a.audit_action = ?');
    params.push(action);
  }

  const [rows] = await pool.query(
    `SELECT a.*, u.user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.audit_date DESC, a.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  res.json(rows);
});
