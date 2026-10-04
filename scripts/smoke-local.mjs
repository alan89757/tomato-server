import 'dotenv/config';
import assert from 'node:assert/strict';

const base =
  process.env.API_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}/api`;
const headers = process.env.API_KEY ? { 'X-API-Key': process.env.API_KEY } : {};
for (const route of [
  'health',
  'snapshot',
  'tasks',
  'sessions',
  'timer',
  'stats?days=7',
  'docs-json',
]) {
  const response = await fetch(`${base}/${route}`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200, `${route}: HTTP ${response.status}`);
  const body = await response.json();
  if (route === 'health') assert.equal(body.database, 'up');
  if (route === 'snapshot') {
    assert.equal(body.version, 1);
    assert.ok(response.headers.get('etag'));
  }
  if (route === 'docs-json') {
    assert.ok(body.paths['/api/snapshot']);
  }
  console.log(`PASS GET /api/${route}`);
}
