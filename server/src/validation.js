import { z } from 'zod';

/** A non-negative value that fits a DECIMAL(10,2) column. */
export const money = z
  .number()
  .nonnegative()
  .max(99999999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: 'Must have at most two decimal places',
  });

export const toCents = (value) => Math.round(value * 100);

export const id = z.string().min(1).max(36);

export const pagination = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

/** Escapes LIKE wildcards in user input and wraps it for a "contains" match. */
export const likeContains = (text) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

/** Builds a "`col` = ?, ..." clause. Keys must come from a validated strict schema, never raw input. */
export function setClause(data) {
  return {
    sql: Object.keys(data).map((column) => `\`${column}\` = ?`).join(', '),
    values: Object.values(data),
  };
}

/** Builds the column list and placeholders of an INSERT, under the same rule as setClause. */
export function insertClause(data) {
  const columns = Object.keys(data);
  return {
    columns: columns.map((column) => `\`${column}\``).join(', '),
    placeholders: columns.map(() => '?').join(', '),
    values: Object.values(data),
  };
}
