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

// TODO (Task 4): for each capability (users, reports, events),
// add one happy-path test and one failure-case test.
