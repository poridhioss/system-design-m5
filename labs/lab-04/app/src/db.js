import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 5000,
});

// Without this listener, a dropped idle connection crashes the process.
pool.on('error', (err) => {
  console.error('idle database client error:', err.message);
});
