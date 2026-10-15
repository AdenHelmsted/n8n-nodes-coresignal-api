import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requestCached } from '../src/providers/request.js';
import { normalizeSnapshot } from '../src/normalize.js';
import { snapshotRow } from '../src/db.js';

async function cached(t, response) {
  await mkdir('.cache', { recursive: true });
  const cacheDir = await mkdtemp(resolve('.cache', 'billing-test-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  return requestCached('pdl', { url: 'https://www.linkedin.com/in/synthetic-person' }, 'https://example.invalid/person',
    { method: 'GET' }, { cacheDir, fetchImpl: async () => response });
}

test('billing headers capture exact case-insensitive response values in cache and snapshot provenance', async t => {
  const headers = new Headers({
    'X-Credits-Remaining': '001990', 'X-RateLimit-Remaining': '0', 'X-Call-Credits-Spent': '0002',
    'X-Call-Credits-Type': 'enrich', 'X-TotalLimit-Remaining': '08', 'X-TotalLimit-Purchased-Remaining': '007',
    'X-Lifetime-Used': '123.50', 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT', 'X-Unrelated': 'omit-me',
  });
  const expected = {
    'x-credits-remaining': '001990', 'x-ratelimit-remaining': '0', 'x-call-credits-spent': '0002',
    'x-call-credits-type': 'enrich', 'x-totallimit-remaining': '08', 'x-totallimit-purchased-remaining': '007',
    'x-lifetime-used': '123.50', 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT',
  };
  const envelope = await cached(t, Response.json({ data: { id: 'synthetic' } }, { headers }));
  assert.deepEqual(envelope.billing_headers, expected);
  assert.equal(envelope.estimated_credits, null);
  assert.deepEqual(JSON.parse(await readFile(envelope.local_cache_path, 'utf8')).billing_headers, expected);
  const row = snapshotRow(normalizeSnapshot('pdl', envelope));
  assert.deepEqual(row.provenance.billing_headers, expected);
  assert.equal(row.estimated_credits, null);
});

test('missing billing headers stay null instead of deriving spend from success or a cached balance', async t => {
  const envelope = await cached(t, Response.json({ data: { id: 'synthetic' } }));
  assert.equal(envelope.billing_headers, null);
  assert.equal(envelope.estimated_credits, null);
  assert.equal(JSON.parse(await readFile(envelope.local_cache_path, 'utf8')).billing_headers, null);
  const { billing_headers, ...olderEnvelope } = envelope;
  olderEnvelope.credits_remaining = 1990;
  olderEnvelope.estimated_credits = 10;
  const snapshot = normalizeSnapshot('pdl', olderEnvelope);
  assert.equal(snapshot.billing_headers, null);
  const row = snapshotRow(snapshot);
  assert.equal(row.provenance.billing_headers, null);
  assert.equal(row.estimated_credits, null);
  assert.equal(olderEnvelope.estimated_credits, 10, 'Replay must not mutate historical cache evidence');
});

test('error responses retain only present telemetry headers, including zero and retry-after', async t => {
  const envelope = await cached(t, Response.json({ error: 'synthetic limit' }, {
    status: 429, headers: { 'X-RateLimit-Remaining': '0', 'Retry-After': '10' },
  }));
  assert.deepEqual(envelope.billing_headers, { 'x-ratelimit-remaining': '0', 'retry-after': '10' });
  assert.equal(envelope.http_status, 429);
  assert.equal(envelope.estimated_credits, null);
});

test('network failure does not invent response headers or credit costs', async t => {
  const envelope = await cached(t, { get status() { throw new Error('simulated unavailable response'); } });
  assert.equal(envelope.billing_headers, null);
  assert.equal(envelope.estimated_credits, null);
  assert.equal(envelope.http_status, null);
});
