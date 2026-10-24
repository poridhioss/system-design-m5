import { Router } from 'express';
import { pool } from './db.js';

export const router = Router();

// Each query also calls pg_sleep(0.1): the database waits 100 ms, like a busy
// production database would. It makes the timing differences easy to see.
const PROFILE_SQL = 'SELECT id, name, email FROM users, pg_sleep(0.1) WHERE id = $1';
const FIRST_SQL = 'SELECT id, name FROM users, pg_sleep(0.1) ORDER BY id LIMIT 1';
const NEWEST_SQL = 'SELECT id, name FROM users, pg_sleep(0.1) ORDER BY id DESC LIMIT 1';

// BEFORE: callback style. Each query waits inside the previous one's callback.
router.get('/dashboard-callbacks/:id', (req, res, next) => {
  pool.query(PROFILE_SQL, [req.params.id], (err, profile) => {
    if (err) return next(err);
    if (profile.rows.length === 0) return res.status(404).json({ error: 'user not found' });

    pool.query(FIRST_SQL, (err, first) => {
      if (err) return next(err);

      pool.query(NEWEST_SQL, (err, newest) => {
        if (err) return next(err);

        res.json({
          user: profile.rows[0],
          firstUser: first.rows[0],
          newestUser: newest.rows[0],
        });
      });
    });
  });
});

// AFTER: async/await. The three queries don't depend on each other,
// so Promise.all starts them all at once and waits for all three.
router.get('/dashboard/:id', async (req, res) => {
  const [profile, first, newest] = await Promise.all([
    pool.query(PROFILE_SQL, [req.params.id]),
    pool.query(FIRST_SQL),
    pool.query(NEWEST_SQL),
  ]);
  if (profile.rows.length === 0) return res.status(404).json({ error: 'user not found' });

  res.json({
    user: profile.rows[0],
    firstUser: first.rows[0],
    newestUser: newest.rows[0],
  });
});
