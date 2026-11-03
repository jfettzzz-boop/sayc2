import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db.js';
import { errorHandler, HttpError } from './errors.js';
import { authRouter } from './routes/auth.js';
import { inventoryRouter } from './routes/inventory.js';
import { productsRouter } from './routes/products.js';
import { rolesRouter } from './routes/roles.js';
import { salesRouter } from './routes/sales.js';
import { usersRouter } from './routes/users.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  if (config.corsOrigins.length > 0) {
    app.use(cors({ origin: config.corsOrigins }));
  }
  app.use(express.json());

  const api = express.Router();

  api.get('/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  });

  api.use('/auth', authRouter);
  api.use('/users', usersRouter);
  api.use('/roles', rolesRouter);
  api.use('/products', productsRouter);
  api.use('/sales', salesRouter);
  api.use('/inventory', inventoryRouter);

  app.use('/api/v1', api);

  app.use((req, res, next) => next(new HttpError(404, 'NOT_FOUND', 'Route not found.')));
  app.use(errorHandler);

  return app;
}
