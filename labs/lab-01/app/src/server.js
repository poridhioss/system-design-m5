import express from 'express';
import { router as usersRouter } from './users.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());
app.use('/users', usersRouter);

// No route matched.
app.use((req, res) => {
  res.status(404).json({ error: 'route not found' });
});

// Four arguments make this the error handler. Express 5 sends errors from
// async handlers here automatically.
app.use((err, req, res, next) => {
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

app.listen(port, () => {
  console.log(`users API listening on port ${port}`);
});
