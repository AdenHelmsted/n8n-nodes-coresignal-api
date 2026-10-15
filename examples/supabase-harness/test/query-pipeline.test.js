import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, replayFile } from '../src/index.js';
import { normalizeSnapshot } from '../src/normalize.js';
import { createDb, storeSnapshot } from '../src/db.js';

let PGlite;
for (const modulePath of [process.env.PGLITE_MODULE_PATH, '@electric-sql/pglite',
  'file:///tmp/helmsted-schema-check/node_modules/@electric-sql/pglite/dist/index.js'].filter(Boolean)) {
  try { ({ PGlite } = await import(modulePath)); break; } catch (error) {
    if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error;
  }
}
const url = 'https://www.linkedin.com/in/synthetic-person';
const env = { SUPABASE_URL: 'https://unit-test.supabase.co', SUPABASE_SECRET_KEY: 'test-key',
  PDL_API_KEY: 'pdl-test', CORESIGNAL_API_KEY: 'core-test', BRIGHTDATA_API_KEY: 'bright-test' };
const json = (value, status = 200) => Response.json(value, { status });
async function quiet(action) {
  const old = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = () => {};
  try { return await action(); } finally { Object.assign(console, old); }
}
async function setup(t) {
  const sql = new PGlite(), cacheDir = await mkdtemp(join(tmpdir(), 'helmsted-query-sql-'));
  t.after(async () => { await sql.close(); await rm(cacheDir, { recursive: true, force: true }); });
  await sql.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,name text,public boolean);');
  for (const file of ['../schema.sql', '../sql/002_canonical_people_and_changes.sql']) await sql.exec(await readFile(new URL(file, import.meta.url), 'utf8'));
  await sql.exec('set role service_role');
  const fixtures = Object.fromEntries(await Promise.all(['pdl', 'coresignal', 'brightdata'].map(async provider =>
    [provider, JSON.parse(await readFile(new URL(`./fixtures/${provider}.json`, import.meta.url), 'utf8'))])));
  const calls = [];
  // Real official SDK requests terminate here in local PostgreSQL. No hosted or provider network is used.
  const fetchImpl = async (inputUrl, init) => {
    const request = new URL(inputUrl), path = request.pathname.split('/').at(-1);
    if (request.hostname !== 'unit-test.supabase.co') {
      const provider = request.hostname === 'api.peopledatalabs.com' ? 'pdl' : request.hostname === 'api.coresignal.com' ? 'coresignal'
        : request.hostname === 'api.brightdata.com' ? 'brightdata' : null;
      assert.ok(provider, `Unexpected HTTP target: ${request.origin}`);
      calls.push(provider); return json(fixtures[provider]);
    }
    try {
      if (path === 'apply_person_enrichment') {
        const args = JSON.parse(init.body);
        const result = await sql.query('select public.apply_person_enrichment($1::jsonb,$2::jsonb,$3::uuid,$4::text) as result',
          [JSON.stringify(args.p_person), args.p_change && JSON.stringify(args.p_change), args.p_enrichment_id, args.p_expected_hash]);
        return json(result.rows[0].result);
      }
      assert.ok(['people', 'person_enrichments', 'person_changes'].includes(path), `Unexpected REST table: ${path}`);
      if (init.method === 'POST') {
        assert.equal(path, 'person_enrichments');
        const row = JSON.parse(init.body), keys = Object.keys(row);
        await sql.query(`insert into public.person_enrichments (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) on conflict(id) do nothing`,
          keys.map(key => row[key] && typeof row[key] === 'object' ? JSON.stringify(row[key]) : row[key]));
        return new Response(null, { status: 201 });
      }
      if (request.searchParams.get('limit') === '0') return json([]);
      const field = path === 'people' ? 'canonical_linkedin_url' : 'id', filter = request.searchParams.get(field);
      assert.ok(filter?.startsWith('eq.'));
      const { rows } = await sql.query(`select * from public.${path} where ${field}=$1`, [filter.slice(3)]);
      const single = new Headers(init.headers).get('accept')?.includes('object');
      return single ? rows.length ? json(rows[0]) : json({ code: 'PGRST116', details: 'The result contains 0 rows', message: 'No rows' }, 406) : json(rows);
    } catch (error) { return json({ code: error.code, message: error.message }, 400); }
  };
  const db = createDb(env, fetchImpl);
  const rows = async (query, values = []) => (await sql.query(query, values)).rows;
  const saved = async () => Promise.all((await readdir(cacheDir)).filter(name => name.endsWith('.json')).map(async name =>
    JSON.parse(await readFile(join(cacheDir, name), 'utf8'))));
  return { sql, db, rows, saved, cacheDir, fixtures, calls, fetchImpl };
}
const skip = !PGlite && 'Install optional test-only PGlite as documented in test/schema.test.js';

test('query CLI -> mocked providers -> official Supabase SDK -> PostgreSQL remains an unverified candidate through replay', { skip }, async t => {
  const { sql, rows, saved, cacheDir, fixtures, calls, fetchImpl } = await setup(t);
  fixtures.pdl.data.headline = 'Advisor at Example Advisors';
  await quiet(() => main(['--query', 'Synthetic Person at Example Advisors'], env, { cacheDir, fetchImpl }));
  assert.deepEqual(calls, ['pdl', 'coresignal', 'brightdata']);
  const people = await rows('select * from public.people');
  assert.equal(people.length, 1); assert.equal(people[0].canonical_linkedin_url, url);
  assert.equal(people[0].identity_confidence, 'unverified_search_match'); assert.equal(people[0].needs_manual_review, true);
  assert.deepEqual(people[0].providers_contributed, ['brightdata', 'coresignal', 'pdl']);
  const snapshots = await rows('select * from public.person_enrichments');
  assert.equal(snapshots.length, 3);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.person_id, people[0].id); assert.ok(snapshot.canonical_applied_at);
    assert.equal(snapshot.provenance.identity_status, 'search_match');
    assert.equal(snapshot.provenance.decision_receipt.action, 'accept_and_waterfall');
    assert.equal(snapshot.match_status, 'unverified'); assert.equal(snapshot.estimated_credits, null);
  }
  const pdl = snapshots.find(snapshot => snapshot.provider === 'pdl');
  await sql.query("update public.person_enrichments set review_status='correct',review_notes='Human confirmed this fictional match',reviewed_at='2026-10-15T12:30:00Z' where id=$1", [pdl.id]);
  const before = { hash: people[0].profile_hash, events: (await rows('select count(*)::int as n from public.person_changes'))[0].n };
  for (let replay = 0; replay < 2; replay++) for (const envelope of await saved()) {
    await quiet(() => main(['--replay', envelope.local_cache_path], env, { fetchImpl }));
  }
  const [after] = await rows('select * from public.people');
  assert.equal(after.identity_confidence, 'unverified_search_match'); assert.equal(after.profile_hash, before.hash);
  assert.equal((await rows('select count(*)::int as n from public.person_enrichments'))[0].n, 3);
  assert.equal((await rows('select count(*)::int as n from public.person_changes'))[0].n, before.events);
  const [review] = await rows('select review_status,review_notes,reviewed_at from public.person_enrichments where id=$1', [pdl.id]);
  assert.equal(review.review_status, 'correct'); assert.equal(review.review_notes, 'Human confirmed this fictional match');
  assert.equal(new Date(review.reviewed_at).toISOString(), '2026-10-15T12:30:00.000Z');
  assert.deepEqual(calls, ['pdl', 'coresignal', 'brightdata'], 'Replay cannot start a new provider collection');
});

test('search waterfall cannot overwrite a verified canonical person, including higher-priority followups', { skip }, async t => {
  const { db, rows, saved, cacheDir, fixtures, calls, fetchImpl } = await setup(t);
  const verified = structuredClone(fixtures.pdl);
  verified.data.headline = 'Human verified baseline';
  const seed = normalizeSnapshot('pdl', { id: randomUUID(), provider: 'pdl', input: { url },
    retrieved_at: '2026-10-14T00:00:00Z', http_status: 200, raw_payload: verified, request_count: 1 });
  await storeSnapshot(db, seed, { replay: true });
  const [before] = await rows('select * from public.people');
  assert.equal(before.identity_confidence, 'verified');
  fixtures.pdl.data.headline = 'Advisor at Example Advisors';
  fixtures.coresignal.full_name = 'A conflicting higher-priority imported name';
  fixtures.coresignal.headline = 'Search-only changed headline';
  fixtures.coresignal.experience.push({ company_name: 'Search-only Employer', position_title: 'Director', active_experience: 1 });
  await quiet(() => main(['--resolve', '--first', 'Synthetic', '--last', 'Person', '--company', 'Example Advisors'], env,
    { cacheDir, fetchImpl }));
  assert.deepEqual(calls, ['pdl', 'coresignal', 'brightdata']);
  const [after] = await rows('select * from public.people');
  for (const field of ['full_name', 'headline', 'profile_hash', 'identity_confidence', 'field_provenance',
    'employment_history', 'education', 'providers_contributed', 'last_enriched_at']) assert.deepEqual(after[field], before[field], field);
  assert.equal(after.needs_manual_review, true);
  assert.equal((await rows('select count(*)::int as n from public.people'))[0].n, 1);
  assert.equal((await rows('select count(*)::int as n from public.person_changes'))[0].n, 0);
  for (const envelope of await saved()) await replayFile(envelope.local_cache_path, async (snapshot, options) => {
    assert.equal(snapshot.identity_status, 'search_match'); return storeSnapshot(db, snapshot, { ...options, fetchImpl });
  });
  assert.equal((await rows('select profile_hash from public.people'))[0].profile_hash, before.profile_hash);
  assert.equal((await rows('select count(*)::int as n from public.person_enrichments'))[0].n, 4);
  assert.equal(calls.length, 3);
});

test('wrong-name legacy raw search cache cannot bypass the gate or create a canonical person', { skip }, async t => {
  const { db, rows, cacheDir, fixtures, calls, fetchImpl } = await setup(t);
  const envelope = { id: randomUUID(), provider: 'pdl', input: { first: 'Different', last: 'Name', company: 'Example Advisors' },
    retrieved_at: '2020-01-01T00:00:00Z', http_status: 200, raw_payload: fixtures.pdl, request_count: 1,
    provenance: { decision_receipt: { action: 'accept_and_waterfall', confidence_interval: [1, 1] } } };
  const file = join(cacheDir, 'legacy-search.json');
  await writeFile(file, JSON.stringify(envelope));
  const result = await replayFile(file, async (snapshot, options) => {
    assert.equal(snapshot.provenance.decision_receipt.action, 'abstain_reject');
    assert.equal(snapshot.identity_status, 'missing_url'); return storeSnapshot(db, snapshot, { ...options, fetchImpl });
  });
  assert.equal(result.snapshot_only, true);
  assert.equal((await rows('select count(*)::int as n from public.people'))[0].n, 0);
  const [snapshot] = await rows('select * from public.person_enrichments');
  assert.equal(snapshot.person_id, null); assert.equal(snapshot.canonical_applied_at, null);
  assert.equal(snapshot.provenance.decision_receipt.confidence_interval[0], 0);
  assert.deepEqual(snapshot.raw_response, envelope.raw_payload); assert.equal(calls.length, 0);
});
