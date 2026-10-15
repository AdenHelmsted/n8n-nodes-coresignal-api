import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Test-only PostgreSQL engine. No dependency is added to the application.
// npm install --prefix /tmp/helmsted-schema-check --no-save @electric-sql/pglite
let PGlite;
for (const modulePath of [process.env.PGLITE_MODULE_PATH, '@electric-sql/pglite',
  'file:///tmp/helmsted-schema-check/node_modules/@electric-sql/pglite/dist/index.js'].filter(Boolean)) {
  try { ({ PGlite } = await import(modulePath)); break; } catch (error) {
    if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error;
  }
}

test('PostgreSQL schema and atomic canonical imports', { skip: !PGlite && 'Install optional test-only PGlite (see test/schema.test.js)' }, async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
  `);
  const legacy = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../sql/002_canonical_people_and_changes.sql', import.meta.url), 'utf8');
  const rows = async (sql, values = []) => (await db.query(sql, values)).rows;
  const one = async (sql, values = []) => (await rows(sql, values))[0];
  const asRole = async (role, action) => {
    await db.exec(`set role ${role}`);
    try { return await action(); } finally { await db.exec('reset role'); }
  };
  const snapshot = (patch = {}) => ({
    id: randomUUID(), provider: 'coresignal', requested_linkedin_url: 'https://www.linkedin.com/in/test-person',
    name: 'Test Person', linkedin_url: 'https://www.linkedin.com/in/test-person',
    headline: 'Advisor', location: 'Chicago, IL',
    employment_history: [{ title: 'Advisor', active_experience: 1 }, { title: 'Trustee', active_experience: 1 }],
    education: [{ institution: 'Test University' }], profile_picture_ref: 'https://example.test/photo.jpg',
    retrieved_at: '2026-10-15T12:00:00Z', provider_record_id: 'test-record', source_updated_at: '2026-10-01',
    match_status: 'matched_url', http_status: 200, request_count: 1, estimated_credits: 10, credits_remaining: 1990,
    provenance: { provider: 'coresignal', fields: { name: 'full_name', employment_history: 'experience' } },
    raw_response: { full_name: 'Test Person', source: ['a', 'b'] }, review_status: 'pending', ...patch,
  });
  const insertSnapshot = async row => {
    const keys = Object.keys(row);
    const values = Object.values(row).map(v => v && typeof v === 'object' ? JSON.stringify(v) : v);
    await db.query(`insert into public.person_enrichments (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) on conflict (id) do nothing`, values);
    return row;
  };
  const canonical = (patch = {}) => ({
    id: randomUUID(), canonical_linkedin_url: 'https://www.linkedin.com/in/test-person', linkedin_slug: 'test-person',
    full_name: 'Test Person', headline: 'Advisor', location: 'Chicago, IL', current_title: 'Advisor', current_company: 'Example',
    employment_history: [{ title: 'Advisor', company_name: 'Example', is_current: true }],
    education: [], field_provenance: { full_name: { provider: 'coresignal', retrieved_at: '2026-10-15T12:00:00Z' } },
    providers_contributed: ['coresignal'], profile_hash: 'hash-1', ...patch,
  });
  const apply = async (person, enrichment, expected = null, change = null) => (await one(
    'select public.apply_person_enrichment($1::jsonb, $2::jsonb, $3::uuid, $4::text) as result',
    [JSON.stringify(person), change && JSON.stringify(change), enrichment.id, expected])).result;

  // Preserve the seven checks from the original local PostgreSQL validation.
  await t.test('1: both migrations are repeatable and preserve every legacy column and row', async () => {
    await db.exec(legacy);
    const before = (await rows(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'person_enrichments'`)).map(r => r.column_name);
    const saved = await insertSnapshot(snapshot({ review_status: 'correct', review_notes: 'Manually checked' }));
    await db.exec(legacy);
    await db.exec(migration);
    await db.exec(migration);
    const after = (await rows(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'person_enrichments'`)).map(r => r.column_name);
    assert.ok(before.every(column => after.includes(column)));
    assert.equal((await one('select review_notes from public.person_enrichments where id = $1', [saved.id])).review_notes, 'Manually checked');
    assert.equal((await one(`select data_type from information_schema.columns where table_name = 'person_enrichments' and column_name = 'id'`)).data_type, 'uuid');
  });
  await t.test('2: all internal tables enable row level security', async () => {
    const settings = await rows(`select relname, relrowsecurity from pg_class where oid in ('public.people'::regclass, 'public.person_changes'::regclass, 'public.person_enrichments'::regclass)`);
    assert.equal(settings.length, 3);
    assert.ok(settings.every(row => row.relrowsecurity));
  });
  await t.test('3: anonymous and authenticated roles cannot CRUD tables or execute the RPC', async () => {
    for (const role of ['anon', 'authenticated']) await asRole(role, async () => {
      for (const table of ['person_enrichments', 'people', 'person_changes']) {
        for (const sql of [`select * from public.${table}`, `insert into public.${table} default values`,
          `update public.${table} set id = id`, `delete from public.${table}`]) {
          await assert.rejects(() => db.exec(sql), error => error.code === '42501');
        }
      }
      await assert.rejects(() => db.exec(`select public.apply_person_enrichment('{}', null, '${randomUUID()}', null)`), error => error.code === '42501');
    });
  });
  await t.test('4: the service role can create, read, update and delete internal snapshots', async () => {
    await asRole('service_role', async () => {
      const saved = await insertSnapshot(snapshot());
      assert.equal((await one('select provider from public.person_enrichments where id = $1', [saved.id])).provider, 'coresignal');
      await db.query('update public.person_enrichments set review_notes = $1 where id = $2', ['Checked', saved.id]);
      assert.equal((await one('select review_notes from public.person_enrichments where id = $1', [saved.id])).review_notes, 'Checked');
      await db.query('delete from public.person_enrichments where id = $1', [saved.id]);
      assert.equal((await rows('select id from public.person_enrichments where id = $1', [saved.id])).length, 0);
    });
  });
  await t.test('5: all original JSON, provenance, usage and source fields round trip', async () => {
    const saved = await insertSnapshot(snapshot());
    const stored = await one('select * from public.person_enrichments where id = $1', [saved.id]);
    for (const field of ['employment_history', 'education', 'provenance', 'raw_response']) assert.deepEqual(stored[field], saved[field]);
    for (const field of ['name', 'linkedin_url', 'headline', 'location', 'profile_picture_ref', 'provider_record_id',
      'source_updated_at', 'match_status', 'http_status', 'request_count', 'estimated_credits', 'credits_remaining']) assert.equal(stored[field], saved[field]);
    assert.equal(new Date(stored.retrieved_at).toISOString(), new Date(saved.retrieved_at).toISOString());
  });
  await t.test('6: duplicate snapshot replay preserves manual reviews', async () => {
    const saved = await insertSnapshot(snapshot());
    await db.query(`update public.person_enrichments set review_status = 'correct', review_notes = 'Verified facts', reviewed_at = now() where id = $1`, [saved.id]);
    await insertSnapshot({ ...saved, name: 'Overwritten?', review_status: 'pending' });
    const stored = await one('select * from public.person_enrichments where id = $1', [saved.id]);
    assert.equal(stored.name, 'Test Person');
    assert.equal(stored.review_status, 'correct');
    assert.equal(stored.review_notes, 'Verified facts');
    assert.ok(stored.reviewed_at);
  });
  await t.test('7: separate snapshots retain conflicting claims', async () => {
    const url = 'https://www.linkedin.com/in/conflict-person';
    await insertSnapshot(snapshot({ requested_linkedin_url: url, headline: 'Advisor' }));
    await insertSnapshot(snapshot({ requested_linkedin_url: url, provider: 'pdl', provider_name: 'pdl', headline: 'Director' }));
    assert.deepEqual((await rows('select headline from public.person_enrichments where requested_linkedin_url = $1 order by headline', [url])).map(r => r.headline), ['Advisor', 'Director']);
  });

  let seeded;
  let seedSnapshot;
  await t.test('canonical seed atomically links a UUID snapshot without a change event', async () => {
    seedSnapshot = await insertSnapshot(snapshot({ provider: 'pdl', provider_name: 'pdl' }));
    const person = canonical();
    const result = await asRole('service_role', () => apply(person, seedSnapshot));
    assert.equal(result.applied, true);
    assert.equal(result.person_id, person.id);
    seeded = await one('select * from public.people where id = $1', [result.person_id]);
    const linked = await one('select * from public.person_enrichments where id = $1', [seedSnapshot.id]);
    assert.equal(linked.person_id, person.id);
    assert.equal(linked.provider_name, 'pdl');
    assert.ok(linked.canonical_applied_at);
    assert.equal((await rows('select * from public.person_changes where person_id = $1', [person.id])).length, 0);
  });
  await t.test('changed canonical data and its audit event commit together', async () => {
    const saved = await insertSnapshot(snapshot({ provider: 'brightdata', provider_name: 'brightdata', review_status: 'correct' }));
    const updated = { ...seeded, headline: 'Director', profile_hash: 'hash-2' };
    await apply(updated, saved, 'hash-1', {
      previous_hash: 'hash-1', new_hash: 'hash-2', change_types: ['headline_changed'],
      changed_fields: { headline: { before: 'Advisor', after: 'Director' } }, advisor_summary: 'Test Person updated their headline.',
    });
    const event = await one('select * from public.person_changes where trigger_enrichment_id = $1', [saved.id]);
    assert.equal(event.person_id, seeded.id);
    assert.equal(event.provider_name, 'brightdata');
    assert.deepEqual(event.change_types, ['headline_changed']);
    assert.deepEqual(event.changed_fields.headline, { before: 'Advisor', after: 'Director' });
    assert.equal((await one('select profile_hash from public.people where id = $1', [seeded.id])).profile_hash, 'hash-2');
    assert.equal((await one('select review_status from public.person_enrichments where id = $1', [saved.id])).review_status, 'correct');
  });
  await t.test('an old replay cannot revert a later canonical result or duplicate changes', async () => {
    const result = await apply({ ...seeded, profile_hash: 'hash-1' }, seedSnapshot);
    assert.equal(result.replayed, true);
    assert.equal(result.applied, false);
    assert.equal((await one('select profile_hash from public.people where id = $1', [seeded.id])).profile_hash, 'hash-2');
    assert.equal(Number((await one('select count(*) from public.person_changes where person_id = $1', [seeded.id])).count), 1);
  });
  await t.test('stale compare-and-swap fails with 40001 and leaves the snapshot retryable', async () => {
    const saved = await insertSnapshot(snapshot());
    await assert.rejects(() => apply({ ...seeded, headline: 'Stale', profile_hash: 'hash-3' }, saved, 'hash-1'), error => error.code === '40001');
    assert.equal((await one('select profile_hash from public.people where id = $1', [seeded.id])).profile_hash, 'hash-2');
    const linked = await one('select person_id, canonical_applied_at from public.person_enrichments where id = $1', [saved.id]);
    assert.equal(linked.person_id, null);
    assert.equal(linked.canonical_applied_at, null);
  });
  await t.test('a missing or inconsistent diff rolls back the canonical update and snapshot link', async () => {
    const saved = await insertSnapshot(snapshot());
    await assert.rejects(() => apply({ ...seeded, profile_hash: 'hash-3' }, saved, 'hash-2'), error => error.code === '22023');
    assert.equal((await one('select profile_hash from public.people where id = $1', [seeded.id])).profile_hash, 'hash-2');
    assert.equal((await one('select canonical_applied_at from public.person_enrichments where id = $1', [saved.id])).canonical_applied_at, null);
  });
  await t.test('unchanged hashes update check metadata without generating an event', async () => {
    const saved = await insertSnapshot(snapshot());
    await apply({ ...seeded, headline: 'Director', profile_hash: 'hash-2', last_checked_at: '2026-10-16T12:00:00Z', needs_manual_review: true }, saved, 'hash-2');
    const stored = await one('select * from public.people where id = $1', [seeded.id]);
    assert.equal(new Date(stored.last_checked_at).toISOString(), '2026-10-16T12:00:00.000Z');
    assert.equal(stored.needs_manual_review, true);
    assert.equal(Number((await one('select count(*) from public.person_changes where person_id = $1', [seeded.id])).count), 1);
  });
  await t.test('same-hash metadata writers use timestamp CAS and can safely retry without losing contributions', async () => {
    // Keep PostgreSQL microseconds: JS Date intentionally truncates to milliseconds.
    const oldVersion = (await one('select updated_at::text as version from public.people where id = $1', [seeded.id])).version;
    const current = await one('select * from public.people where id = $1', [seeded.id]);
    const pdl = await insertSnapshot(snapshot({ provider: 'pdl', provider_name: 'pdl' }));
    await apply({ ...current, providers_contributed: ['coresignal', 'pdl'], _expected_updated_at: oldVersion }, pdl, 'hash-2');
    const brightdata = await insertSnapshot(snapshot({ provider: 'brightdata', provider_name: 'brightdata' }));
    await assert.rejects(() => apply({ ...current, providers_contributed: ['coresignal', 'brightdata'],
      _expected_updated_at: oldVersion }, brightdata, 'hash-2'), error => error.code === '40001');
    const nextVersion = (await one('select updated_at::text as version from public.people where id = $1', [seeded.id])).version;
    assert.notEqual(nextVersion, oldVersion);
    await apply({ ...current, providers_contributed: ['coresignal', 'pdl', 'brightdata'],
      _expected_updated_at: nextVersion }, brightdata, 'hash-2');
    assert.deepEqual((await one('select providers_contributed from public.people where id = $1', [seeded.id])).providers_contributed,
      ['coresignal', 'pdl', 'brightdata']);
    assert.equal((await apply({ ...current, providers_contributed: ['coresignal'], _expected_updated_at: oldVersion }, pdl, 'hash-2')).replayed, true);
    assert.equal(Number((await one('select count(*) from public.person_changes where person_id = $1', [seeded.id])).count), 1);
  });
  await t.test('avatar storage stays private even when the bucket previously existed publicly', async () => {
    await db.exec(`update storage.buckets set public = true where id = 'person-avatars'`);
    await db.exec(migration);
    assert.equal((await one(`select public from storage.buckets where id = 'person-avatars'`)).public, false);
    assert.equal((await one(`select has_table_privilege('anon', 'storage.buckets', 'select') as allowed`)).allowed, false);
  });
  await t.test('foreign key lifecycle retains snapshots and removes deleted-person changes', async () => {
    await db.query('delete from public.people where id = $1', [seeded.id]);
    assert.equal((await one('select person_id from public.person_enrichments where id = $1', [seedSnapshot.id])).person_id, null);
    assert.equal(Number((await one('select count(*) from public.person_changes where person_id = $1', [seeded.id])).count), 0);
  });
});
