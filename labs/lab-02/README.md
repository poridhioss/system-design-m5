# Async Patterns & Backpressure

## Introduction

In the **Express CRUD Service** lab, every handler ran one short query. Real handlers are rarely that light. A dashboard needs several queries, a report needs hundreds, and an export needs the whole table. Written carelessly, the same handlers become slow, freeze other users out, or eat all the server's memory.

This lab covers three patterns that fix this. For each one, you'll first measure the problem and then measure the fix:

1. **From callbacks to async/await.** Refactor a callback-heavy handler into clean async/await, then make it more than twice as fast by running independent queries at the same time.
2. **Concurrency limits.** Watch a batch job grab every database connection while a quick request waits behind it, then fix it with `p-limit`.
3. **Streaming and backpressure.** Export 500,000 rows, first by loading them all into memory, then by streaming them, and compare memory use and time to first byte.

Everything is measured with plain `curl`, plus a small memory meter built into the app. By the end you'll have a before/after table of latency and memory: your performance profile.

![alt text](<images/Async Node.js Architecture Diagram.png>)

The app runs directly on the VM with Node.js, and PostgreSQL runs in a Docker container.

## Objectives

By the end of this lab, you will be able to:

- Refactor a callback-heavy handler into async/await, and explain why it reads better but isn't faster on its own.
- Run independent queries in parallel with `Promise.all`.
- Explain how unbounded concurrency starves a connection pool, and cap it with `p-limit`.
- Stream a large query result to the client with `pg-query-stream` and `pipeline()`, instead of loading it all into memory.
- Explain backpressure, and show it keeping memory flat with a slow client.
- Measure latency, time to first byte and peak memory, and record a before/after performance profile.

## Concepts

### Callbacks, promises and async/await

A database query takes time, but Node.js never waits for it. It starts the query and moves on to other work, and when the result arrives, it calls a function you gave it: a **callback**. The catch is that anything needing the result must go *inside* that callback. Three queries in a row means three callbacks nested inside each other, with an `if (err)` check at every level. This is "callback hell".

A **promise** is an object standing for a result that isn't here yet, like the buzzer a restaurant gives you while your food is cooked. **`await`** pauses the function until the buzzer goes off, and then gives you the result. The code reads top to bottom like ordinary code, and errors can be caught with normal `try/catch`. While the function is paused, the server's single thread is free to serve other requests.

### Sequential vs. parallel

Calling `pool.query(...)` *starts* the query right away. `await` only *waits* for it. So this:

```javascript
const a = await queryA();   // 100 ms
const b = await queryB();   // 100 ms, starts only after A finishes
```

takes 200 ms, even if B doesn't need A's result. When queries are independent, start them all and then wait for all of them:

```javascript
const [a, b] = await Promise.all([queryA(), queryB()]);   // about 100 ms
```

> **DIAGRAM PLACEHOLDER** `images/sequential-vs-parallel.png` (priority: high)
>
> - **Title:** The same three queries: one after another vs. all at once
> - **Type:** timeline (Gantt-style), three stacked panels sharing one time axis from 0 to 300 ms
> - **Show:**
>   - A horizontal time axis at the bottom: `0 ms`, `100 ms`, `200 ms`, `300 ms`.
>   - **Panel 1, "Callbacks (nested)":** three bars placed end to end: `profile query` (0–100 ms), `first member query` (100–200 ms), `newest member query` (200–300 ms). Small curved arrows between them labeled "starts inside the previous callback". Total on the right: `≈ 300 ms`.
>   - **Panel 2, "async/await, one by one":** the same three bars end to end, labeled with `await` at each start. Total: `≈ 300 ms`. A note: "cleaner code, same speed".
>   - **Panel 3, "Promise.all":** the three bars stacked vertically, all spanning 0–100 ms (they overlap in time). A bracket over them: `Promise.all waits for all three`. Total: `≈ 100 ms`.
>   - Under each panel, a thin lane labeled `Node.js thread` that is almost empty: only tiny tick marks where a query is sent and where a result arrives, the rest labeled "free: serving other requests". This shows that waiting for the database doesn't occupy the thread.
>   - Each query bar sits on a lane labeled `PostgreSQL (pg_sleep 0.1 s)`, to show the waiting happens in the database, not in Node.
> - **Takeaway (caption under the image):** `await` doesn't start anything, it only waits. Independent queries started together with `Promise.all` take as long as the slowest one, not the sum. Measured on the VM: 0.32 s with callbacks vs. 0.16 s with `Promise.all`.
> - **Style:** match `images/Async Node.js Architecture Diagram.png`: use the dashboard's green for the query bars, light blue for the Node.js thread lane.

### Too much at once: concurrency limits

The connection pool has 10 connections. Think of them as 10 checkout counters in a shop. `Promise.all` over 200 queries sends all 200 customers to the counters at once. The 10 counters are taken immediately, and everyone else, including a customer who just wants to buy one thing, waits in the same line.

A **concurrency limit** lets the batch job use only a few counters at a time (here, 3). The job itself takes a little longer, but the other 7 counters stay free for everyone else. The `p-limit` package does exactly this: it runs at most N tasks at once and queues the rest.

> **DIAGRAM PLACEHOLDER** `images/pool-starvation.png` (priority: high)
>
> - **Title:** 200 report queries vs. one quick request, with and without a concurrency limit
> - **Type:** two side-by-side panels (left: "Promise.all, no limit", right: "p-limit(3)"), drawn as checkout counters with a waiting line
> - **Show:**
>   - **Both panels:** a box `pg Pool` containing exactly **10 slots** drawn as 10 checkout counters, each connected to a `PostgreSQL` cylinder on the far side. Report queries are purple tokens labeled `report`; the quick request (`GET /users/1`) is one orange token with a stopwatch.
>   - **Left panel, "Promise.all, no limit":** all 10 counters occupied by purple `report` tokens. In front of the pool, a long queue labeled `pool queue: 190 waiting`. The orange quick-request token stands at the **back** of that queue. Stopwatch label: `quick request: 1.01 s`. Footer: `report finishes in 1.2 s`.
>   - **Right panel, "p-limit(3)":** a separate box in front of the pool labeled `p-limit(3)` holding a queue of 197 purple tokens (`waiting in the limiter, not in the pool`). Only **3** counters are occupied by purple tokens; **7** counters are empty and highlighted green (`free for everyone else`). The orange quick-request token goes straight to a free counter. Stopwatch label: `quick request: 0.04 s`. Footer: `report finishes in 3.6 s (slower, on purpose)`.
> - **Takeaway (caption under the image):** Without a limit, one batch job takes every connection and everyone queues behind it. With `p-limit(3)`, the job runs slower but 7 connections stay free, so other requests stay fast. (Numbers from a real VM run.)
> - **Style:** match `images/Async Node.js Architecture Diagram.png`: purple as on the `/report` box, the pg Pool in its blue, PostgreSQL in its green box.

### Buffering vs. streaming

The simple way to send a big result is to load every row into memory, build one huge string, and send it. Memory grows with the size of the table, and the client receives nothing until everything is ready.

**Streaming** sends data in small pieces as it arrives, like processing a huge input line by line instead of reading the whole file first. Here, rows come from Postgres 1,000 at a time and go straight to the client, so only a small part of the table is ever in memory.

> **DIAGRAM PLACEHOLDER** `images/buffered-vs-streamed-memory.png` (priority: high)
>
> - **Title:** Exporting 500,000 rows: memory over time, buffered vs. streamed
> - **Type:** line chart (memory in MB on the y-axis, time in seconds on the x-axis), with a small "what's in memory" inset for each line
> - **Show:**
>   - Y-axis from 0 to 300 MB, with a dashed horizontal line at `≈ 60 MB: idle Node.js process`. X-axis from 0 to 4 s.
>   - **Orange line, "buffered":** flat at about 60 MB, then climbs steeply to a peak of **288 MB**. A marker `first byte: 2.39 s` sits at the very end, right next to `done: 2.40 s`, showing that the client got nothing until everything was ready.
>   - **Blue line, "streamed":** rises gently from about 60 MB and stays nearly flat, peaking at about **103 MB**. A marker `first byte: 0.08 s` at the very start, and `done: 3.69 s` at the end.
>   - **Inset next to the orange line:** three stacked blocks growing in size: `500,000 row objects` → `500,000 CSV strings` → `one 20 MB string`, all held at once.
>   - **Inset next to the blue line:** one small block `≈ 1,000 rows (one batch)` with a circular arrow "fetch → send → next batch".
> - **Takeaway (caption under the image):** Buffering holds the whole table in memory and makes the client wait for the first byte. Streaming keeps memory flat and starts sending immediately, at the cost of a longer total time. (Numbers from a real VM run.)
> - **Style:** match `images/Async Node.js Architecture Diagram.png`: orange as on the `/export` box for "buffered"; blue for "streamed".

### Backpressure

What if the client downloads slowly? Postgres can produce rows much faster than a slow connection can carry them. Picture a bathtub: the tap (the database) pours water in, and the drain (the client's connection) lets it out. If the tap is faster than the drain, the tub overflows.

**Backpressure** is the drain saying "I'm full, slow down". Node's `pipeline()` connects the database stream to the response and handles this for you: when the client falls behind, it pauses reading from the database until the client catches up. The whole chain runs at the speed of its slowest part, and memory stays small.

> **DIAGRAM PLACEHOLDER** `images/backpressure-pipeline.png` (priority: high)
>
> - **Title:** Backpressure: a slow client slows down the database, instead of filling memory
> - **Type:** left-to-right pipeline diagram with small buffers between stages, plus a "signal" path flowing right-to-left
> - **Show:**
>   - Five stages left to right, connected by pipes:
>     1. `PostgreSQL` cylinder with a cursor icon, labeled `cursor: rows on demand`
>     2. `QueryStream` labeled `fetches 1,000 rows per batch`
>     3. `async function*` labeled `row → CSV line`
>     4. `res` labeled `HTTP response`
>     5. a laptop `slow client` labeled `downloads at 1 MB/s`
>   - Between each pair of stages, a small tank (buffer) drawn partly filled. The tank right before the slow client is **full** (red, labeled `buffer full: write() returns false`).
>   - Above the pipeline, red dashed arrows travel **right to left**, from the full tank back through every stage to PostgreSQL, labeled `"pause": stop reading`. Below the pipeline, green dashed arrows labeled `'drain': room again → resume`.
>   - A large bracket around stages 2–4 labeled `pipeline(rows, transform, res)`: "handles pause and resume for you".
>   - Small bathtub icon in a corner: tap = `database`, tub = `buffers`, drain = `client connection`, as in the Concepts text.
>   - Footer with real numbers: `slow client got 10.5 MB in 4 s; server memory stayed at 105 MB`.
> - **Takeaway (caption under the image):** When the client can't keep up, `pipeline()` stops reading from the database, so the whole chain moves at the client's speed and nothing piles up in memory.
> - **Style:** match `images/Async Node.js Architecture Diagram.png`: PostgreSQL green, Node.js stages light blue, the "pause" signal red, "resume" green.

## Step 1: Create the project and start PostgreSQL

**Run in the VM terminal:**

```bash
mkdir -p ~/code/async-lab && cd ~/code/async-lab
```

Open the folder in the VS Code editor (**File → Open Folder → `/home/poridhian/code/async-lab`**). Create every file in this lab with the editor.

Create **`package.json`**:

```json
{
  "name": "async-lab",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch --env-file=.env src/server.js"
  },
  "type": "module",
  "dependencies": {
    "express": "5.3.0",
    "p-limit": "7.3.3",
    "pg": "8.23.1",
    "pg-query-stream": "4.17.1"
  }
}
```

Two dependencies are new since the **Express CRUD Service** lab:

- `p-limit` limits how many async tasks run at the same time.
- `pg-query-stream` reads query results as a stream of rows instead of all at once.

Install them:

```bash
npm install
```

```
added 83 packages, and audited 84 packages in 7s

31 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

npm may also print a notice that a newer npm version is available. You can ignore it.

In the editor, create a file named **`.env`** with these two lines. This is a file, not a command: don't paste it into the terminal.

```
DATABASE_URL=postgres://app:app@localhost:5432/appdb
PORT=8000
```

Create **`db/init.sql`**. It creates the same `users` table as before, and fills it with 500,000 sample users:

```sql
CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 500,000 sample users: enough data that loading it all at once really hurts.
INSERT INTO users (name, email)
SELECT 'User ' || n, 'user' || n || '@example.com'
FROM generate_series(1, 500000) AS n;
```

`generate_series(1, 500000)` produces the numbers 1 to 500,000, one row each, and the `INSERT` turns each number into a user such as `User 42`, `user42@example.com`.

Create **`docker-compose.yml`**:

```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: appdb
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U app -d appdb"]
      interval: 2s
      timeout: 3s
      retries: 30

volumes:
  pgdata:
```

This is the same database setup as in the **Express CRUD Service** lab. The only change is `retries: 30`, because inserting 500,000 rows takes a few seconds the first time.

Start it, and wait until it's healthy:

```bash
docker compose up -d --wait
```

```
[+] up 20/20
 ✔ Image postgres:17         Pulled          16.5s
 ✔ Volume async-lab_pgdata   Created          0.0s
 ✔ Network async-lab_default Created          0.1s
 ✔ Container async-lab-db-1  Healthy         11.9s
```

Check that the users are there:

```bash
docker compose exec db psql -U app -d appdb -c 'SELECT count(*) FROM users'
```

```
 count
--------
 500000
(1 row)
```

## Step 2: Create the server with a memory meter

Create **`src/db.js`**. It's the same connection pool as in the **Express CRUD Service** lab, with at most 10 connections:

```javascript
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
});

// Without this listener, a dropped idle connection crashes the process.
pool.on('error', (err) => {
  console.error('idle database client error:', err.message);
});
```

Create **`src/server.js`**:

```javascript
import express from 'express';
import { pool } from './db.js';

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
```

Two parts of this file are your measuring tools:

- **The memory meter.** `process.memoryUsage().rss` is how much memory the whole Node.js process is using right now (RSS, the "resident set size"). A timer checks it every 100 ms and keeps the highest value. `GET /memory` reports that peak and then resets it, so you can measure one request at a time: call `/memory` once to reset, run the request, call `/memory` again to see its peak.
- **`GET /users/:id`** is a quick, single-row query. In Step 5 you'll use it to see how a heavy batch job affects other requests.

The error handler has a new case for streams. You'll see why in Step 6.

Open a **second terminal** (**Terminal → New Terminal**) and start the server in watch mode.

**Run in the second terminal:**

```bash
cd ~/code/async-lab && npm run dev
```

```
> dev
> node --watch --env-file=.env src/server.js

async lab listening on port 8000
```

Leave it running. Watch mode restarts the server every time you save a file. Back in the **first terminal**, try both endpoints:

```bash
curl -sS localhost:8000/users/42; echo
curl -sS localhost:8000/memory; echo
```

```
{"id":42,"name":"User 42","email":"user42@example.com"}
{"peakMB":61,"nowMB":59}
```

An idle Node.js process uses about 60 MB. Keep that number in mind.

## Step 3: Measure a callback-heavy handler

Here's a handler written the old way, with callbacks. It builds a small dashboard from three queries: your profile, the first member who ever joined, and the newest member.

Create **`src/dashboard.js`**:

```javascript
import { Router } from 'express';
import { pool } from './db.js';

export const router = Router();

// Each query also calls pg_sleep(0.1): the database waits 100 ms, like a busy
// production database would. It makes the timing differences easy to see.
const PROFILE_SQL = 'SELECT id, name, email FROM users, pg_sleep(0.1) WHERE id = $1';
const FIRST_SQL = 'SELECT id, name FROM users, pg_sleep(0.1) ORDER BY id LIMIT 1';
const NEWEST_SQL = 'SELECT id, name FROM users, pg_sleep(0.1) ORDER BY id DESC LIMIT 1';

// BEFORE: callback style. Each query waits inside the previous one's callback.
router.get('/dashboard-callbacks/:id', (req, res, next) => {
  pool.query(PROFILE_SQL, [req.params.id], (err, profile) => {
    if (err) return next(err);
    if (profile.rows.length === 0) return res.status(404).json({ error: 'user not found' });

    pool.query(FIRST_SQL, (err, first) => {
      if (err) return next(err);

      pool.query(NEWEST_SQL, (err, newest) => {
        if (err) return next(err);

        res.json({
          user: profile.rows[0],
          firstUser: first.rows[0],
          newestUser: newest.rows[0],
        });
      });
    });
  });
});
```

What to notice:

- **`pg_sleep(0.1)`** makes Postgres wait 100 ms before answering, standing in for a slow database. Placed in the `FROM` list, it runs once per query. Every query here costs about 100 ms.
- **The pyramid.** The second query is started inside the first query's callback, and the third inside the second's, because a callback is the only place where the previous result exists. The code drifts to the right with every step.
- **`if (err) return next(err);` at every level.** Each callback must check for an error by hand and pass it to Express's error handler. Forget one, and that error is silently lost.
- **One by one.** The first member and the newest member don't depend on your profile at all, but the nesting forces them to wait their turn anyway.

Plug the router into the server. In **`src/server.js`**, add this import below the line `import { pool } from './db.js';`:

```javascript
import { router as dashboardRouter } from './dashboard.js';
```

and add this line just above the error handler (the `app.use((err, req, res, next) => {` line):

```javascript
app.use(dashboardRouter);
```

Save, and time the dashboard. `-w '%{time_total}'` makes curl print how long the whole request took:

```bash
curl -sS localhost:8000/dashboard-callbacks/42; echo
curl -sS -o /dev/null -w 'callbacks: %{time_total}s\n' localhost:8000/dashboard-callbacks/42
```

```
{"user":{"id":42,"name":"User 42","email":"user42@example.com"},"firstUser":{"id":1,"name":"User 1"},"newestUser":{"id":500000,"name":"User 500000"}}
callbacks: 0.315450s
```

Three queries of 100 ms each, one after another: about **0.3 seconds**. Run the timing command a few times; the first request is a little slower, because the pool opens its connections then.

## Step 4: Refactor to async/await, then run queries in parallel

Rewrite the same handler with async/await. Add this route to the end of **`src/dashboard.js`**:

```javascript
// AFTER: async/await, the same three queries written top to bottom.
router.get('/dashboard/:id', async (req, res) => {
  const profile = await pool.query(PROFILE_SQL, [req.params.id]);
  if (profile.rows.length === 0) return res.status(404).json({ error: 'user not found' });
  const first = await pool.query(FIRST_SQL);
  const newest = await pool.query(NEWEST_SQL);

  res.json({
    user: profile.rows[0],
    firstUser: first.rows[0],
    newestUser: newest.rows[0],
  });
});
```

Compare it with the callback version:

- **Flat, top to bottom.** No pyramid: each `await` hands back the result as a normal value.
- **No `if (err)` checks.** If a query fails, its `await` throws, and Express 5 sends the error to the error handler automatically.

Save, and time it:

```bash
curl -sS -o /dev/null -w 'async/await: %{time_total}s\n' localhost:8000/dashboard/42
```

```
async/await: 0.408735s
```

Much cleaner code, but **no faster**: about the same as the callback version (timings vary a little from run to run). Each `await` still waits for its query to finish before the next one starts. The three queries are independent, though, so there's no reason to wait. Replace the whole `/dashboard/:id` route you just added with this version:

```javascript
// AFTER: async/await. The three queries don't depend on each other,
// so Promise.all starts them all at once and waits for all three.
router.get('/dashboard/:id', async (req, res) => {
  const [profile, first, newest] = await Promise.all([
    pool.query(PROFILE_SQL, [req.params.id]),
    pool.query(FIRST_SQL),
    pool.query(NEWEST_SQL),
  ]);
  if (profile.rows.length === 0) return res.status(404).json({ error: 'user not found' });

  res.json({
    user: profile.rows[0],
    firstUser: first.rows[0],
    newestUser: newest.rows[0],
  });
});
```

- Each `pool.query(...)` call starts its query immediately and returns a promise, so all three queries are sent before anything waits.
- `Promise.all([...])` waits until all three promises have resolved, and gives back their results in the same order. `const [profile, first, newest] = ...` unpacks that array into three variables.
- The three queries run on three different pool connections at the same time.

Save, and time both versions again:

```bash
curl -sS -o /dev/null -w 'callbacks:   %{time_total}s\n' localhost:8000/dashboard-callbacks/42
curl -sS -o /dev/null -w 'Promise.all: %{time_total}s\n' localhost:8000/dashboard/42
```

```
callbacks:   0.416734s
Promise.all: 0.161561s
```

Well under half the time. The three 100 ms queries now run side by side, so the whole dashboard takes about as long as its slowest query. Same result, more than twice as fast.

## Step 5: Limit concurrency so one job can't hog the pool

Now a heavier job: a report that looks up 200 users, with one slow query (50 ms) each.

Create **`src/report.js`**:

```javascript
import { Router } from 'express';
import { pool } from './db.js';

export const router = Router();

// A report that looks up 200 users, one slow query (50 ms) each.
const USER_IDS = Array.from({ length: 200 }, (_, i) => i + 1);

function lookUpUser(id) {
  return pool.query('SELECT id, name FROM users, pg_sleep(0.05) WHERE id = $1', [id]);
}

// BEFORE: start all 200 lookups at once.
router.get('/report-unlimited', async (req, res) => {
  const started = Date.now();
  const results = await Promise.all(USER_IDS.map((id) => lookUpUser(id)));
  res.json({ users: results.length, ms: Date.now() - started });
});
```

- `Array.from({ length: 200 }, (_, i) => i + 1)` builds the list `[1, 2, ..., 200]`.
- `USER_IDS.map((id) => lookUpUser(id))` calls `lookUpUser` 200 times right away, starting 200 queries and giving back 200 promises. `Promise.all` waits for all of them.
- The response reports how long the whole report took, in milliseconds.

Plug it in. In **`src/server.js`**, add this import below the dashboard import:

```javascript
import { router as reportRouter } from './report.js';
```

and this line below `app.use(dashboardRouter);`:

```javascript
app.use(reportRouter);
```

Save. Now run the report, and while it's running, send one quick request and time it:

```bash
curl -sS localhost:8000/report-unlimited > /tmp/report.json &
sleep 0.2
curl -sS -o /dev/null -w 'quick request took %{time_total}s\n' localhost:8000/users/1
wait
cat /tmp/report.json; echo
```

- The `&` at the end of the first line runs the report in the background and saves its answer to `/tmp/report.json`.
- `sleep 0.2` gives the report a moment to start.
- The quick request is timed while the report runs.
- `wait` waits for the background report to finish, and `cat` prints its result.

Bash also prints lines like `[1] 12345` and `[1]+ Done` for the background job. You can ignore them.

```
[1] 14867
quick request took 1.010320s
[1]+  Done                    curl -sS localhost:8000/report-unlimited > /tmp/report.json
{"users":200,"ms":1199}
```

The quick request normally takes a few milliseconds, but here it took about **a second**. All 200 report queries were sent at once. The pool's 10 connections were taken immediately, and the other 190 queries joined a queue. The quick request had to join the back of that same queue.

Now limit the report to 3 queries at a time. In **`src/report.js`**, add this import below the first line (`import { Router } from 'express';`):

```javascript
import pLimit from 'p-limit';
```

and add this route to the end of the file:

```javascript
// AFTER: at most 3 lookups run at any moment; the rest wait their turn.
const limit = pLimit(3);

router.get('/report-limited', async (req, res) => {
  const started = Date.now();
  const results = await Promise.all(USER_IDS.map((id) => limit(() => lookUpUser(id))));
  res.json({ users: results.length, ms: Date.now() - started });
});
```

- `pLimit(3)` creates a limiter that runs at most 3 tasks at once.
- Note the extra `() =>`: `limit(() => lookUpUser(id))` hands the limiter a *function that starts the query*, not a query that has already started. The limiter decides when to call it: as soon as one of the 3 running lookups finishes, the next one starts.
- `Promise.all` still waits for all 200 results, so the response is the same.

Save, and run the same test against the limited report:

```bash
curl -sS localhost:8000/report-limited > /tmp/report.json &
sleep 0.2
curl -sS -o /dev/null -w 'quick request took %{time_total}s\n' localhost:8000/users/1
wait
cat /tmp/report.json; echo
```

```
[1] 16295
quick request took 0.036790s
[1]+  Done                    curl -sS localhost:8000/report-limited > /tmp/report.json
{"users":200,"ms":3563}
```

The quick request is fast again: **a few hundredths of a second** instead of a full second. The report only ever holds 3 of the 10 connections, so 7 are always free for other requests. The price is that the report itself takes longer (about 3.5 seconds instead of 1.2), because it now runs 3 queries at a time instead of 10. That's usually the right trade: one background job finishing a bit later is better than every user waiting.

## Step 6: Stream a large export instead of buffering it

The last job sends the whole table, all 500,000 users, as a CSV file.

Create **`src/export.js`** with the buffered version first:

```javascript
import { Router } from 'express';
import { pool } from './db.js';

export const router = Router();

const EXPORT_SQL = 'SELECT id, name, email FROM users ORDER BY id';

// BEFORE: load every row into memory, build one giant string, then send it.
router.get('/export-buffered', async (req, res) => {
  const { rows } = await pool.query(EXPORT_SQL);
  const lines = rows.map((user) => `${user.id},${user.name},${user.email}\n`);
  res.type('text/csv').send('id,name,email\n' + lines.join(''));
});
```

`pool.query` loads all 500,000 rows into memory as JavaScript objects. Then `map` creates 500,000 strings, and `join` glues them into one 20 MB string. Only then does anything get sent.

Plug it in. In **`src/server.js`**, add this import below the report import:

```javascript
import { router as exportRouter } from './export.js';
```

and this line below `app.use(reportRouter);`:

```javascript
app.use(exportRouter);
```

Save. Then reset the memory meter, download the export, and read the meter:

```bash
curl -sS localhost:8000/memory > /dev/null
curl -sS -o /dev/null -w 'first byte after %{time_starttransfer}s, done after %{time_total}s, %{size_download} bytes\n' localhost:8000/export-buffered
curl -sS localhost:8000/memory; echo
```

`%{time_starttransfer}` is when the first byte of the response arrived. `%{size_download}` is how many bytes came back.

```
first byte after 2.394672s, done after 2.401940s, 20666699 bytes
{"peakMB":288,"nowMB":288}
```

Memory jumped from about 60 MB to almost **300 MB** for a 20 MB file. Every row was held as an object, then as a string, then inside one giant string. And the client waited more than 2 seconds before receiving a single byte. With twice the rows, it would need twice the memory; ten users exporting at once would need ten times as much.

Now the streamed version. In **`src/export.js`**, add these two imports below the first line (`import { Router } from 'express';`):

```javascript
import QueryStream from 'pg-query-stream';
import { pipeline } from 'node:stream/promises';
```

and add this route to the end of the file:

```javascript
// AFTER: stream rows from the database to the client, 1,000 at a time.
router.get('/export-stream', async (req, res) => {
  const client = await pool.connect();
  try {
    const rows = client.query(new QueryStream(EXPORT_SQL, [], { batchSize: 1000 }));
    res.type('text/csv');
    await pipeline(
      rows,
      async function* (source) {
        yield 'id,name,email\n';
        for await (const user of source) {
          yield `${user.id},${user.name},${user.email}\n`;
        }
      },
      res
    );
  } finally {
    client.release(); // always give the connection back, even if the client disconnects
  }
});
```

How the stream works:

- **`pool.connect()`** borrows one connection for the whole export, because a stream reads from the same connection until it's done.
- **`new QueryStream(..., { batchSize: 1000 })`** turns the query into a stream of rows. It fetches 1,000 rows at a time, and only fetches the next 1,000 when the earlier ones have been used.
- **`pipeline(rows, transform, res)`** connects three stages: rows from the database, then a function that turns each row into a CSV line, then the HTTP response. It also handles **backpressure**: if the client can't keep up, `pipeline` pauses the database stream until the client catches up.
- **The `async function*` (a generator)** is the transform in the middle. `for await` takes one row at a time from the stream, and each `yield` passes one line on to the response.
- **`finally { client.release(); }`** returns the connection to the pool whether the export finished or failed. Without it, every interrupted export would leak a connection, and after 10 of them the pool would be empty.

Saving `export.js` restarts the server, so this measurement starts from fresh memory. Run the same test against the streamed export:

```bash
curl -sS localhost:8000/memory > /dev/null
curl -sS -o /dev/null -w 'first byte after %{time_starttransfer}s, done after %{time_total}s, %{size_download} bytes\n' localhost:8000/export-stream
curl -sS localhost:8000/memory; echo
```

```
first byte after 0.079628s, done after 3.687361s, 20666699 bytes
{"peakMB":103,"nowMB":103}
```

The same 20 MB file, but:

- **Peak memory around 100 MB instead of almost 300.** Only a few batches of rows are in memory at any moment, and that doesn't grow with the size of the table.
- **First byte almost immediately.** The client starts receiving data while the rest is still being read.
- **The total time is longer.** Fetching in batches costs more round trips to the database, and each row passes through the generator one at a time. Streaming trades total time for flat memory and a fast start.

Check that the file is complete:

```bash
curl -sS localhost:8000/export-stream -o export.csv && head -3 export.csv && wc -l export.csv
```

```
id,name,email
1,User 1,user1@example.com
2,User 2,user2@example.com
500001 export.csv
```

That's a header line plus 500,000 users.

### Backpressure with a slow client

Now pretend the client has a slow connection. `--limit-rate 1M` makes curl download at most 1 MB per second, and `--max-time 4` makes it give up after 4 seconds:

```bash
curl -sS localhost:8000/memory > /dev/null
curl -sS -o /dev/null --limit-rate 1M --max-time 4 -w 'slow client got %{size_download} bytes\n' localhost:8000/export-stream
curl -sS localhost:8000/memory; echo
```

```
curl: (28) Operation timed out after 4000 milliseconds with 10548815 bytes received
slow client got 10548815 bytes
{"peakMB":105,"nowMB":105}
```

The `Operation timed out` message is expected: curl stopped itself after 4 seconds, as `--max-time 4` told it to.

In 4 seconds, the slow client received only part of the 20 MB file (curl's rate limit isn't exact, so your amount will vary). The server could have read the rest of the table from Postgres in that time, yet its memory stayed at the same level as a normal streamed export. That's backpressure: `pipeline` saw that the response couldn't take more data, so it stopped asking the database for rows until the client caught up. Nothing piled up in memory waiting.

Look at the **second terminal**. When curl gave up, the server logged:

```
stream stopped early: Premature close
```

This is the error-handler case from Step 2. The client left in the middle of the stream, so `pipeline` stopped every stage and threw `Premature close`. The status `200` and half the file had already been sent, so the server couldn't turn this into a JSON error response anymore. It logs one line and closes the connection, and the `finally` block gives the database connection back to the pool. A handler that responds all at once can still report a failed request with a `500`; a stream that fails halfway can only stop.

## Step 7: Your before/after profile

Here are the measurements from this lab in one table. Fill in the right-hand column with your own numbers. They'll differ from these, since timings depend on the machine, but the pattern should be the same.

| Pattern | Measurement | Before | After | Your numbers |
|---|---|---|---|---|
| Callbacks → `Promise.all` | Dashboard latency | 0.32 s (callbacks) | 0.16 s (`Promise.all`) | |
| Unlimited → `p-limit(3)` | Quick request during the report | 1.01 s | 0.04 s | |
| Unlimited → `p-limit(3)` | Report duration | 1.2 s | 3.6 s | |
| Buffered → streamed | Peak memory (idle: about 60 MB) | 288 MB | 103 MB | |
| Buffered → streamed | Time to first byte | 2.39 s | 0.08 s | |
| Buffered → streamed | Total export time | 2.40 s | 3.69 s | |

Not every "after" number is smaller, and that's the point. Each fix trades something:

- **`Promise.all`** costs nothing when the queries are truly independent. It just stops waiting for no reason.
- **A concurrency limit** makes the batch job slower so that everyone else stays fast.
- **Streaming** takes a little longer in total, in exchange for memory that stays flat however big the data gets, and a client that starts receiving data immediately.

## Conclusion

You took three handlers that worked but behaved badly, measured each problem, and fixed it:

- **Callbacks → async/await.** The callback pyramid became flat, readable code with automatic error handling. Then `Promise.all` ran the independent queries side by side and cut latency by more than half.
- **Unlimited → limited concurrency.** `Promise.all` over 200 queries took all 10 pool connections and made a quick request wait about a second. `p-limit` capped the job at 3 connections, so other requests stayed fast.
- **Buffered → streamed.** Loading 500,000 rows at once used almost 300 MB and delayed the first byte by more than 2 seconds. Streaming them with `pg-query-stream` and `pipeline` kept memory flat and started the download immediately.
- **Backpressure.** With a slow client, `pipeline` paused the database instead of piling rows up in memory.
- **Stream errors are different.** A stream that fails halfway has already sent its status, so all the server can do is stop, log it and release its resources.

Concurrency limits and backpressure are the same idea in two places: never let a fast producer create more work than a slow consumer can handle. In the **Modular Streaming Service** lab, you'll build a service around streaming, organized into modules, with a health endpoint.