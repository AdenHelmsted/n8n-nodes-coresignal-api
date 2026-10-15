import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replayFile } from '../src/index.js';
import { snapshotRow } from '../src/db.js';
import { makeSnapshot } from '../harness.mjs';

test('legacy replay preserves captured headers and never exposes a historical estimate as measured spend', async () => {
  const raw = JSON.parse(await readFile(new URL('../fixtures/person.json', import.meta.url), 'utf8'));
  const original = makeSnapshot('https://www.linkedin.com/in/synthetic-person/', { status: 200, body: raw,
    creditsRemaining: 1990, billing_headers: { 'x-credits-remaining': '1990', 'x-ratelimit-remaining': '0' } });
  original.estimated_credits = 10; // Explicit historical fixture, not a measured debit.
  const file = join(await mkdtemp(join(tmpdir(), 'helmsted-legacy-billing-')), 'run.json');
  await writeFile(file, JSON.stringify(original));
  await replayFile(file, snapshot => {
    assert.equal(snapshot.estimated_credits, null);
    assert.deepEqual(snapshotRow(snapshot).provenance.billing_headers, original.provenance.billing_headers);
  });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).estimated_credits, 10);
  delete original.provenance.billing_headers;
  await writeFile(file, JSON.stringify(original));
  await replayFile(file, snapshot => {
    assert.equal(snapshotRow(snapshot).provenance.billing_headers, null);
    assert.equal(snapshotRow(snapshot).credits_remaining, 1990);
    assert.equal(snapshot.estimated_credits, null);
  });
});
