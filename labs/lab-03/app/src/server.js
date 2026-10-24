import { app } from './app.js';

const port = Number(process.env.PORT ?? 8000);

// Express 5 passes startup errors (such as the port being taken) to this callback.
app.listen(port, (err) => {
  if (err) throw err;
  console.log(`streaming service listening on port ${port}`);
});
