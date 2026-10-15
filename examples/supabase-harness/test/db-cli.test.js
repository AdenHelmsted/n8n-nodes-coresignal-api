import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeSnapshot } from '../src/normalize.js';
import { snapshotRow, persistAvatarIfPresent, storeSnapshot, preflightDb } from '../src/db.js';
import { replayFile, main } from '../src/index.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/pdl.json', import.meta.url), 'utf8'));
const envelope = { id: 'f5e60000-0000-4000-8000-000000000001', provider: 'pdl', input: { url: 'https://www.linkedin.com/in/synthetic-person' },
  retrieved_at: '2026-10-15T01:00:00Z', http_status: 200, raw_payload: fixture, local_cache_path: 'fixture.json', request_count: 1 };

test('snapshot insert preserves legacy columns, resolution audit and review fields', () => {
  const s = normalizeSnapshot('pdl', envelope), row = snapshotRow(s);
  assert.equal(row.provider, 'pdl'); assert.equal(row.provider_name, 'pdl');
  assert.equal(row.match_status, 'matched_url'); assert.equal(row.review_status, undefined);
  assert.equal(row.provenance.cache_path, 'fixture.json');
  assert.deepEqual(row.raw_response, fixture);
  const resolved = snapshotRow(normalizeSnapshot('pdl', { ...envelope, input: { first: 'Synthetic', last: 'Person', company: 'Example' } }));
  assert.match(resolved.requested_linkedin_url, /^resolve:[0-9a-f]{64}$/);
  assert.equal(resolved.provenance.identity_status, 'search_match');
});

test('disk replay normalizes with no provider or avatar HTTP call', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'helmsted-replay-')), file = join(folder, 'raw.json');
  await writeFile(file, JSON.stringify(envelope));
  let calls = 0;
  const result = await replayFile(file, async (s, options) => {
    assert.equal(options.replay, true); assert.equal(s.provider_name, 'pdl');
    assert.equal(s.returned_linkedin_url, 'https://www.linkedin.com/in/synthetic-person');
    return storeSnapshot(fakeDb(), s, { ...options, fetchImpl: () => { calls++; throw new Error('No network'); } });
  });
  assert.equal(calls, 0); assert.equal(result.applied, true);
});

function fakeDb({ applied = false, conflict = false } = {}) {
  let tries = 0;
  return {
    from(table) { return {
      upsert: async (row, options) => { assert.equal(options.ignoreDuplicates, true); return { data: row }; },
      select(fields) { return { eq() { return {
        single: async () => ({ data: { canonical_applied_at: applied ? '2026-10-15' : null, person_id: 'existing' } }),
        maybeSingle: async () => ({ data: null }),
      }; } }; },
    }; },
    rpc: async (name, args) => {
      assert.equal(name, 'apply_person_enrichment'); assert.equal(args.p_person._expected_updated_at, null);
      if (conflict && tries++ === 0) return { error: { code: '40001' } };
      return { data: { applied: true, person_id: args.p_person.id } };
    },
  };
}

test('replayed IDs skip canonical merge; CAS retries do not call a provider', async () => {
  const snapshot = normalizeSnapshot('pdl', envelope);
  assert.equal((await storeSnapshot(fakeDb({ applied: true }), snapshot, { replay: true })).replayed, true);
  assert.equal((await storeSnapshot(fakeDb({ conflict: true }), snapshot, { replay: true })).applied, true);
});

test('preflight detects partial migrations before any collection', async () => {
  const queried = [];
  const db = { from(table) { return { select(fields) { queried.push([table, fields]); return { limit: async () => ({ data: [] }) }; } }; },
    rpc: async () => ({ error: { code: '23503' } }) };
  await preflightDb(db);
  assert.deepEqual(queried.map(([table]) => table), ['people', 'person_enrichments', 'person_changes']);
  db.rpc = async () => ({ error: { code: 'PGRST202' } });
  await assert.rejects(() => preflightDb(db), /complete SQL migration/);
  db.from = () => ({ select: () => ({ limit: async () => ({ error: { code: '42703' } }) }) });
  await assert.rejects(() => preflightDb(db), /42703/);
});

test('offline name resolution uses only PDL and never fetches', async () => {
  const oldFetch = globalThis.fetch, oldLog = console.log, logs = [];
  globalThis.fetch = () => { throw new Error('Unexpected network request'); };
  console.log = line => logs.push(line);
  try {
    const result = await main(['--resolve', '--first', 'Synthetic', '--last', 'Person', '--company', 'Example', '--offline'], {});
    assert.equal(result.processed, 1);
    assert.ok(logs.some(line => line === 'coresignal: skipped (URL required).'));
    assert.ok(logs.some(line => line === 'brightdata: skipped (URL required).'));
  } finally { globalThis.fetch = oldFetch; console.log = oldLog; }
});

test('avatar validates trusted host, mime and size; unchanged bytes skip upload', async () => {
  let downloads = 0, uploads = 0;
  const db = { storage: { from: name => ({ upload: async (path, bytes, options) => {
    uploads++; assert.equal(name, 'person-avatars'); assert.equal(bytes.length, 600); assert.equal(options.upsert, true); return { data: { path } };
  } }) } };
  const s = { identity_status: 'matched', avatar_source_url: 'https://media.licdn.com/avatar.jpg' };
  const get = async () => { downloads++; return new Response(Buffer.alloc(600), { status: 200, headers: { 'content-type': 'image/jpeg' } }); };
  const saved = await persistAvatarIfPresent(db, s, { id: 'person' }, get);
  assert.match(saved.avatar_storage_path, /^person-avatars\/person\/[a-f0-9]{64}\.jpg$/);
  await persistAvatarIfPresent(db, s, { id: 'person', avatar_sha256: saved.avatar_sha256 }, get);
  assert.equal(uploads, 1);
  await persistAvatarIfPresent(db, { ...s, avatar_source_url: 'http://127.0.0.1/private' }, {}, get);
  assert.equal(downloads, 2);
  for (const response of [new Response('no', { status: 403 }), new Response('html', { headers: { 'content-type': 'text/html' } }),
    new Response(Buffer.alloc(499), { headers: { 'content-type': 'image/jpeg' } }),
    new Response(Buffer.alloc(5_242_881), { headers: { 'content-type': 'image/jpeg' } })]) {
    assert.deepEqual(await persistAvatarIfPresent(db, s, {}, async () => response), {});
  }
});
