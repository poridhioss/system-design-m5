import express from 'express';
import { router as healthRouter } from './modules/health/health.routes.js';
// TODO (Task 1): import the users, reports and events routers.

// Builds the app: middleware, one router per module, error handling.
// It doesn't start listening; server.js does that.
export const app = express();

app.use(express.json());

app.use('/health', healthRouter);
// TODO (Task 1): mount the users, reports and events routers.

app.use((req, res) => {
  res.status(404).json({ error: 'route not found' });
});

app.use((err, req, res, next) => {
  // A streamed response has already sent its status and part of its body,
  // so it can't become a JSON error any more: log it and close the connection.
  if (res.headersSent) {
    console.error(`stream stopped early: ${err.message}`);
    return res.destroy();
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'request body is not valid JSON' });
  }
  if (err.code === '23505') {
    // Postgres unique_violation: the email is already taken
    return res.status(409).json({ error: 'email already exists' });
  }
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});
