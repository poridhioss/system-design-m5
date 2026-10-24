import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { state } from './state.js';
import { closeAllClients } from './modules/events/events.service.js';

// Express 5 passes startup errors (such as the port being taken) to this callback.
const server = app.listen(config.port, (err) => {
  if (err) throw err;
  console.log(`service listening on port ${config.port}`);
});

async function shutdown(signal) {
  if (state.shuttingDown) return; // a second signal changes nothing
  state.shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  // Safety net: if anything hangs, exit before Docker's 10-second SIGKILL.
  setTimeout(() => {
    console.error('shutdown took too long, forcing exit');
    process.exit(1);
  }, config.shutdownTimeoutMs).unref();

  // 1. Stop accepting new connections. The callback runs once every open one has finished.
  server.close(async () => {
    console.log('all connections closed');
    // 3. Close the database pool, then exit cleanly.
    await pool.end();
    console.log('database pool closed, exiting');
    process.exit(0);
  });

  // 2. Event streams never finish on their own, so end them now.
  closeAllClients();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
