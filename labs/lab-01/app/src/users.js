import { Router } from 'express';
import { pool } from './db.js';

export const router = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ID = 2147483647; // the largest value a Postgres SERIAL can hold

// Returns an error message, or null when the body is valid.
function validateUser(body) {
  const { name, email } = body ?? {};
  if (typeof name !== 'string' || name.trim() === '') return 'name is required';
  if (name.length > 100) return 'name must be at most 100 characters';
  if (typeof email !== 'string' || !EMAIL_PATTERN.test(email)) return 'email must be a valid email address';
  return null;
}

// URL values are always strings: "42" must become 42, and "abc" is rejected.
function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= MAX_ID ? id : null;
}

router.post('/', async (req, res) => {
  const error = validateUser(req.body);
  if (error) return res.status(400).json({ error });

  const { rows } = await pool.query(
    'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
    [req.body.name.trim(), req.body.email.toLowerCase()]
  );
  res.status(201).json(rows[0]);
});

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users ORDER BY id');
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id must be a positive integer' });

  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'user not found' });
  res.json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id must be a positive integer' });

  const error = validateUser(req.body);
  if (error) return res.status(400).json({ error });

  const { rows } = await pool.query(
    'UPDATE users SET name = $1, email = $2 WHERE id = $3 RETURNING *',
    [req.body.name.trim(), req.body.email.toLowerCase(), id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'user not found' });
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id must be a positive integer' });

  const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'user not found' });
  res.status(204).end();
});
