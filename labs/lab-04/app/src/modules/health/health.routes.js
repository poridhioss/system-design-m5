import { Router } from 'express';
import { pool } from '../../db.js';
import { state } from '../../state.js';
import { clientCount } from '../events/events.service.js';

export const router = Router();

// Healthy means "able to serve requests": not shutting down, and the database answers.
router.get('/', async (req, res) => {
  if (state.shuttingDown) {
    return res.status(503).json({ status: 'shutting down' });
  }
  try {
    await pool.query('SELECT 1');
  } catch {
    return res.status(503).json({ status: 'database unavailable' });
  }
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    connectedClients: clientCount(),
  });
});
