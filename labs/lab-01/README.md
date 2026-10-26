# Express CRUD Service

## Introduction

Almost every backend starts with the same job: store some records and let clients **C**reate, **R**ead, **U**pdate and **D**elete them over HTTP. That's CRUD. It sounds simple, but doing it well means getting three things right:

- **Status codes** that tell the client exactly what happened (`201` created, `404` not found, `409` conflict...).
- **Validation**, because the server can never trust what a client sends.
- **Safe database access**, with parameterized queries and a connection pool.

In this lab you'll build a small **users API** with Express and PostgreSQL. You'll first run the API directly with Node while Postgres runs in Docker, test every route with a script of `curl` requests, and finally package the API into a container so the whole service starts with one `docker compose` command.

![alt text](<images/Client–API–Database Flow Diagram.png>)

By the end of the lab you'll have:

- A REST API with five routes, each returning the right status code.
- A `requests.sh` test collection that exercises the happy paths and the error cases.
- A Docker Compose stack running the API and PostgreSQL together.

## Objectives

By the end of this lab, you will be able to:

- Design REST routes for one resource, and choose the right status code for every outcome (`200`, `201`, `204`, `400`, `404`, `409`, `500`).
- Validate request input on the server, and explain what goes wrong without it.
- Query PostgreSQL safely from Node.js, with parameterized queries and a connection pool.
- Turn errors into clean JSON responses with a central Express error handler.
- Run PostgreSQL in Docker Compose with a healthcheck, and connect to it by service name.
- Package the API as a container, and test every route with a `curl`-based test collection.

## Concepts

### REST routes for one resource

The resource is a **user**. Each CRUD action maps to one HTTP method and path:

| Action | Method and path | Success code |
|---|---|---|
| Create a user | `POST /users` | `201 Created`, returns the new user |
| List all users | `GET /users` | `200 OK` |
| Get one user | `GET /users/:id` | `200 OK` |
| Replace a user | `PUT /users/:id` | `200 OK`, returns the updated user |
| Delete a user | `DELETE /users/:id` | `204 No Content`, empty body |

### Status codes tell the client what happened

A front end decides what to show based on the status code: the data, an error message, or a "not found" page. So the code has to be precise. The error codes this API uses:

| Code | Meaning | When this API sends it |
|---|---|---|
| `400 Bad Request` | The client sent something invalid | Missing name, bad email, broken JSON, an id like `abc` |
| `404 Not Found` | The thing doesn't exist | No user with that id, or an unknown route |
| `409 Conflict` | The request clashes with existing data | The email is already taken |
| `500 Internal Server Error` | Something broke on the server | A bug, or the database is unreachable |

Every error response has the same shape, `{ "error": "..." }`, so a client can always show the message the same way.

### Never trust the client

The server doesn't know whether a request came from your nice front-end form or from someone typing `curl`. So it checks everything itself: required fields, types and formats. Two more traps:

- **Everything in the URL is a string.** In `GET /users/42`, `req.params.id` is the string `"42"`. The API converts it to a number and rejects anything that isn't a positive integer.
- **Never paste user input into SQL.** Building a query like `` `... WHERE name = '${name}'` `` lets an attacker inject their own SQL. Parameterized queries (`WHERE id = $1`, with the values passed separately) make that impossible, because Postgres never treats the values as SQL.

### A connection pool

Opening a database connection is slow (a network handshake plus authentication), and Postgres starts a separate process for every connection. So instead of connecting once per request, the app keeps a **pool** of open connections and lends them out. `pool.query()` borrows a connection, runs the query, and gives it back. If all 10 are busy, the next query waits in a queue until one is free.

### Express: a chain of functions

Every `app.use(...)` adds a function to a list, and Express runs each request through that list in order:

1. `express.json()` reads the request body and turns the JSON text into `req.body`.
2. The `/users` router matches the method and path, validates the input and queries the database.
3. A "not found" handler catches any request no route matched.
4. The **error handler**, a function with four arguments `(err, req, res, next)`, turns errors into clean JSON responses.

In **Express 5**, which this lab uses, if an `async` route handler throws (for example, a query fails), Express automatically sends the error to the error handler. You don't need a `try/catch` in every route.

> **DIAGRAM PLACEHOLDER** `images/request-pipeline.png` (priority: high)
>
> - **Title:** One request through the Express pipeline, and where each status code comes from
> - **Type:** left-to-right flowchart with exit branches (a "pipeline" with labeled exits)
> - **Show:**
>   - Start on the left: a client box `curl` sending `POST /users` with body `{"name":"Ada","email":"ada@example.com"}`.
>   - Four stages in a row, left to right, inside one big box labeled `Express app (Node.js)`:
>     1. `express.json()`: "parse the body into req.body"
>     2. `/users router`: "validate the input"
>     3. `pool.query(...)`: "INSERT ... VALUES ($1, $2)" with an arrow down to a `PostgreSQL` cylinder labeled `users table`
>     4. `res.status(201).json(user)`: the success exit on the far right, arrow back to the client labeled `201 Created`
>   - Red exit arrows dropping down from the stages, each labeled with its status code and cause:
>     - from `express.json()`: `400`: "body is not valid JSON"
>     - from `/users router`: `400`: "name is required / invalid email / id like abc" and `404`: "no user with that id"
>     - from `pool.query`: an arrow into a separate box `error handler (err, req, res, next)`, which has two exits: `409`: "email already exists (Postgres code 23505)" and `500`: "anything else (bug, database down)"
>   - A grey box at the bottom: `not-found handler` with exit `404`: "no route matched (e.g. /nope)"
>   - A small note on the error-handler box: "Express 5 sends errors from async routes here automatically"
>   - Every error exit ends in the same response shape: `{ "error": "..." }`
> - **Takeaway (caption under the image):** Every request walks the same chain; each status code comes from one specific place in it, and every error leaves in the same `{ "error": ... }` shape.
> - **Style:** match `images/Client–API–Database Flow Diagram.png` (blue Express/API box, red-bordered PostgreSQL, white background); success path in green, error exits in red.

### Containers talk by service name

Inside Docker Compose, each service is its own container. From the API container, `localhost` means *the API container itself*, not the database. Containers reach each other by **service name**, so the API connects to `db:5432`. When you run the API directly on the VM instead, Postgres is reachable at `localhost:5432` because Compose publishes that port to the VM.

> **DIAGRAM PLACEHOLDER** `images/localhost-vs-service-name.png` (priority: high)
>
> - **Title:** Same database, two addresses: `localhost:5432` from the VM, `db:5432` from a container
> - **Type:** two side-by-side panels (left: "Development, Steps 3–7", right: "Containerized, Step 8")
> - **Show:**
>   - **Left panel:** a large box `Poridhi VM`. Inside it, on the left, a plain box `Node.js API (npm run dev)` running directly on the VM, reading `.env`: `DATABASE_URL=postgres://app:app@localhost:5432/appdb`. On the right, a Docker container box `db (PostgreSQL 17)`. The arrow from the API goes to a port symbol on the VM labeled `127.0.0.1:5432 (published by Compose)`, and from there into the `db` container's port `5432`. Arrow label: `localhost:5432`.
>   - **Right panel:** the same `Poridhi VM` box. Inside it, a dashed box `Compose network: users-api_default` containing two containers: `api (Node.js)` and `db (PostgreSQL 17)`. The arrow goes directly from `api` to `db`, labeled `db:5432 (service name)`. On the `api` container, show its env: `DATABASE_URL=postgres://app:app@db:5432/appdb`. Outside the network, the `curl` client reaches `api` through the published port `0.0.0.0:8000 → 8000`.
>   - In the right panel, a red crossed-out dashed arrow from `api` that loops back into the `api` container itself, labeled `localhost:5432 ✗ (this is the api container itself)`.
> - **Takeaway (caption under the image):** From the VM, the database is `localhost:5432` (a published port); from another container, it's `db:5432` (the Compose service name). Inside a container, `localhost` means that container.
> - **Style:** match `images/Client–API–Database Flow Diagram.png` (Docker whale on container boxes, red-bordered PostgreSQL, blue API).

## Step 1: Check your tools and create the project

**Run in the VM terminal:**

```bash
node -v
npm -v
docker --version
docker compose version
```

```
v22.16.0
10.9.2
Docker version 29.7.2, build a7dcaa6
Docker Compose version v5.5.0
```

Your exact versions may differ slightly. Any Node.js version from 22 upwards works for this lab.

Create the project folder and move into it:

```bash
mkdir -p ~/code/users-api && cd ~/code/users-api
```

Open the folder in the VS Code editor (**File → Open Folder → `/home/poridhian/code/users-api`**). You'll create every file in this lab with the editor, so the folder must be open.

Create **`package.json`**:

```json
{
  "name": "users-api",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch --env-file=.env src/server.js"
  },
  "type": "module",
  "dependencies": {
    "express": "5.3.0",
    "pg": "8.23.1"
  }
}
```

- `"type": "module"` lets the code use `import` / `export` (ES modules) instead of `require`.
- `dev` runs the server in **watch mode** (`--watch`), restarting it whenever you save a file, and loads environment variables from a `.env` file (`--env-file=.env`).
- The versions are pinned exactly, so the lab behaves the same every time.

Install the dependencies:

```bash
npm install
```

```
added 79 packages, and audited 80 packages in 6s

28 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

npm may also print a notice that a newer npm version is available. You can ignore it.

This creates `node_modules/` and a `package-lock.json` that records the exact version of every package.

## Step 2: Start PostgreSQL with Docker Compose

First, the table. Create **`db/init.sql`**:

```sql
CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`SERIAL` gives each new user the next id automatically. `UNIQUE` on `email` means the database itself refuses a second user with the same email. The API turns that refusal into a `409`.

Now create **`docker-compose.yml`** with just the database for now (the API is added in Step 7):

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
      retries: 15

volumes:
  pgdata:
```

- `environment` creates a user `app` with password `app` and a database `appdb`.
- `ports: "127.0.0.1:5432:5432"` publishes Postgres to the VM only (not to other machines), so the API can reach it at `localhost:5432` while you develop.
- The first volume mounts `init.sql` into `/docker-entrypoint-initdb.d/`. Postgres runs the scripts in that folder **once**, when the data volume is empty.
- `pgdata` is a named volume that keeps the data when the container restarts.
- The `healthcheck` runs `pg_isready` every 2 seconds. The container only counts as *healthy* once Postgres accepts connections over TCP (`-h 127.0.0.1`), which happens after `init.sql` has run.

Start it:

```bash
docker compose up -d --wait
```

- `-d` runs the containers in the background.
- `--wait` blocks until every container is running and healthy, so the next command never runs too early.

The first run downloads the `postgres:17` image, which takes a few seconds. When it finishes:

```
[+] up 20/20
 ✔ Image postgres:17         Pulled          13.1s
 ✔ Network users-api_default Created          0.0s
 ✔ Volume users-api_pgdata   Created          0.0s
 ✔ Container users-api-db-1  Healthy          3.4s
```

`Healthy` means the healthcheck passed: Postgres is accepting connections and `init.sql` has run.

Check that the table exists:

```bash
docker compose exec db psql -U app -d appdb -c '\d users'
```

`docker compose exec db` runs a command inside the `db` container. `psql` is the Postgres command-line client, and `\d users` describes the table.

```
                                       Table "public.users"
   Column   |           Type           | Collation | Nullable |              Default
------------+--------------------------+-----------+----------+-----------------------------------
 id         | integer                  |           | not null | nextval('users_id_seq'::regclass)
 name       | text                     |           | not null |
 email      | text                     |           | not null |
 created_at | timestamp with time zone |           | not null | now()
Indexes:
    "users_pkey" PRIMARY KEY, btree (id)
    "users_email_key" UNIQUE CONSTRAINT, btree (email)
```

## Step 3: Connect to the database

Configuration belongs in environment variables, not in code. That way the same code runs on your VM and inside a container, with different settings.

In the editor, create a file named **`.env`** in the project folder with these two lines. This is a file, not a command: don't paste it into the terminal.

```
DATABASE_URL=postgres://app:app@localhost:5432/appdb
PORT=8000
```

The URL reads as `postgres://USER:PASSWORD@HOST:PORT/DATABASE`. Check that the file exists:

```bash
cat .env
```

```
DATABASE_URL=postgres://app:app@localhost:5432/appdb
PORT=8000
```

Create **`src/db.js`**:

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

- **Fail fast:** if `DATABASE_URL` is missing, the app refuses to start with a clear message, instead of failing later on the first request.
- `max: 10` keeps at most 10 open connections. Extra queries wait in the pool's queue.
- `connectionTimeoutMillis: 5000` turns "wait forever for a free connection" into an error after 5 seconds.
- The `error` listener handles connections that drop while idle (for example, when the database restarts). Without it, Node treats the error as unhandled and the whole API exits.

## Step 4: Write the users routes

Create **`src/users.js`**. Add the first part: the helpers and the create and list routes.

```javascript
import { Router } from 'express';
import { pool } from './db.js';

export const router = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ID = 2147483647; // the largest value a Postgres SERIAL can hold

// Returns an error message, or null when the body is valid.
function validateUser(body) {
  const { name, email } = body ?? {};
  if (typeof name !== 'string' || name.trim() === '') return 'name is required';
  if (name.length > 100) return 'name must be at most 100 characters';
  if (typeof email !== 'string' || !EMAIL_PATTERN.test(email)) return 'email must be a valid email address';
  return null;
}

// URL values are always strings: "42" must become 42, and "abc" is rejected.
function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= MAX_ID ? id : null;
}

router.post('/', async (req, res) => {
  const error = validateUser(req.body);
  if (error) return res.status(400).json({ error });

  const { rows } = await pool.query(
    'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
    [req.body.name.trim(), req.body.email.toLowerCase()]
  );
  res.status(201).json(rows[0]);
});

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users ORDER BY id');
  res.json(rows);
});
```

- `validateUser` checks the body before anything touches the database. `body ?? {}` handles a request with no body at all.
- `return res.status(400).json(...)`: the `return` matters. `res.json()` sends the response but doesn't stop the function; without `return`, the code would carry on and try to insert the bad data.
- `$1, $2` are query parameters. The values travel separately from the SQL, so input like `'; DROP TABLE users; --` is stored as plain text, never run.
- `RETURNING *` makes Postgres send back the row it just inserted, including the generated `id` and `created_at`, so no second query is needed.
- Each handler is `async` and uses `await pool.query(...)`. While a query waits for Postgres, the event loop is free to serve other requests.

Add the second part to the end of the same file: get, update and delete one user.

```javascript
router.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id must be a positive integer' });

  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'user not found' });
  res.json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id must be a positive integer' });

  const error = validateUser(req.body);
  if (error) return res.status(400).json({ error });

  const { rows } = await pool.query(
    'UPDATE users SET name = $1, email = $2 WHERE id = $3 RETURNING *',
    [req.body.name.trim(), req.body.email.toLowerCase(), id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'user not found' });
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id must be a positive integer' });

  const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'user not found' });
  res.status(204).end();
});
```

- Every `:id` route validates the id first (`400`), then checks whether a row came back (`404`).
- `PUT` replaces the whole user, so it requires both `name` and `email`, just like `POST`.
- `DELETE` answers `204 No Content` with `res.status(204).end()`: success, and nothing to send back.

## Step 5: Create the server and run it

Create **`src/server.js`**:

```javascript
import express from 'express';
import { router as usersRouter } from './users.js';

const app = express();
const port = Number(process.env.PORT ?? 8000);

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

// Express 5 passes startup errors (such as the port being taken) to this callback.
app.listen(port, (err) => {
  if (err) throw err;
  console.log(`users API listening on port ${port}`);
});
```

The order of `app.use` calls is the order requests flow through:

- `express.json()` comes first, so `req.body` is ready before the routes run.
- `app.use('/users', usersRouter)` mounts the router, so its `'/'` route becomes `/users` and `'/:id'` becomes `/users/:id`.
- The "not found" handler sits after all routes, so it only runs when nothing matched.
- The error handler comes last. It maps known errors to client-facing codes: invalid JSON from `express.json()` becomes `400`, and Postgres error code `23505` (a `UNIQUE` violation) becomes `409`. Everything else is logged and returned as a generic `500`, so internal details never leak to the client.
- `PORT` comes from the environment and is converted with `Number()`, because environment variables are always strings. The API uses port **8000**, because a Poridhi service already uses port 3000 on the VM.
- In Express 5, if the server can't start (for example, `EADDRINUSE` because another program holds the port), the error is passed to the `listen` callback. `if (err) throw err;` makes the app crash with that error instead of printing "listening" for a server that never started.

Open a **second terminal** (**Terminal → New Terminal** in VS Code) and start the API in watch mode.

**Run in the second terminal:**

```bash
cd ~/code/users-api && npm run dev
```

```
> dev
> node --watch --env-file=.env src/server.js

users API listening on port 8000
```

Leave this terminal running. Go back to the first terminal for the next steps.

## Step 6: Test every route with a request script

Instead of Postman, the test collection is a script of `curl` requests that runs anywhere and prints each status code. Create **`requests.sh`**:

```bash
#!/usr/bin/env bash
# HTTP test collection for the users API.
# Usage: ./requests.sh            (defaults to http://localhost:8000)
#        BASE=http://HOST:PORT ./requests.sh

BASE=${BASE:-http://localhost:8000}

# req METHOD PATH [JSON_BODY]: print the request, the response body and the status code
req() {
  echo "### $1 $2 ${3:-}"
  if [ -n "${3:-}" ]; then
    curl -sS -X "$1" "$BASE$2" -H 'Content-Type: application/json' -d "$3" -w '\nHTTP %{http_code}\n'
  else
    curl -sS -X "$1" "$BASE$2" -w '\nHTTP %{http_code}\n'
  fi
  echo
}

# Create a user and remember its id for the requests below
echo "### POST /users (create)"
CREATED=$(curl -sS -X POST "$BASE/users" -H 'Content-Type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@example.com"}')
ID=$(echo "$CREATED" | jq -r .id 2>/dev/null)

# Stop here if the create failed: every request below needs a real id.
if ! [[ "$ID" =~ ^[0-9]+$ ]]; then
  echo "could not create the test user. Is the API running at $BASE? The response was:"
  echo "$CREATED" | head -c 300
  echo
  exit 1
fi
echo "created user id: $ID"
echo

req GET    "/users"
req GET    "/users/$ID"
req PUT    "/users/$ID" '{"name":"Ada King","email":"ada.king@example.com"}'
req POST   "/users"     '{"name":"Copy Cat","email":"ada.king@example.com"}'
req POST   "/users"     '{"name":"","email":"not-an-email"}'
req POST   "/users"     '{"name": "Broken JSON"'
req GET    "/users/abc"
req DELETE "/users/$ID"
req GET    "/users/$ID"
```

The `curl` flags used here:

- `-sS`: `-s` hides the progress bar, and `-S` still shows an error if the request fails (for example, if the server isn't running).
- `-X`: the HTTP method.
- `-H 'Content-Type: application/json'`: tells Express the body is JSON, so `express.json()` parses it.
- `-d`: the request body.
- `-w '\nHTTP %{http_code}\n'`: after the body, print the status code on its own line.

`jq -r .id` pulls the `id` field out of the JSON response, so the later requests can use the new user's id. If the create fails (for example, the API isn't running), the `if` stops the script and prints what came back, instead of sending nine more requests with an empty id. The script deletes the user at the end, so you can run it again and again.

Make it executable and run it:

```bash
chmod +x requests.sh && ./requests.sh
```

```
### POST /users (create)
created user id: 1

### GET /users 
[{"id":1,"name":"Ada Lovelace","email":"ada@example.com","created_at":"2026-10-23T09:24:17.406Z"}]
HTTP 200

### GET /users/1 
{"id":1,"name":"Ada Lovelace","email":"ada@example.com","created_at":"2026-10-23T09:24:17.406Z"}
HTTP 200

### PUT /users/1 {"name":"Ada King","email":"ada.king@example.com"}
{"id":1,"name":"Ada King","email":"ada.king@example.com","created_at":"2026-10-23T09:24:17.406Z"}
HTTP 200

### POST /users {"name":"Copy Cat","email":"ada.king@example.com"}
{"error":"email already exists"}
HTTP 409

### POST /users {"name":"","email":"not-an-email"}
{"error":"name is required"}
HTTP 400

### POST /users {"name": "Broken JSON"
{"error":"request body is not valid JSON"}
HTTP 400

### GET /users/abc 
{"error":"id must be a positive integer"}
HTTP 400

### DELETE /users/1 

HTTP 204

### GET /users/1 
{"error":"user not found"}
HTTP 404
```

Every request got the status code from the tables in the Concepts section. Notice `created_at`: Postgres stores it as a timestamp, `pg` turns it into a JavaScript `Date`, and `res.json()` turns that into a string, because JSON has no date type.

## Step 7: Break it on purpose

What does validation actually protect? Turn it off and see.

In **`src/users.js`**, find the `POST` route and comment out its two validation lines:

```javascript
router.post('/', async (req, res) => {
  // const error = validateUser(req.body);
  // if (error) return res.status(400).json({ error });
```

Save the file. `npm run dev` restarts the server automatically (watch the second terminal). Now send the same bad request as before, plus one with no name at all:

```bash
curl -sS -X POST localhost:8000/users -H 'Content-Type: application/json' \
  -d '{"name":"","email":"not-an-email"}' -w '\nHTTP %{http_code}\n'

curl -sS -X POST localhost:8000/users -H 'Content-Type: application/json' \
  -d '{"email":"someone@example.com"}' -w '\nHTTP %{http_code}\n'
```

<!-- PARTLY TESTED: the 201 row is from a real run (id 6 in the DB); the 500 response hasn't been seen on the VM yet -->
```
{"id":6,"name":"","email":"not-an-email","created_at":"2026-10-23T09:26:33.349Z"}
HTTP 201
{"error":"internal server error"}
HTTP 500
```

Your `id` will differ: it depends on how many users you've created so far.

Two different failures:

1. **Garbage got in.** A user with an empty name and an invalid email is now stored, and every client that reads it later has to deal with it.
2. **The client's mistake was blamed on the server.** With no name, the code calls `.trim()` on `undefined` and throws. The client gets a `500`, which says "the server is broken", when the real answer is `400`, "your request is wrong". The second terminal shows the `TypeError`.

Now undo the damage. **Don't skip this:** the next step builds the container from this same file, so leftover comments would end up inside the image.

1. Remove the `//` from the two lines and save. The dev server restarts again.
2. Delete the bad row:

   ```bash
   docker compose exec db psql -U app -d appdb -c "DELETE FROM users WHERE email = 'not-an-email'"
   ```

   ```
   DELETE 1
   ```

3. Confirm validation is back by sending the bad request once more:

   ```bash
   curl -sS -X POST localhost:8000/users -H 'Content-Type: application/json' \
     -d '{"name":"","email":"not-an-email"}' -w '\nHTTP %{http_code}\n'
   ```

   ```
   {"error":"name is required"}
   HTTP 400
   ```

   If you get `201` (or `409`), the validation lines are still commented out.

## Step 8: Run the API in a container

So far the API has run directly on the VM. The deliverable is a container, so the whole service can start anywhere with one command.

First, stop the dev server: go to the **second terminal** and press `Ctrl+C`. The container needs port 8000, and the dev server is still holding it. Back in the first terminal, check that the port is free:

```bash
ss -tln | grep -q ':8000 ' && echo "port 8000 is still in use" || echo "port 8000 is free"
```

`ss -tln` lists every port something is listening on. If this prints `port 8000 is still in use`, the dev server is still running: stop it before you continue. Otherwise `docker compose up` fails with `failed to bind host port 0.0.0.0:8000/tcp: address already in use`.

```
port 8000 is free
```

Create **`Dockerfile`**:

```dockerfile
FROM node:24-slim

WORKDIR /app

# Copy the dependency list first so this layer is cached between code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 8000
CMD ["node", "src/server.js"]
```

- `node:24-slim` is the official Node.js image, version 24, in a small variant.
- Copying `package.json` and `package-lock.json` before the code means Docker only reinstalls dependencies when they change, not on every code edit.
- `npm ci` installs exactly what `package-lock.json` lists. `--omit=dev` skips development-only packages.
- `CMD ["node", "src/server.js"]` (the exec form) starts Node directly as the main process.

Create **`.dockerignore`** so your local `node_modules` and `.env` never get copied into the image:

```
node_modules
.env
```

Now add the API service to **`docker-compose.yml`**. Replace the whole file with:

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
      retries: 15

  api:
    build: .
    environment:
      DATABASE_URL: postgres://app:app@db:5432/appdb
      PORT: 8000
    ports:
      - "8000:8000"
    depends_on:
      db:
        condition: service_healthy

volumes:
  pgdata:
```

What the new `api` service does:

- `build: .` builds the image from the `Dockerfile` in this folder.
- `DATABASE_URL` uses the host **`db`**, the service name, instead of `localhost`. Inside the container, `localhost` would be the API container itself.
- `ports: "8000:8000"` publishes the API on the VM's port 8000.
- `depends_on` with `condition: service_healthy` starts the API only after the database passes its healthcheck. Without the condition, Compose would only wait for the database container to *start*, and the API could try to connect before Postgres is ready.

Build and start the stack:

```bash
docker compose up -d --build --wait
```

`--build` builds the API image before starting. The first build downloads `node:24-slim` and runs `npm ci`, so expect a lot of build output. The end:

```
[+] up 4/4
 ✔ Image users-api-api       Built          1.6s
 ✔ Network users-api_default Created        0.0s
 ✔ Container users-api-db-1  Healthy        3.6s
 ✔ Container users-api-api-1 Healthy        3.6s
```

Check that both containers are up:

```bash
docker compose ps
```

```
NAME              IMAGE           COMMAND                  SERVICE   CREATED         STATUS                   PORTS
users-api-api-1   users-api-api   "docker-entrypoint.s…"   api       6 seconds ago   Up 2 seconds             0.0.0.0:8000->8000/tcp, [::]:8000->8000/tcp
users-api-db-1    postgres:17     "docker-entrypoint.s…"   db        6 seconds ago   Up 5 seconds (healthy)   127.0.0.1:5432->5432/tcp
```

The `api` row must show `0.0.0.0:8000->8000/tcp` under PORTS: that's the API published on the VM's port 8000.

Wait until the API answers, then run the same test collection against the container:

```bash
for i in $(seq 1 20); do curl -sf localhost:8000/users > /dev/null && break; sleep 1; done
./requests.sh
```

The `for` loop tries up to 20 times, one second apart, and stops (`break`) as soon as the API answers. `curl -f` makes curl fail on an error status, so only a real success ends the loop early. If the API never answers, `requests.sh` stops with `could not create the test user`.

> **If `requests.sh` can't connect:** run `docker compose ps` and look at the `api` row. If its PORTS column is empty, the container was created during an earlier `docker compose up` that failed (for example, with `address already in use`) and has no port mapping. Recreate it with `docker compose down`, then `docker compose up -d --build --wait`. `down` without `-v` keeps the database data.

The output should match Step 6, with new ids, because the database keeps counting. The same tests passing proves the containerized API behaves exactly like the one you ran by hand.

To see the API's logs from inside the container:

```bash
docker compose logs api
```

```
api-1  | users API listening on port 8000
```

## Conclusion

You built a users API that does CRUD properly:

- **Five REST routes** with precise status codes: `201`, `200` and `204` for success; `400`, `404` and `409` for client mistakes; `500` only when the server really fails.
- **Validation** at the edge, because the server can't trust the client. You saw what happens without it: garbage in the database, and client mistakes reported as server errors.
- **Safe database access** with parameterized queries and a connection pool.
- **One central error handler**, which Express 5 reaches automatically from `async` routes.
- **A containerized stack** where the API finds Postgres by service name and starts only once the database is healthy.
- **A test collection** (`requests.sh`) that checks every route and error case in one run.

The handlers here are simple: one short query each. In the **Async Patterns & Backpressure** lab, you'll look at what happens when a handler has to do a lot of work, such as many queries at once or a response far too big to hold in memory, and how async/await, concurrency limits and streams keep the server fast and its memory flat.
