import { app } from './app.js';
import { config } from './config.js';

// Express 5 passes startup errors (such as the port being taken) to this callback.
const server = app.listen(config.port, (err) => {
  if (err) throw err;
  console.log(`service listening on port ${config.port}`);
});

// TODO (Task 3): shut down gracefully on SIGTERM and SIGINT.
