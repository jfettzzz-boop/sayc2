// Never written to the change log, whatever table they come from.
const SECRET_COLUMNS = new Set(['user_pass_hash']);

function snapshot(row) {
  if (!row) return null;
  const values = {};
  for (const [column, value] of Object.entries(row)) {
    if (!SECRET_COLUMNS.has(column)) values[column] = value;
  }
  return JSON.stringify(values);
}

/** Keeps only the columns whose value differs, so an UPDATE entry shows just what changed. */
export function changedColumns(before, after) {
  const old = {};
  const now = {};
  for (const column of Object.keys(after)) {
    if (String(before[column] ?? '') !== String(after[column] ?? '')) {
      old[column] = before[column] ?? null;
      now[column] = after[column] ?? null;
    }
  }
  return { old, now };
}

/**
 * Adds an entry to audit_log. Pass the transaction's connection when there is one, so the
 * entry commits or rolls back with the change it describes.
 */
export async function audit(db, { organizationId, userId, table, recordId, action, before = null, after = null }) {
  await db.query(
    `INSERT INTO audit_log
       (organization_id, user_id, audit_table, audit_record_id, audit_action, audit_old, audit_new)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [organizationId, userId ?? null, table, recordId, action, snapshot(before), snapshot(after)],
  );
}

/** audit() for a change made by the signed-in user. */
export const auditBy = (db, user, entry) =>
  audit(db, { organizationId: user.organization_id, userId: user.id, ...entry });
