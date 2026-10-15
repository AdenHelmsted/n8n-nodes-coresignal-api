import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { collect as coresignal } from '../src/providers/coresignal.js';
import { collect as pdl } from '../src/providers/pdl.js';
import { collect as brightdata, finish } from '../src/providers/brightdata.js';

const url = 'https://www.linkedin.com/in/synthetic-person/';
async function cache(t) {
  await mkdir('.cache', { recursive: true });
  const dir = await mkdtemp(resolve('.cache', 'provider-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const fixture = name => readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');

test('missing credentials skip all providers without a request or cache', async () => {
  const options = { env: {}, fetchImpl: () => assert.fail('Unexpected provider request') };
  for (const collect of [coresignal, pdl, brightdata]) assert.equal(await collect({ url }, options), null);
});

test('Coresignal preserves tested core bundle/auth, makes one request and caches before returning', async t => {
  const cacheDir = await cache(t), body = await readFile(new URL('../fixtures/person.json', import.meta.url), 'utf8');
  let calls = 0;
  const result = await coresignal({ url }, { env: { CORESIGNAL_API_KEY: 'synthetic-secret' }, cacheDir,
    fetchImpl: async (endpoint, init) => {
      calls++;
      assert.match(endpoint, /\/employee_multi_source\/collect\/synthetic-person\?bundle=core_employee_data$/);
      assert.equal(init.headers.apikey, 'synthetic-secret');
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'error');
      return new Response(body, { status: 200, headers: { 'x-credits-remaining': '1990' } });
    } });
  assert.equal(calls, 1);
  assert.equal(result.request_count, 1);
  assert.equal(result.credits_remaining, 1990);
  assert.equal(result.estimated_credits, 10);
  assert.deepEqual(JSON.parse(await readFile(result.local_cache_path, 'utf8')), result);
  assert.match(result.local_cache_path, /coresignal_[0-9a-f]{64}_.*\.json$/);
});

test('PDL URL lookup keeps key in header and requests matching evidence at likelihood six', async t => {
  const cacheDir = await cache(t), body = await fixture('pdl');
  const result = await pdl({ url, ignored: 'must not persist' }, { env: { PEOPLEDATALABS_API_KEY: 'synthetic-secret' }, cacheDir,
    fetchImpl: async (endpoint, init) => {
      const query = new URL(endpoint);
      assert.equal(query.origin + query.pathname, 'https://api.peopledatalabs.com/v5/person/enrich');
      assert.equal(query.searchParams.get('profile').replace(/\/$/, ''), url.replace(/\/$/, ''));
      assert.equal(query.searchParams.get('min_likelihood'), '6');
      assert.equal(query.searchParams.get('include_if_matched'), 'true');
      assert.equal(query.searchParams.has('api_key'), false);
      assert.equal(init.headers['X-Api-Key'], 'synthetic-secret');
      assert.equal(init.redirect, 'error');
      return new Response(body, { status: 200 });
    } });
  const cached = await readFile(result.local_cache_path, 'utf8');
  assert.equal(cached.includes('synthetic-secret'), false);
  assert.equal(cached.includes('must not persist'), false);
  assert.equal(result.estimated_credits, 1);
  assert.equal(result.raw_payload.likelihood, 9);
});

test('PDL resolves only with first/last and context; unsupported fields never become request params', async t => {
  const cacheDir = await cache(t), body = await fixture('pdl');
  await pdl({ first: 'Synthetic', last: 'Person', company: 'Example Advisors', location: 'Chicago', domain: 'example.com' }, {
    env: { PDL_API_KEY: 'synthetic-secret' }, cacheDir, fetchImpl: async endpoint => {
      const params = new URL(endpoint).searchParams;
      assert.equal(params.get('first_name'), 'Synthetic');
      assert.equal(params.get('last_name'), 'Person');
      assert.equal(params.get('company'), 'Example Advisors');
      assert.equal(params.get('location'), 'Chicago');
      assert.equal(params.has('domain'), false);
      return new Response(body, { status: 200 });
    } });
  await assert.rejects(pdl({ first: 'Synthetic', last: 'Person' }, {
    env: { PDL_API_KEY: 'synthetic-secret' }, cacheDir, fetchImpl: () => assert.fail('No context must not spend credits'),
  }), /requires first and last names plus company or location/);
});

test('BrightData sends one synchronous profile collection request using official dataset', async t => {
  const cacheDir = await cache(t), body = await fixture('brightdata');
  let calls = 0;
  const result = await brightdata({ url }, { env: { BRIGHT_DATA_TOKEN: 'synthetic-secret' }, cacheDir,
    fetchImpl: async (endpoint, init) => {
      calls++;
      const query = new URL(endpoint);
      assert.equal(query.origin + query.pathname, 'https://api.brightdata.com/datasets/v3/scrape');
      assert.equal(query.searchParams.get('dataset_id'), 'gd_l1viktl72bvl7bjuj0');
      assert.equal(query.searchParams.get('format'), 'json');
      assert.equal(init.headers.Authorization, 'Bearer synthetic-secret');
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'error');
      const input = JSON.parse(init.body).input;
      assert.equal(input.length, 1);
      assert.equal(input[0].url.replace(/\/$/, ''), url.replace(/\/$/, ''));
      return new Response(body, { status: 200 });
    } });
  assert.equal(calls, 1);
  assert.equal(result.estimated_credits, null);
  assert.equal(result.raw_payload[0].name, 'Synthetic Person');
  assert.deepEqual(JSON.parse(await readFile(result.local_cache_path, 'utf8')), result);
});

test('BrightData 202 response is saved with snapshot ID and never automatically polled or resubmitted', async t => {
  const cacheDir = await cache(t);
  let calls = 0;
  const result = await brightdata({ url }, { env: { BRIGHTDATA_API_KEY: 'synthetic-secret' }, cacheDir,
    fetchImpl: async () => { calls++; return Response.json({ snapshot_id: 's_synthetic', message: 'Still running' }, { status: 202 }); } });
  assert.equal(calls, 1);
  assert.equal(result.http_status, 202);
  assert.equal(result.raw_payload.snapshot_id, 's_synthetic');
  assert.equal(result.estimated_credits, null);
  assert.equal(JSON.parse(await readFile(result.local_cache_path, 'utf8')).raw_payload.snapshot_id, 's_synthetic');
});

test('HTTP errors and non-JSON response bodies are retained with status; key echoes are redacted', async t => {
  const cacheDir = await cache(t);
  const result = await pdl({ url }, { env: { PDL_API_KEY: 'synthetic-secret' }, cacheDir,
    fetchImpl: async () => new Response('Denied synthetic-secret', { status: 401 }) });
  assert.equal(result.http_status, 401);
  assert.equal(result.raw_payload, 'Denied [REDACTED]');
  assert.equal(result.estimated_credits, null);
  assert.equal((await readFile(result.local_cache_path, 'utf8')).includes('synthetic-secret'), false);
});

test('network failures leave a replayable local failure record without automatic retries', async t => {
  const cacheDir = await cache(t);
  let calls = 0;
  const result = await coresignal({ url }, { env: { CORESIGNAL_API_KEY: 'synthetic-secret' }, cacheDir,
    fetchImpl: async () => { calls++; throw new Error('simulated network error synthetic-secret'); } });
  assert.equal(calls, 1);
  assert.equal(result.http_status, null);
  assert.equal(result.estimated_credits, null);
  assert.match(result.raw_payload.error, /no automatic retry/);
  assert.equal((await readFile(result.local_cache_path, 'utf8')).includes('synthetic-secret'), false);
});

test('unwritable cache prevents a provider request', async t => {
  const dir = await cache(t), file = resolve(dir, 'not-a-directory');
  await writeFile(file, 'synthetic');
  await assert.rejects(coresignal({ url }, { env: { CORESIGNAL_API_KEY: 'synthetic-secret' }, cacheDir: file,
    fetchImpl: () => assert.fail('Cache preflight must occur before billing') }));
  assert.equal((await readdir(dir)).length, 1);
});

test('Coresignal and BrightData skip unsupported name resolution without charging', async () => {
  const options = { env: { CORESIGNAL_API_KEY: 'synthetic', BRIGHTDATA_API_KEY: 'synthetic' },
    fetchImpl: () => assert.fail('Unsupported lookup must not spend credits') };
  assert.equal(await coresignal({ first: 'Synthetic', last: 'Person', company: 'Example' }, options), null);
  assert.equal(await brightdata({ first: 'Synthetic', last: 'Person', company: 'Example' }, options), null);
});

test('BrightData finish downloads a pending snapshot once and persists parent audit metadata with a fresh ID', async t => {
  const cacheDir = await cache(t), body = await fixture('brightdata');
  const pending = await brightdata({ url }, { env: { BRIGHTDATA_API_KEY: 'synthetic-secret' }, cacheDir,
    fetchImpl: async () => Response.json({ snapshot_id: 'sd_synthetic123' }, { status: 202 }) });
  let calls = 0;
  const result = await finish(pending, { env: { BRIGHT_DATA_API_KEY: 'synthetic-secret' }, cacheDir,
    fetchImpl: async (endpoint, init) => {
      calls++;
      assert.equal(endpoint, 'https://api.brightdata.com/datasets/v3/snapshot/sd_synthetic123?format=json');
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.Authorization, 'Bearer synthetic-secret');
      assert.equal(init.redirect, 'error');
      assert.equal(init.body, undefined);
      return new Response(body, { status: 200 });
    } });
  assert.equal(calls, 1);
  assert.notEqual(result.id, pending.id);
  assert.equal(result.parent_collection_id, pending.id);
  assert.equal(result.parent_cache_path, pending.local_cache_path);
  assert.equal(result.request_count, 1);
  assert.equal(result.collection_request_count, 0);
  assert.equal(result.request_kind, 'snapshot_download');
  assert.equal(result.estimated_credits, null);
  assert.deepEqual(JSON.parse(await readFile(result.local_cache_path, 'utf8')), result);
  assert.equal((await readFile(result.local_cache_path, 'utf8')).includes('synthetic-secret'), false);
});

test('BrightData finish skips absent credentials and rejects missing/unsafe snapshot IDs before any request', async () => {
  assert.equal(await finish({}, { env: {}, fetchImpl: () => assert.fail('Missing key must skip') }), null);
  for (const snapshot_id of ['', '../other', 's_bad?api_key=secret', 'https://example.com/s_test']) {
    await assert.rejects(finish({ provider: 'brightdata', input: { url }, raw_payload: { snapshot_id } }, {
      env: { BRIGHTDATA_API_KEY: 'synthetic-secret' }, fetchImpl: () => assert.fail('Unsafe ID must not be requested'),
    }), /valid snapshot_id/);
  }
});

test('BrightData finish preserves a still-pending response without polling and keeps original collection ancestry', async t => {
  const cacheDir = await cache(t);
  let calls = 0;
  const pending = { provider: 'brightdata', input: { url }, id: 'download-run', local_cache_path: '/synthetic/download.json',
    parent_collection_id: 'original-collection', parent_cache_path: '/synthetic/original.json', raw_payload: { snapshot_id: 's_synthetic' } };
  const result = await finish(pending, { env: { BRIGHTDATA_API_KEY: 'synthetic-secret' }, cacheDir,
    fetchImpl: async () => { calls++; return Response.json({ snapshot_id: 's_synthetic', status: 'running' }, { status: 202 }); } });
  assert.equal(calls, 1);
  assert.equal(result.http_status, 202);
  assert.equal(result.parent_collection_id, 'original-collection');
  assert.equal(result.parent_cache_path, '/synthetic/original.json');
  assert.equal(result.raw_payload.status, 'running');
  assert.deepEqual(JSON.parse(await readFile(result.local_cache_path, 'utf8')), result);
});
