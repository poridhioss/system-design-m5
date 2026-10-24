import express from 'express';
import { pool } from './db.js';
import { router as dashboardRouter } from './dashboard.js';
import { router as reportRouter } from './report.js';
import { router as exportRouter } from './export.js';

const app = express();
const port = Number(process.env.PORT ?? 8000);

// Memory meter: sample this process's memory every 100 ms and remember the peak.
let peakRss = 0;
setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 100);

// Returns the peak since the last call, then starts measuring again.
app.get('/memory', (req, res) => {
  const toMB = (bytes) => Math.round(bytes / 1024 / 1024);
  res.json({ peakMB: toMB(peakRss), nowMB: toMB(process.memoryUsage().rss) });
  peakRss = 0;
});

// A quick query, used to see how other requests are affected by heavy work.
app.get('/users/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [req.params.id]);
  res.json(rows[0] ?? null);
});

app.use(dashboardRouter);
app.use(reportRouter);
app.use(exportRouter);

app.use((err, req, res, next) => {
  // A streamed response has already sent its status and part of its body,
  // so it can't become a JSON error any more: log it and close the connection.
  if (res.headersSent) {
    console.error(`stream stopped early: ${err.message}`);
    return res.destroy();
  }
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

// Express 5 passes startup errors (such as the port being taken) to this callback.
app.listen(port, (err) => {
  if (err) throw err;
  console.log(`async lab listening on port ${port}`);
});
