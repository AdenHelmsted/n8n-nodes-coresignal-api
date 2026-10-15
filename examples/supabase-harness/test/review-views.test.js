import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { normalizeSnapshot } from '../src/normalize.js';
import { mergeSnapshotsToCanonical } from '../src/merge.js';

let PGlite;
for (const modulePath of [process.env.PGLITE_MODULE_PATH, '@electric-sql/pglite',
  'file:///tmp/helmsted-schema-check/node_modules/@electric-sql/pglite/dist/index.js'].filter(Boolean)) {
  try { ({ PGlite } = await import(modulePath)); break; } catch (error) {
    if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error;
  }
}

test('read-only review views use actual canonical values and recorded claims', {
  skip: !PGlite && 'Install optional test-only PGlite as documented in test/schema.test.js',
}, async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const rows = async (sql, values = []) => (await db.query(sql, values)).rows;
  const one = async (sql, values = []) => (await rows(sql, values))[0];
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
  `);
  for (const path of ['../schema.sql', '../sql/002_canonical_people_and_changes.sql']) await db.exec(await readFile(new URL(path, import.meta.url), 'utf8'));
  const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('_people_review_views.sql'));
  assert.equal(migrations.length, 1, 'One CLI-generated review migration is expected');
  const migration = await readFile(new URL(`../migrations/${migrations[0]}`, import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  const id = randomUUID(), coreId = randomUUID(), pdlId = randomUUID();
  const coreOrigin = { provider: 'coresignal', enrichment_id: coreId, retrieved_at: '2026-10-15T12:00:00Z', source_updated_at: null };
  const pdlOrigin = { provider: 'pdl', enrichment_id: pdlId, retrieved_at: '2026-10-15T12:01:00Z', source_updated_at: null };
  // Fictional test claims; these are never represented as hosted/provider observations.
  const person = {
    id, canonical_linkedin_url: 'https://www.linkedin.com/in/synthetic-reviewer', linkedin_slug: 'synthetic-reviewer',
    full_name: 'Synthetic Reviewer', headline: 'Advisor', location: null, profile_hash: 'fictional-review-hash',
    identity_confidence: 'verified', needs_manual_review: true,
    field_provenance: {
      headline: { ...coreOrigin, conflicts: [{ ...pdlOrigin, value: 'Wealth Advisor' }] },
      location: { conflicts: [{ ...pdlOrigin, value: 'Test City' }] },
      full_name: { ...coreOrigin },
    },
    employment_history: [
      { title: 'Advisor', company_name: 'Synthetic Company', is_current: false, end_date: null,
        sources: ['coresignal', 'pdl'], field_provenance: {
          end_date: { ...coreOrigin, conflicts: [{ ...pdlOrigin, value: '2024-08' }] },
          is_current: { ...pdlOrigin, conflicts: [{ ...coreOrigin, value: true, end_date: null }] },
        } },
      { title: 'Trustee', company_name: 'Synthetic Foundation', is_current: true, sources: ['coresignal', 'pdl'] },
    ],
    education: [{ school_name: 'Synthetic School', degree: 'MBA', field_provenance: {
      degree: { ...coreOrigin, conflicts: [{ ...pdlOrigin, value: 'MS' }] },
    } }],
  };
  const insertPerson = async value => {
    const keys = Object.keys(value);
    await db.query(`insert into public.people (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
      Object.values(value).map(item => item && typeof item === 'object' ? JSON.stringify(item) : item));
  };
  await insertPerson(person);
  await db.query(`insert into public.person_enrichments
    (id, provider, provider_name, requested_linkedin_url, retrieved_at, match_status, request_count, provenance,
      person_id, review_status, review_notes, reviewed_at)
    values ($1, 'coresignal', 'coresignal', $2, '2026-10-15T12:00:00Z', 'matched_url', 1, '{}', $3, 'correct', 'Employment reviewed.', null),
      ($4, 'pdl', 'pdl', $2, '2026-10-15T12:01:00Z', 'matched_url', 1, '{}', $3, 'pending', 'Check degree.', null)`,
  [coreId, person.canonical_linkedin_url, id, pdlId]);

  await t.test('queue is one row per person with the real URL alias, counts and actual snapshot notes/statuses', async () => {
    const queue = await rows('select * from public.v_review_queue where id = $1', [id]);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].linkedin_url, person.canonical_linkedin_url);
    assert.equal(queue[0].identity_confidence, 'verified');
    assert.equal(queue[0].needs_manual_review, true);
    assert.equal(queue[0].review_status, 'pending');
    assert.deepEqual(queue[0].review_statuses, ['correct', 'pending']);
    assert.equal(queue[0].employment_claim_count, 2);
    assert.equal(queue[0].education_claim_count, 1);
    assert.equal(Number(queue[0].conflicting_field_count), 5);
    assert.deepEqual(queue[0].review_notes, [
      { enrichment_id: coreId, provider: 'coresignal', review_status: 'correct', reviewed_at: null, notes: 'Employment reviewed.' },
      { enrichment_id: pdlId, provider: 'pdl', review_status: 'pending', reviewed_at: null, notes: 'Check degree.' },
    ]);
  });
  await t.test('scalar disagreements preserve exact selected origin, competitor and absent provider metadata', async () => {
    const headline = await one(`select * from public.v_person_claim_disagreements where person_id = $1 and claim_type = 'scalar.headline'`, [id]);
    assert.equal(headline.displayed_value, 'Advisor');
    assert.equal(headline.selected_provider, 'coresignal');
    assert.equal(headline.needs_review, true);
    assert.deepEqual(headline.all_provider_claims, {
      selected: { ...coreOrigin, value: 'Advisor' }, conflicts: [{ ...pdlOrigin, value: 'Wealth Advisor' }], entry_context: null,
    });
    const location = await one(`select * from public.v_person_claim_disagreements where person_id = $1 and claim_type = 'scalar.location'`, [id]);
    assert.equal(location.displayed_value, null);
    assert.equal(location.selected_provider, null);
    assert.deepEqual(location.all_provider_claims.selected, { value: null });
  });
  await t.test('employment and education claims include precise field paths, nulls, false and real entry context', async () => {
    const end = await one(`select * from public.v_person_claim_disagreements where person_id = $1 and claim_type = 'employment[1].end_date'`, [id]);
    assert.equal(end.displayed_value, null);
    assert.equal(end.all_provider_claims.selected.value, null);
    assert.deepEqual(end.all_provider_claims.conflicts, [{ ...pdlOrigin, value: '2024-08' }]);
    assert.equal(end.all_provider_claims.entry_context.company_name, 'Synthetic Company');
    assert.equal(end.all_provider_claims.entry_context.field_provenance, undefined);
    const current = await one(`select * from public.v_person_claim_disagreements where person_id = $1 and claim_type = 'employment[1].is_current'`, [id]);
    assert.equal(current.displayed_value, 'false');
    assert.equal(current.all_provider_claims.selected.value, false);
    assert.equal(current.all_provider_claims.conflicts[0].end_date, null);
    const degree = await one(`select * from public.v_person_claim_disagreements where person_id = $1 and claim_type = 'education[1].degree'`, [id]);
    assert.equal(degree.displayed_value, 'MBA');
    assert.equal(degree.all_provider_claims.entry_context.school_name, 'Synthetic School');
  });
  await t.test('missing provenance and sources arrays do not manufacture disagreements or review records', async () => {
    const noClaims = { ...person, id: randomUUID(), linkedin_slug: 'synthetic-no-claims',
      canonical_linkedin_url: 'https://www.linkedin.com/in/synthetic-no-claims', needs_manual_review: false,
      field_provenance: {}, employment_history: [{ title: 'Trustee', sources: ['coresignal', 'pdl'] }], education: [] };
    await insertPerson(noClaims);
    assert.equal((await rows('select * from public.v_person_claim_disagreements where person_id = $1', [noClaims.id])).length, 0);
    const queue = await one('select * from public.v_review_queue where id = $1', [noClaims.id]);
    assert.equal(queue.review_status, null);
    assert.equal(queue.review_statuses, null);
    assert.equal(queue.review_notes, null);
    assert.equal(Number(queue.conflicting_field_count), 0);
  });
  await t.test('views handle the exact field provenance shape generated by existing provider fixture merges', async () => {
    const core = JSON.parse(await readFile(new URL('../fixtures/person.json', import.meta.url), 'utf8'));
    const pdl = JSON.parse(await readFile(new URL('./fixtures/pdl-normalize.json', import.meta.url), 'utf8'));
    const envelope = raw => ({ raw_payload: raw, input: { url: 'https://www.linkedin.com/in/synthetic-person' },
      http_status: 200, retrieved_at: '2026-10-15T12:00:00Z', request_count: 1 });
    const merged = mergeSnapshotsToCanonical(mergeSnapshotsToCanonical(null,
      normalizeSnapshot('coresignal', envelope(core)), coreId), normalizeSnapshot('pdl', envelope(pdl)), pdlId);
    merged.id = randomUUID();
    // Supabase array input is represented as a PostgreSQL array, not a JSON string.
    const { providers_contributed, ...values } = merged;
    await insertPerson(values);
    const claims = await rows('select * from public.v_person_claim_disagreements where person_id = $1', [merged.id]);
    const name = claims.find(row => row.claim_type === 'scalar.full_name');
    assert.equal(name.displayed_value, merged.full_name);
    assert.equal(name.selected_provider, merged.field_provenance.full_name.provider);
    assert.deepEqual(name.all_provider_claims.conflicts, merged.field_provenance.full_name.conflicts);
    const queue = await one('select * from public.v_review_queue where id = $1', [merged.id]);
    assert.equal(Number(queue.conflicting_field_count), claims.length);
    assert.equal(queue.employment_claim_count, merged.employment_history.length);
    assert.equal(queue.education_claim_count, merged.education.length);
  });
  await t.test('views enforce invoker security and are non-updatable even for the owner', async () => {
    const catalog = await rows(`select c.relname, c.reloptions, v.is_updatable from pg_class c
      join information_schema.views v on v.table_schema = 'public' and v.table_name = c.relname
      where c.oid in ('public.v_review_queue'::regclass, 'public.v_person_claim_disagreements'::regclass)`);
    assert.equal(catalog.length, 2);
    assert.ok(catalog.every(view => view.reloptions.includes('security_invoker=true') && view.is_updatable === 'NO'));
    for (const view of ['v_review_queue', 'v_person_claim_disagreements']) {
      await assert.rejects(() => db.exec(`delete from public.${view}`), error => error.code === '55000');
    }
  });
  await t.test('prepared read-only hosted audit SQL runs locally and distinguishes an object from nullable metadata', async () => {
    // Fictional catalog entry only; no image bytes or hosted observations are fabricated.
    await db.exec(`create table storage.objects (name text, bucket_id text, metadata jsonb, owner_id text);
      insert into storage.objects values ('synthetic/photo.jpg', 'person-avatars', null, null);`);
    await db.query('update public.people set avatar_storage_path = $1 where id = $2', ['person-avatars/synthetic/photo.jpg', id]);
    const audit = (await readFile(new URL('../sql/review_audit_queries.sql', import.meta.url), 'utf8'))
      .replaceAll('https://www.linkedin.com/in/chris-maresca', person.canonical_linkedin_url);
    const results = await db.exec(audit);
    const storage = results.flatMap(result => result.rows).find(row => row.matching_object_exists !== undefined);
    assert.equal(storage.matching_object_exists, true);
    assert.equal(storage.object_metadata, null);
    await db.query('update public.people set avatar_storage_path = null where id = $1', [id]);
    const absent = (await db.exec(audit)).flatMap(result => result.rows).find(row => row.matching_object_exists !== undefined);
    assert.equal(absent.matching_object_exists, false);
  });
  await t.test('only the service role receives SELECT, with no view write privileges or public grants', async () => {
    for (const view of ['v_review_queue', 'v_person_claim_disagreements']) {
      const privileges = await one(`select has_table_privilege('service_role', $1, 'SELECT') as can_select,
        has_table_privilege('service_role', $1, 'INSERT,UPDATE,DELETE') as can_write`, [`public.${view}`]);
      assert.equal(privileges.can_select, true);
      assert.equal(privileges.can_write, false);
      const publicGrants = await rows(`select privilege_type from information_schema.table_privileges where table_schema = 'public' and table_name = $1 and grantee = 'PUBLIC'`, [view]);
      assert.equal(publicGrants.length, 0);
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec(`set role ${role}`);
      try {
        for (const view of ['v_review_queue', 'v_person_claim_disagreements']) {
          if (role === 'service_role') assert.ok((await rows(`select * from public.${view}`)).length > 0);
          else await assert.rejects(() => db.exec(`select * from public.${view}`), error => error.code === '42501');
          await assert.rejects(() => db.exec(`delete from public.${view}`), error => ['42501', '55000'].includes(error.code));
        }
      } finally { await db.exec('reset role'); }
    }
  });
});
