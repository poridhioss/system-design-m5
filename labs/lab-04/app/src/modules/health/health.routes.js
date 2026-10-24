import { Router } from 'express';

export const router = Router();

// TODO (Task 2): also check the database, and report "shutting down" during shutdown.
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
  });
});
