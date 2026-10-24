import { Router } from 'express';
import QueryStream from 'pg-query-stream';
import { pipeline } from 'node:stream/promises';
import { pool } from './db.js';

export const router = Router();

const EXPORT_SQL = 'SELECT id, name, email FROM users ORDER BY id';

// BEFORE: load every row into memory, build one giant string, then send it.
router.get('/export-buffered', async (req, res) => {
  const { rows } = await pool.query(EXPORT_SQL);
  const lines = rows.map((user) => `${user.id},${user.name},${user.email}\n`);
  res.type('text/csv').send('id,name,email\n' + lines.join(''));
});

// AFTER: stream rows from the database to the client, 1,000 at a time.
router.get('/export-stream', async (req, res) => {
  const client = await pool.connect();
  try {
    const rows = client.query(new QueryStream(EXPORT_SQL, [], { batchSize: 1000 }));
    res.type('text/csv');
    await pipeline(
      rows,
      async function* (source) {
        yield 'id,name,email\n';
        for await (const user of source) {
          yield `${user.id},${user.name},${user.email}\n`;
        }
      },
      res
    );
  } finally {
    client.release(); // always give the connection back, even if the client disconnects
  }
});
