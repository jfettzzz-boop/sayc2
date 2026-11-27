function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. See server/.env.example.`);
  }
  return value;
}

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long.');
}

/** "true"/"false", or how many proxies sit in front of the API (Render has one). */
function trustProxy(value) {
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 0) throw new Error('TRUST_PROXY must be true, false or a number of proxies.');
  return hops;
}

const DB_INIT_MODES = ['off', 'schema', 'demo'];
const dbInit = process.env.DB_INIT || 'off';
if (!DB_INIT_MODES.includes(dbInit)) {
  throw new Error(`DB_INIT must be one of ${DB_INIT_MODES.join(', ')}.`);
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'sayc_db',
    // Hosted databases outside the provider's private network require TLS. DB_SSL_CA is the
    // provider's certificate (PEM); a dashboard that keeps it on one line may show \n for line breaks.
    ssl:
      process.env.DB_SSL === 'true'
        ? {
            rejectUnauthorized: true,
            ...(process.env.DB_SSL_CA && { ca: process.env.DB_SSL_CA.replaceAll('\\n', '\n') }),
          }
        : undefined,
  },
  /** Creates the tables on start-up when the database is empty: 'schema', or 'demo' with the sample data. */
  dbInit,
  trustProxy: trustProxy(process.env.TRUST_PROXY),
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
};
