import express from 'express';
import { router as healthRouter } from './modules/health/health.routes.js';
import { router as eventsRouter } from './modules/events/events.routes.js';

// Builds the app: middleware, one router per module, error handling.
// It doesn't start listening; server.js does that.
export const app = express();

app.use(express.json());

app.use('/health', healthRouter);
app.use('/events', eventsRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'route not found' });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'request body is not valid JSON' });
  }
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});
