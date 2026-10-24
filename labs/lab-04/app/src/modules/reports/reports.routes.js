import { Router } from 'express';
import pLimit from 'p-limit';
import QueryStream from 'pg-query-stream';
import { pipeline } from 'node:stream/promises';
import { pool } from '../../db.js';

export const router = Router();

// Dashboard: three independent queries, run in parallel with Promise.all.
router.get('/dashboard/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id must be a positive integer' });

  const [profile, first, newest] = await Promise.all([
    pool.query('SELECT id, name, email FROM users WHERE id = $1', [id]),
    pool.query('SELECT id, name FROM users ORDER BY id LIMIT 1'),
    pool.query('SELECT id, name FROM users ORDER BY id DESC LIMIT 1'),
  ]);
  if (profile.rows.length === 0) return res.status(404).json({ error: 'user not found' });

  res.json({
    user: profile.rows[0],
    firstUser: first.rows[0],
    newestUser: newest.rows[0],
  });
});

// Batch: look up 200 users, at most 3 queries at a time, so the pool stays free for others.
const limit = pLimit(3);
const USER_IDS = Array.from({ length: 200 }, (_, i) => i + 1);

router.get('/batch', async (req, res) => {
  const started = Date.now();
  const results = await Promise.all(
    USER_IDS.map((id) => limit(() => pool.query('SELECT id, name FROM users WHERE id = $1', [id])))
  );
  res.json({ users: results.length, ms: Date.now() - started });
});

// Export: stream every user as CSV, 1,000 rows at a time, with backpressure.
router.get('/export', async (req, res) => {
  const client = await pool.connect();
  try {
    const rows = client.query(new QueryStream('SELECT id, name, email FROM users ORDER BY id', [], { batchSize: 1000 }));
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
