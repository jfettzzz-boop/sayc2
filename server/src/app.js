import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db.js';
import { errorHandler, HttpError } from './errors.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { inventoryRouter } from './routes/inventory.js';
import { organizationRouter } from './routes/organization.js';
import { productsRouter } from './routes/products.js';
import { rolesRouter } from './routes/roles.js';
import { salesRouter } from './routes/sales.js';
import { usersRouter } from './routes/users.js';

/**
 * CORS_ORIGINS entries are exact origins, or patterns where * stands for one part of a host name,
 * such as https://sayc-*.vercel.app for Vercel's preview deployments.
 */
export function corsOriginMatchers(origins) {
  return origins.map((origin) => {
    if (!origin.includes('*')) return origin;
    const escaped = origin.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[a-z0-9-]+');
    return new RegExp(`^${escaped}$`, 'i');
  });
}

export function createApp() {
  const app = express();

  // Behind Render's proxy, the client's address arrives in X-Forwarded-For. Trusting it lets the
  // sign-in limits count each client apart instead of counting everyone as the proxy.
  app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  if (config.corsOrigins.length > 0) {
    app.use(cors({ origin: corsOriginMatchers(config.corsOrigins) }));
  }
  app.use(express.json());

  const api = express.Router();

  api.get('/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  });

  api.use('/auth', authRouter);
  api.use('/organization', organizationRouter);
  api.use('/users', usersRouter);
  api.use('/roles', rolesRouter);
  api.use('/products', productsRouter);
  api.use('/sales', salesRouter);
  api.use('/inventory', inventoryRouter);
  api.use('/dashboard', dashboardRouter);

  app.use('/api/v1', api);

  app.use((req, res, next) => next(new HttpError(404, 'NOT_FOUND', 'Route not found.')));
  app.use(errorHandler);

  return app;
}
