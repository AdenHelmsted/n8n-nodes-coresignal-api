import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDb, storeSnapshot } from '../src/db.js';
import { normalizeSnapshot } from '../src/normalize.js';
import { collect as coresignal } from '../src/providers/coresignal.js';
import { collect as pdl } from '../src/providers/pdl.js';
import { collect as brightdata } from '../src/providers/brightdata.js';

let PGlite;
for (const path of [process.env.PGLITE_MODULE_PATH, '@electric-sql/pglite', 'file:///tmp/helmsted-schema-check/node_modules/@electric-sql/pglite/dist/index.js'].filter(Boolean)) {
  try { ({ PGlite } = await import(path)); break; } catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error; }
}
test('cached provider response -> official Supabase SDK -> SQL canonical merge, diff and replay', { skip: !PGlite }, async t => {
  const sql = new PGlite();
  t.after(() => sql.close());
  await sql.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,name text,public boolean);');
  await sql.exec(await readFile(new URL('../schema.sql', import.meta.url), 'utf8'));
  await sql.exec(await readFile(new URL('../sql/002_canonical_people_and_changes.sql', import.meta.url), 'utf8'));
  await sql.exec('set role service_role');
  let providerCalls = 0;
  const rest = async (inputUrl, init) => {
    const url = new URL(inputUrl), path = url.pathname.split('/').at(-1);
    try {
      if (path === 'apply_person_enrichment') {
        const args = JSON.parse(init.body);
        const result = await sql.query('select public.apply_person_enrichment($1::jsonb,$2::jsonb,$3::uuid,$4::text) as result',
          [JSON.stringify(args.p_person), args.p_change && JSON.stringify(args.p_change), args.p_enrichment_id, args.p_expected_hash]);
        return json(result.rows[0].result);
      }
      assert.ok(['people', 'person_enrichments'].includes(path));
      if (init.method === 'POST') {
        const row = JSON.parse(init.body), keys = Object.keys(row);
        await sql.query(`insert into public.person_enrichments (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) on conflict(id) do nothing`,
          keys.map(key => row[key] && typeof row[key] === 'object' ? JSON.stringify(row[key]) : row[key]));
        return new Response(null, { status: 201 });
      }
      const field = path === 'people' ? 'canonical_linkedin_url' : 'id';
      const value = url.searchParams.get(field).slice(3);
      const { rows } = await sql.query(`select * from public.${path} where ${field}=$1`, [value]);
      const single = new Headers(init.headers).get('accept')?.includes('object');
      return single ? rows.length ? json(rows[0]) : json({ code: 'PGRST116', details: 'The result contains 0 rows', message: 'No rows' }, 406) : json(rows);
    } catch (error) { return json({ code: error.code, message: error.message }, 400); }
  };
  const db = createDb({ SUPABASE_URL: 'https://unit-test.supabase.co', SUPABASE_SECRET_KEY: 'test-key' }, rest);
  const folder = await mkdtemp(join(tmpdir(), 'helmsted-pipeline-'));
  const fixtures = {}, envelopes = [];
  for (const [provider, adapter] of Object.entries({ coresignal, pdl, brightdata })) {
    fixtures[provider] = JSON.parse(await readFile(new URL(`./fixtures/${provider}.json`, import.meta.url), 'utf8'));
    const raw = fixtures[provider];
    const envelope = await adapter({ url: 'https://www.linkedin.com/in/synthetic-person' }, {
      env: { CORESIGNAL_API_KEY: 'core-test', PDL_API_KEY: 'pdl-test', BRIGHTDATA_API_KEY: 'bright-test' }, cacheDir: folder,
      fetchImpl: async () => { providerCalls++; return json(raw); },
    });
    assert.deepEqual(JSON.parse(await readFile(envelope.local_cache_path, 'utf8')).raw_payload, raw);
    envelopes.push(envelope);
    await storeSnapshot(db, normalizeSnapshot(provider, envelope), { replay: true });
  }
  const people = (await sql.query('select * from public.people')).rows;
  assert.equal(people.length, 1);
  assert.deepEqual(people[0].providers_contributed, ['brightdata', 'coresignal', 'pdl']);
  assert.ok(people[0].employment_history.filter(job => job.is_current).length >= 2);
  assert.equal(people[0].field_provenance.full_name.provider, 'coresignal');
  const priorEvents = (await sql.query('select count(*)::int as count from public.person_changes')).rows[0].count;
  const changed = structuredClone(fixtures.coresignal);
  changed.updated_at = '2026-10-15T23:00:00Z'; changed.headline = 'Updated professional headline';
  changed.experience[1].active_experience = 0; changed.experience[1].date_to = '2026-10';
  const updated = await coresignal({ url: 'https://www.linkedin.com/in/synthetic-person' }, {
    env: { CORESIGNAL_API_KEY: 'core-test' }, cacheDir: folder,
    fetchImpl: async () => { providerCalls++; return json(changed); },
  });
  await storeSnapshot(db, normalizeSnapshot('coresignal', updated), { replay: true });
  const events = (await sql.query('select * from public.person_changes order by detected_at')).rows;
  assert.equal(events.length, priorEvents + 1);
  assert.ok(events.at(-1).change_types.includes('job_ended'));
  assert.ok(events.at(-1).change_types.includes('headline_changed'));
  const finalHash = (await sql.query('select profile_hash from public.people')).rows[0].profile_hash;
  await storeSnapshot(db, normalizeSnapshot('coresignal', envelopes[0]), { replay: true });
  assert.equal((await sql.query('select profile_hash from public.people')).rows[0].profile_hash, finalHash);
  assert.equal((await sql.query('select count(*)::int as count from public.person_changes')).rows[0].count, events.length);
  assert.equal(providerCalls, 4); // Replaying the old response made no fifth provider request.
});
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }
