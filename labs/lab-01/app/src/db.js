import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
});

// Without this listener, a dropped idle connection crashes the process.
pool.on('error', (err) => {
  console.error('idle database client error:', err.message);
});
