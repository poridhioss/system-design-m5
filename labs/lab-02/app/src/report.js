import { Router } from 'express';
import pLimit from 'p-limit';
import { pool } from './db.js';

export const router = Router();

// A report that looks up 200 users, one slow query (50 ms) each.
const USER_IDS = Array.from({ length: 200 }, (_, i) => i + 1);

function lookUpUser(id) {
  return pool.query('SELECT id, name FROM users, pg_sleep(0.05) WHERE id = $1', [id]);
}

// BEFORE: start all 200 lookups at once.
router.get('/report-unlimited', async (req, res) => {
  const started = Date.now();
  const results = await Promise.all(USER_IDS.map((id) => lookUpUser(id)));
  res.json({ users: results.length, ms: Date.now() - started });
});

// AFTER: at most 3 lookups run at any moment; the rest wait their turn.
const limit = pLimit(3);

router.get('/report-limited', async (req, res) => {
  const started = Date.now();
  const results = await Promise.all(USER_IDS.map((id) => limit(() => lookUpUser(id))));
  res.json({ users: results.length, ms: Date.now() - started });
});
