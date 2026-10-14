import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { linkedinUrl, collectPerson, makeSnapshot, saveToSupabase, supabaseConfig } from '../harness.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/person.json', import.meta.url), 'utf8'));
const profile = 'https://www.linkedin.com/in/synthetic-person/';

test('URL normalization accepts LinkedIn variants and rejects lookalikes/other paths', () => {
  assert.equal(linkedinUrl('http://uk.linkedin.com/in/Synthetic-Person/?trk=test#top'), profile);
  for (const url of ['https://evil.example/in/synthetic-person', 'https://linkedin.com.evil.example/in/x',
    'https://evil@linkedin.com/in/x', 'https://www.linkedin.com/company/x', 'https://linkedin.com/in/x/detail',
    'https://linkedin.com/in/x%2Fy', 'https://linkedin.com:8080/in/x']) {
    assert.throws(() => linkedinUrl(url));
  }
});

test('one Coresignal core lookup uses the official path and apikey header', async () => {
  let calls = 0;
  const row = await collectPerson(profile, 'test-secret', async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.coresignal.com/cdapi/v2/employee_multi_source/collect/synthetic-person?bundle=core_employee_data');
    assert.equal(init.headers.apikey, 'test-secret');
    assert.equal(init.redirect, 'error');
    return new Response(JSON.stringify(fixture), { status: 200, headers: { 'x-credits-remaining': '1990' } });
  });
  assert.equal(calls, 1);
  assert.equal(row.match_status, 'matched_url');
  assert.equal(row.request_count, 1);
  assert.equal(row.estimated_credits, 10);
  assert.equal(row.credits_remaining, 1990);
  assert.equal(row.provenance.fields.profile_picture_ref, 'picture_url');
  assert.equal(row.location, fixture.location_full);
  assert.deepEqual(row.employment_history, fixture.experience);
  assert.equal(row.employment_history.filter(job => job.active_experience === 1).length, 2);
  assert.deepEqual(row.education, fixture.education);
  assert.deepEqual(row.raw_response, fixture);
  assert.notEqual(row.retrieved_at, row.source_updated_at);
});

test('invalid inputs and missing key never call the provider', async () => {
  let calls = 0;
  const fetchImpl = () => { calls++; throw new Error('Should not run'); };
  await assert.rejects(collectPerson('https://example.com/in/person', 'key', fetchImpl));
  await assert.rejects(collectPerson(profile, '', fetchImpl));
  assert.equal(calls, 0);
});

test('errors, non-JSON and network failure are saved as one attempt without retries', async () => {
  for (const status of [401, 402, 404, 429, 503]) {
    let calls = 0;
    const row = await collectPerson(profile, 'key', async () => {
      calls++;
      return new Response('unavailable', { status });
    });
    assert.equal(calls, 1);
    assert.equal(row.http_status, status);
    assert.equal(row.match_status, 'unavailable');
    assert.equal(row.raw_response, 'unavailable');
    assert.equal(row.estimated_credits, null);
  }
  let calls = 0;
  const row = await collectPerson(profile, 'key', async () => { calls++; throw new Error('network error'); });
  assert.equal(calls, 1);
  assert.equal(row.http_status, null);
});

test('wrong, missing and deleted returned identities are never marked matched', () => {
  const wrong = { ...fixture, professional_network_url: 'https://linkedin.com/in/someone-else' };
  assert.equal(makeSnapshot(profile, { status: 200, body: wrong }).match_status, 'mismatch');
  assert.equal(makeSnapshot(profile, { status: 200, body: { full_name: 'Synthetic Person' } }).match_status, 'unverified');
  assert.equal(makeSnapshot(profile, { status: 200, body: { ...fixture, is_deleted: 1 } }).match_status, 'unavailable');
  assert.equal(makeSnapshot(profile, { status: 200, body: [] }).match_status, 'unverified');
});

test('live Coresignal linkedin_url variant maps with its actual source field', () => {
  const { professional_network_url, ...otherFields } = fixture;
  const row = makeSnapshot(profile, { status: 200, body: { ...otherFields, linkedin_url: professional_network_url } });
  assert.equal(row.match_status, 'matched_url');
  assert.equal(row.linkedin_url, profile);
  assert.equal(row.provenance.fields.linkedin_url, 'linkedin_url');
});

test('Supabase SDK preserves run IDs and ignores duplicate replays', async () => {
  const row = makeSnapshot(profile, { status: 200, body: fixture });
  let calls = 0;
  await saveToSupabase(row, { url: 'https://test.supabase.co', key: 'test-only-key', fetchImpl: async (url, init) => {
    calls++;
    assert.equal(new URL(url).pathname, '/rest/v1/person_enrichments');
    assert.equal(new URL(url).searchParams.get('on_conflict'), 'id');
    assert.match(new Headers(init.headers).get('prefer'), /resolution=ignore-duplicates/);
    assert.equal(JSON.parse(init.body).id, row.id);
    assert.equal(JSON.parse(init.body).review_status, undefined);
    return new Response(null, { status: 201 });
  } });
  assert.equal(calls, 1);
});

test('Supabase failure gives replay instructions and does not expose the key', async () => {
  await assert.rejects(saveToSupabase(makeSnapshot(profile, { status: 200, body: fixture }), {
    url: 'https://test.supabase.co', key: 'private-key', fetchImpl: async () => new Response(
      JSON.stringify({ code: '42P01', message: 'missing table' }), { status: 400, headers: { 'content-type': 'application/json' } }),
  }), /42P01.*Import the saved run/);
  assert.throws(() => supabaseConfig({ CORESIGNAL_API_KEY: 'key' }), /SUPABASE_URL/);
});
