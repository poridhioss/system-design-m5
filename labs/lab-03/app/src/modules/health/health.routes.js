import { Router } from 'express';
import { clientCount } from '../events/events.service.js';

export const router = Router();

// Answers "is this service up, and how is it doing?"
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    connectedClients: clientCount(),
  });
});
