// Smoke tests: run against the running stack with `npm test`.
// One happy path and one failure case for each capability.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL ?? 'http://localhost:8000';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

test('health: the service reports ok', async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'ok');
});

// --- CRUD (users) ---

test('users: create, read and delete a user', async () => {
  const email = `smoke-${Date.now()}@example.com`;
  const created = await fetch(`${BASE}/users`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: 'Smoke Test', email }),
  });
  assert.equal(created.status, 201);
  const user = await created.json();

  const read = await fetch(`${BASE}/users/${user.id}`);
  assert.equal(read.status, 200);
  assert.equal((await read.json()).email, email);

  const deleted = await fetch(`${BASE}/users/${user.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 204);
});

test('users: an invalid user is rejected with 400', async () => {
  const res = await fetch(`${BASE}/users`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: '', email: 'not-an-email' }),
  });
  assert.equal(res.status, 400);
});

// --- Async patterns (reports) ---

test('reports: the dashboard returns all three parts', async () => {
  const res = await fetch(`${BASE}/reports/dashboard/42`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.id, 42);
  assert.ok(body.firstUser && body.newestUser);
});

test('reports: the dashboard of a missing user is 404', async () => {
  const res = await fetch(`${BASE}/reports/dashboard/999999999`);
  assert.equal(res.status, 404);
});

// --- Streaming (events) ---

test('events: a subscriber receives a published message', { timeout: 5000 }, async () => {
  const subscription = new AbortController();
  const res = await fetch(`${BASE}/events`, { signal: subscription.signal });
  assert.match(res.headers.get('content-type'), /^text\/event-stream/);
  const reader = res.body.getReader();
  await reader.read(); // the "connected" event

  const message = `smoke ${Date.now()}`;
  const published = await fetch(`${BASE}/events`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ message }),
  });
  assert.equal(published.status, 201);

  // Read the stream until the message arrives (the test times out if it never does).
  let received = '';
  while (!received.includes(message)) {
    received += new TextDecoder().decode((await reader.read()).value);
  }
  subscription.abort();
});

test('events: publishing an empty message is rejected with 400', async () => {
  const res = await fetch(`${BASE}/events`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ message: '' }),
  });
  assert.equal(res.status, 400);
});
