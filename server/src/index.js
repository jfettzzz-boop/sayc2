import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';

try {
  await pool.query('SELECT 1');
} catch (err) {
  console.error(
    `Could not connect to MySQL database "${config.db.database}" at ` +
      `${config.db.host}:${config.db.port}: ${err.code ?? err.message}`,
  );
  process.exit(1);
}

// Express 5 also calls this when listening fails, for example if the port is taken.
createApp().listen(config.port, (err) => {
  if (err) {
    console.error(`Could not listen on port ${config.port}: ${err.code ?? err.message}`);
    process.exit(1);
  }
  console.log(`SAYC API listening on http://localhost:${config.port}/api/v1`);
});
