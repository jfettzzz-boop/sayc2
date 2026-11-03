import { ZodError } from 'zod';

/**
 * An error safe to show to API clients. `code` is stable and intended for i18n lookups
 * on the frontend (see the "errors" section of src/assets/i18n/*.json).
 */
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what) => new HttpError(404, 'NOT_FOUND', `${what} not found.`);

const DB_UNAVAILABLE = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
]);

function toHttpError(err) {
  if (err instanceof HttpError) return err;
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return new HttpError(400, 'VALIDATION_ERROR', 'The request is not valid.', details);
  }
  if (err.code === 'ER_DUP_ENTRY') {
    return new HttpError(409, 'DUPLICATE_ENTRY', 'A record with that unique value already exists.');
  }
  if (err.code === 'ER_ROW_IS_REFERENCED_2') {
    return new HttpError(409, 'RESOURCE_IN_USE', 'The record is referenced by other records.');
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    return new HttpError(400, 'INVALID_REFERENCE', 'The request references a record that does not exist.');
  }
  if (DB_UNAVAILABLE.has(err.code)) {
    console.error('Database unavailable:', err.code);
    return new HttpError(503, 'SERVER_NOT_REACHED', 'The database is not available.');
  }
  // Errors raised by Express body parsing (malformed JSON, payload too large, ...).
  if (err.status >= 400 && err.status < 500) {
    return new HttpError(err.status, 'BAD_REQUEST', 'The request could not be read.');
  }
  console.error(err);
  return new HttpError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}

// Express identifies error middleware by its four-argument signature.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const { status, code, message, details } = toHttpError(err);
  res.status(status).json({ error: { code, message, details } });
}
