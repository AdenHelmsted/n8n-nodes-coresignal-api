import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseQuery, decideSearch, normalizeSnapshot } from '../src/normalize.js';
import { main, replayFile } from '../src/index.js';
import { snapshotRow } from '../src/db.js';
import { linkedinUrl } from '../harness.mjs';

// Entirely fictional payloads. Transports below never delegate to fetch.
const url = 'https://www.linkedin.com/in/chris-maresca';
const env = { PDL_API_KEY: 'pdl-test', CORESIGNAL_API_KEY: 'core-test', BRIGHTDATA_API_KEY: 'bright-test' };
const fixtures = Object.fromEntries(await Promise.all(['pdl', 'coresignal', 'brightdata'].map(async provider =>
  [provider, JSON.parse(await readFile(new URL(`./fixtures/${provider}.json`, import.meta.url), 'utf8'))])));
function payloads() {
  const raw = structuredClone(fixtures);
  Object.assign(raw.pdl.data, { full_name: 'Chris Maresca', first_name: 'Chris', last_name: 'Maresca',
    linkedin_url: url, headline: 'Founder at Helmsted', job_company_name: 'Helmsted', location_name: 'Oklahoma City, Oklahoma, United States' });
  raw.pdl.data.experience[0].company.name = 'Helmsted LLC';
  Object.assign(raw.coresignal, { full_name: 'Chris Maresca', first_name: 'Chris', last_name: 'Maresca', professional_network_url: url });
  Object.assign(raw.brightdata[0], { name: 'Chris Maresca', first_name: 'Chris', last_name: 'Maresca', url });
  return raw;
}
const input = { first: 'Chris', last: 'Maresca', company: 'Helmsted', query: 'Chris Maresca Helmsted' };
function snapshot(raw = payloads().pdl, matching = input, extra = {}) {
  return normalizeSnapshot('pdl', { id: '00000000-0000-4000-8000-000000000001', provider: 'pdl',
    retrieved_at: '2026-10-15T00:00:00Z', http_status: 200, raw_payload: raw, input: matching, ...extra });
}
async function quiet(action) {
  const old = { log: console.log, error: console.error, warn: console.warn }, logs = [];
  console.log = console.error = console.warn = (...parts) => logs.push(parts.join(' '));
  try { return await action(logs); } finally { Object.assign(console, old); }
}
async function cache(t) {
  const folder = await mkdtemp(join(tmpdir(), 'helmsted-query-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}
async function saved(folder) {
  return Promise.all((await readdir(folder)).filter(name => name.endsWith('.json')).map(async name =>
    JSON.parse(await readFile(join(folder, name), 'utf8'))));
}
function transport(raw, calls) {
  return async (endpoint, init) => {
    const request = new URL(endpoint), provider = request.hostname === 'api.peopledatalabs.com' ? 'pdl'
      : request.hostname === 'api.coresignal.com' ? 'coresignal' : request.hostname === 'api.brightdata.com' ? 'brightdata' : null;
    assert.ok(provider, `Unexpected HTTP target: ${request.origin}`);
    calls.push({ provider, request, init });
    if (provider === 'pdl') assert.equal(request.searchParams.has('api_key'), false);
    return Response.json(raw[provider]);
  };
}

test('plain-text parser extracts a single normalized personal URL, including surrounding prose and punctuation', () => {
  for (const query of [url, 'linkedin.com/in/Chris-Maresca', `parse this LinkedIn (${url}).`,
    'Profile: http://uk.linkedin.com/in/Chris-Maresca/?trk=example#top', `${url} ${url}/`]) {
    assert.deepEqual(parseQuery(query), { url });
  }
});

test('legacy absolute-only URL contract remains compatible with the shared normalizer', () => {
  for (const variant of [url, 'http://uk.linkedin.com/in/Chris-Maresca/?trk=example#top']) {
    assert.equal(linkedinUrl(variant), `${url}/`);
  }
  for (const invalid of ['linkedin.com/in/chris-maresca', 'https://linkedin.com/company/helmsted',
    'https://linkedin.com.evil.example/in/chris-maresca', 'https://evil@linkedin.com/in/chris-maresca']) {
    assert.throws(() => linkedinUrl(invalid));
  }
});

test('plain-text parser rejects ambiguous URLs, malformed LinkedIn mentions and insufficient name context', () => {
  for (const query of [`${url} https://linkedin.com/in/other-person`, 'https://linkedin.com/company/helmsted',
    'https://linkedin.com.evil.example/in/chris-maresca', 'https://evil@linkedin.com/in/chris-maresca',
    'https://linkedin.com/in/chris%2Fmaresca', 'https://linkedin.com/in/%ZZ', 'Chris Maresca', 'Chris', '', '123 456 Tulsa']) {
    assert.throws(() => parseQuery(query), undefined, query);
  }
});

test('plain-text parser distinguishes explicit company/location connectors and deterministic place aliases', () => {
  for (const query of ['Chris Maresca Helmsted', 'Chris Maresca at Helmsted', 'Chris Maresca from Helmsted',
    'Chris Maresca - Helmsted', 'Chris Maresca, Helmsted', 'Chris, Maresca, at Helmsted']) {
    const parsed = parseQuery(query);
    assert.equal(parsed.first, 'Chris'); assert.equal(parsed.last, 'Maresca');
    assert.equal(parsed.company, 'Helmsted'); assert.equal(parsed.location, undefined); assert.equal(parsed.query, query);
  }
  for (const context of ['Tulsa', 'Oklahoma', 'Oklahoma City', 'Oklahoma City, OK', 'NYC', 'New York', 'Dallas', 'Dallas, TX', 'London', 'San Francisco', 'Alabama', 'Wyoming', 'AK', 'WV']) {
    const parsed = parseQuery(`Aden Nowell ${context}`);
    assert.equal(parsed.location, context); assert.equal(parsed.company, undefined);
  }
  assert.equal(parseQuery('Aden Nowell in Oklahoma City').location, 'Oklahoma City');
  assert.equal(parseQuery('Aden Nowell JP Morgan').company, 'JP Morgan');
  assert.equal(parseQuery('Aden Nowell Constructor').company, 'Constructor');
  assert.equal(parseQuery('Aden Nowell toString').company, 'toString');
  assert.equal(parseQuery('Aden Nowell at London').company, 'London');
  assert.equal(parseQuery("Anne O'Neil at Morgan-Stanley").last, "O'Neil");
});

test('location classifier covers all fifty US states by full name and postal abbreviation', () => {
  const states = [
    'AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|FL:Florida|GA:Georgia',
    'HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland',
    'MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey',
    'NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina',
    'SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming',
  ].flatMap(group => group.split('|').map(pair => pair.split(':')));
  assert.equal(states.length, 50);
  for (const state of states) for (const context of state) assert.equal(parseQuery(`Aden Nowell ${context}`).location, context);
});

test('explicit context flags take precedence over inferred company/location slots', () => {
  const byCompany = parseQuery('Aden Nowell Tulsa', { company: 'Example Advisors' });
  assert.equal(byCompany.company, 'Example Advisors'); assert.equal(byCompany.location, undefined);
  const byLocation = parseQuery('Chris Maresca Helmsted', { location: 'Tulsa' });
  assert.equal(byLocation.location, 'Tulsa'); assert.equal(byLocation.company, undefined);
  const both = parseQuery('Chris Maresca', { company: 'Helmsted', location: 'Tulsa' });
  assert.equal(both.company, 'Helmsted'); assert.equal(both.location, 'Tulsa');
});

test('bounded decision receipt accepts exact names and one edited/transposed name with corroborating context', () => {
  for (const [first, last, nameScore] of [['Chris', 'Maresca', 1], ['Chris', 'Marseca', 0.8],
    ['Chriss', 'Maresca', 0.8], ['Chri', 'Maresca', 0.8], ['Chrix', 'Maresca', 0.8]]) {
    const s = snapshot(payloads().pdl, { ...input, first, last }), decision = decideSearch(s);
    assert.equal(decision.scores.name_score, nameScore);
    assert.equal(decision.scores.context_score, 1); assert.equal(decision.scores.likelihood_score, 0.9);
    assert.equal(decision.action, 'accept_and_waterfall'); assert.equal(decision.min_confidence_gate, 0.75);
    assert.ok(decision.confidence_interval[0] >= 0.75);
    assert.ok(decision.confidence_interval[0] <= decision.confidence && decision.confidence <= decision.confidence_interval[1]);
    assert.ok(decision.confidence_interval[1] <= 1);
    assert.deepEqual(s.provenance.decision_receipt, decision);
    assert.equal(decision.query, input.query);
  }
});

test('wrong names force a zero lower bound even with maximum provider likelihood and context agreement', () => {
  for (const [first, last] of [['Wrong', 'Person'], ['Chriss', 'Marseca'], ['Chris', 'Martin'], ['Aden', 'Maresca']]) {
    const raw = payloads().pdl; raw.likelihood = 10;
    const s = snapshot(raw, { ...input, first, last }), decision = decideSearch(s);
    assert.equal(decision.scores.name_score, 0); assert.equal(decision.confidence_interval[0], 0);
    assert.equal(decision.action, 'abstain_reject'); assert.equal(s.identity_status, 'missing_url');
  }
});

test('policy thresholds use the lower interval bound at exactly 0.75, 0.74, 0.50 and 0.49', () => {
  for (const [likelihood, company, lower, action] of [[8, 'Helmsted', 0.75, 'accept_and_waterfall'],
    [7, 'Helmsted', 0.74, 'review_only'], [8, 'Other Business', 0.50, 'review_only'], [7, 'Other Business', 0.49, 'abstain_reject']]) {
    const raw = payloads().pdl; raw.likelihood = likelihood;
    const normalized = snapshot(raw, { ...input, last: 'Marseca', company }), receipt = normalized.provenance.decision_receipt;
    assert.equal(receipt.confidence_interval[0], lower); assert.equal(receipt.action, action);
    assert.ok(receipt.confidence_interval[0] <= receipt.confidence && receipt.confidence <= receipt.confidence_interval[1]);
    assert.equal(normalized.identity_status, action === 'abstain_reject' ? 'missing_url' : 'search_match');
  }
});

test('context missingness is distinct from contradictory context, with no substring or cross-slot credit', () => {
  const missing = payloads().pdl;
  missing.data.experience = []; missing.data.headline = null; missing.data.job_title = null; missing.data.job_company_name = null;
  const unknown = decideSearch(snapshot(missing));
  assert.equal(unknown.scores.context_score, 0.5); assert.equal(unknown.action, 'review_only');
  assert.ok(unknown.confidence_interval[1] - unknown.confidence_interval[0] > 0.2);
  for (const company of ['Other Business', 'Helm', 'sted']) {
    const decision = decideSearch(snapshot(payloads().pdl, { ...input, company }));
    assert.equal(decision.scores.context_score, 0); assert.equal(decision.action, 'review_only');
  }
  const location = decideSearch(snapshot(payloads().pdl, { first: 'Chris', last: 'Maresca', location: 'Oklahoma City', query: 'Chris Maresca in Oklahoma City' }));
  assert.equal(location.scores.context_score, 1);
  const both = decideSearch(snapshot(payloads().pdl, { ...input, location: 'London' }));
  assert.equal(both.scores.context_score, 0, 'One matching context must not conceal the other mismatch');
});

test('location evidence compares NYC and New York as an explicit place alias', () => {
  for (const [requested, returned] of [['NYC', 'New York, New York, United States'], ['New York', 'NYC, NY']]) {
    const raw = payloads().pdl; raw.data.location_name = returned;
    const decision = decideSearch(snapshot(raw, { first: 'Chris', last: 'Maresca', location: requested }));
    assert.equal(decision.scores.context_score, 1); assert.equal(decision.action, 'accept_and_waterfall');
  }
});

test('missing likelihood widens uncertainty; invalid/low likelihood, deleted/error and bad URLs always reject', () => {
  const absent = payloads().pdl; delete absent.likelihood;
  const missing = decideSearch(snapshot(absent));
  assert.equal(missing.scores.likelihood_score, null); assert.equal(missing.action, 'review_only');
  for (const likelihood of [0, 5, -1, 11, '9', null]) {
    const raw = payloads().pdl; raw.likelihood = likelihood;
    const decision = decideSearch(snapshot(raw));
    assert.equal(decision.action, 'abstain_reject'); assert.equal(decision.confidence_interval[0], 0);
    for (const value of [decision.confidence, ...decision.confidence_interval]) assert.ok(value >= 0 && value <= 1);
  }
  for (const returned of [null, 'https://linkedin.com/company/helmsted', 'https://evil.example/in/chris-maresca']) {
    const raw = payloads().pdl; raw.data.linkedin_url = returned;
    assert.equal(decideSearch(snapshot(raw)).action, 'abstain_reject');
  }
  const deleted = payloads().pdl; deleted.data.is_deleted = true;
  assert.equal(decideSearch(snapshot(deleted)).action, 'abstain_reject');
  assert.equal(decideSearch(snapshot(payloads().pdl, input, { http_status: 401 })).action, 'abstain_reject');
});

test('full CLI query and positional modes resolve PDL first, waterfall once per provider and remain unverified', async t => {
  for (const args of [['--query', 'Chris Maresca Helmsted'], ['--query', 'Chris Marseca Helmsted'], ['Chris Maresca at Helmsted']]) {
    const cacheDir = await cache(t), calls = [];
    const result = await quiet(() => main([...args, '--providers', 'coresignal,pdl,brightdata,pdl', '--local'], env,
      { cacheDir, fetchImpl: transport(payloads(), calls) }));
    assert.deepEqual(calls.map(call => call.provider), ['pdl', 'coresignal', 'brightdata']);
    assert.equal(calls[0].request.searchParams.get('company'), 'Helmsted');
    assert.equal(calls[0].request.searchParams.has('profile'), false);
    assert.match(calls[1].request.pathname, /\/collect\/chris-maresca$/);
    assert.deepEqual(JSON.parse(calls[2].init.body).input, [{ url }]);
    assert.equal(result.processed, 3); assert.equal(result.canonical.identity_confidence, 'unverified_search_match');
    assert.equal(result.canonical.needs_manual_review, true);
    const envelopes = await saved(cacheDir), resolution = envelopes.find(e => e.provider === 'pdl');
    assert.equal(resolution.input.query, args[0] === '--query' ? args[1] : args[0]);
    for (const followup of envelopes.filter(e => e.provider !== 'pdl')) {
      assert.equal(followup.search_origin.resolution_id, resolution.id);
      assert.equal(followup.search_origin.decision_receipt.action, 'accept_and_waterfall');
      const normalized = normalizeSnapshot(followup.provider, followup);
      assert.equal(normalized.identity_status, 'search_match');
      assert.deepEqual(normalized.provenance.decision_receipt, followup.search_origin.decision_receipt);
    }
  }
});

test('embedded URL query takes the operator-provided verified path and does not acquire search ancestry', async t => {
  const cacheDir = await cache(t), calls = [];
  const result = await quiet(() => main(['--query', `parse this linkedin (${url}).`, '--local'], env,
    { cacheDir, fetchImpl: transport(payloads(), calls) }));
  assert.deepEqual(calls.map(call => call.provider), ['coresignal', 'pdl', 'brightdata']);
  assert.equal(result.canonical.identity_confidence, 'verified');
  for (const envelope of await saved(cacheDir)) {
    assert.equal(envelope.search_origin, undefined);
    assert.equal(normalizeSnapshot(envelope.provider, envelope).identity_status, 'matched');
  }
});

test('low-confidence and wrong-name queries save evidence but never call the URL-only providers', async t => {
  for (const kind of ['wrong_name', 'contradictory_context', 'missing_likelihood', 'low_likelihood', 'missing_url']) {
    const cacheDir = await cache(t), calls = [], raw = payloads();
    if (kind === 'wrong_name') raw.pdl.data.first_name = 'Different';
    if (kind === 'contradictory_context') { raw.pdl.data.experience = []; raw.pdl.data.headline = 'Works at Other Business'; raw.pdl.data.job_company_name = 'Other Business'; }
    if (kind === 'missing_likelihood') delete raw.pdl.likelihood;
    if (kind === 'low_likelihood') raw.pdl.likelihood = 5;
    if (kind === 'missing_url') raw.pdl.data.linkedin_url = null;
    let result;
    await quiet(async () => {
      try { result = await main(['--query', 'Chris Maresca Helmsted', '--local'], env, { cacheDir, fetchImpl: transport(raw, calls) }); }
      catch (error) { assert.match(error.message, /failed|review/i); }
    });
    assert.deepEqual(calls.map(call => call.provider), ['pdl']);
    const envelopes = await saved(cacheDir); assert.equal(envelopes.length, 1);
    const normalized = normalizeSnapshot('pdl', envelopes[0]);
    assert.notEqual(normalized.provenance.decision_receipt.action, 'accept_and_waterfall');
    if (normalized.provenance.decision_receipt.action === 'abstain_reject') assert.equal(result?.canonical ?? null, null);
  }
});

test('invalid query and missing PDL selection fail before a mocked transport can be called', async () => {
  const noNetwork = { fetchImpl: () => assert.fail('Invalid input must fail before HTTP') };
  for (const args of [['--query', 'Chris Maresca'], ['--query', `${url} https://linkedin.com/in/other`],
    ['--query', 'Chris Maresca Helmsted', '--providers', 'coresignal,brightdata']]) {
    await assert.rejects(() => quiet(() => main([...args, '--local'], env, noNetwork)));
  }
});

test('missing PDL key and a failed PDL HTTP response never start URL-only providers', async t => {
  const noKey = await quiet(() => main(['--query', 'Chris Maresca Helmsted', '--local'],
    { CORESIGNAL_API_KEY: 'core-test', BRIGHTDATA_API_KEY: 'bright-test' }, { fetchImpl: () => assert.fail('No PDL key must not call HTTP') }));
  assert.equal(noKey.processed, 0); assert.equal(noKey.canonical, null);
  const cacheDir = await cache(t), calls = [], mock = transport(payloads(), calls);
  await quiet(() => assert.rejects(() => main(['--query', 'Chris Maresca Helmsted', '--local'], env,
    { cacheDir, fetchImpl: async (endpoint, init) => {
      const response = await mock(endpoint, init);
      return new Response(await response.text(), { status: 401 });
    } })));
  assert.deepEqual(calls.map(call => call.provider), ['pdl']);
  const [envelope] = await saved(cacheDir);
  assert.equal(envelope.http_status, 401);
  assert.equal(normalizeSnapshot('pdl', envelope).provenance.decision_receipt.action, 'abstain_reject');
});

test('a followup returning a different URL stays mismatch and cannot acquire search-match status', async t => {
  const cacheDir = await cache(t), calls = [], raw = payloads();
  raw.coresignal.professional_network_url = 'https://www.linkedin.com/in/different-person';
  await quiet(() => assert.rejects(() => main(['--query', 'Chris Maresca Helmsted', '--providers', 'pdl,coresignal', '--local'], env,
    { cacheDir, fetchImpl: transport(raw, calls) })));
  assert.deepEqual(calls.map(call => call.provider), ['pdl', 'coresignal']);
  const followup = (await saved(cacheDir)).find(envelope => envelope.provider === 'coresignal');
  const normalized = normalizeSnapshot('coresignal', followup);
  assert.equal(normalized.identity_status, 'mismatch');
  assert.equal(normalized.provenance.decision_receipt.action, 'accept_and_waterfall');
  await replayFile(followup.local_cache_path, async replay => assert.equal(replay.identity_status, 'mismatch'));
});

test('raw cache replay recomputes stale PDL decisions and preserves waterfall identity without HTTP', async t => {
  const cacheDir = await cache(t), calls = [];
  await quiet(() => main(['--query', 'Chris Maresca Helmsted', '--local'], env, { cacheDir, fetchImpl: transport(payloads(), calls) }));
  for (const envelope of await saved(cacheDir)) {
    await replayFile(envelope.local_cache_path, async (normalized, options) => {
      assert.equal(options.replay, true); assert.equal(normalized.identity_status, 'search_match');
      assert.equal(normalized.provenance.decision_receipt.action, 'accept_and_waterfall');
    });
  }
  const legacy = snapshot(payloads().pdl, { first: 'Wrong', last: 'Person', company: 'Helmsted' });
  assert.equal(legacy.provenance.decision_receipt.action, 'abstain_reject');
  const { writeFile } = await import('node:fs/promises');
  const file = join(cacheDir, 'tampered-receipt.json'), raw = payloads().pdl;
  raw.data.first_name = 'Wrong';
  await writeFile(file, JSON.stringify({ id: '00000000-0000-4000-8000-000000000099', provider: 'pdl', input,
    retrieved_at: '2020-01-01T00:00:00Z', http_status: 200, raw_payload: raw,
    provenance: { decision_receipt: { action: 'accept_and_waterfall', confidence_interval: [1, 1] } } }));
  await replayFile(file, async normalized => {
    assert.equal(normalized.identity_status, 'missing_url');
    assert.equal(normalized.provenance.decision_receipt.action, 'abstain_reject');
  });
  assert.equal(calls.length, 3, 'Replay must not send new provider requests');
});

test('Bright Data pending collection and explicit finish retain the original search decision', async t => {
  const cacheDir = await cache(t), calls = [], raw = payloads();
  raw.brightdata = { snapshot_id: 's_synthetic_search', message: 'Pending fictional collection' };
  const pending = transport(raw, calls);
  await quiet(async () => {
    await assert.rejects(() => main(['--query', 'Chris Maresca Helmsted', '--providers', 'pdl,brightdata', '--local'], env,
      { cacheDir, fetchImpl: async (endpoint, init) => {
        const response = await pending(endpoint, init);
        return new URL(endpoint).hostname === 'api.brightdata.com' ? new Response(await response.text(), { status: 202 }) : response;
      } }));
  });
  const envelope = (await saved(cacheDir)).find(e => e.provider === 'brightdata');
  assert.equal(envelope.http_status, 202); assert.ok(envelope.search_origin);
  const result = await quiet(() => main(['--finish-brightdata', envelope.local_cache_path, '--local'], env,
    { cacheDir, fetchImpl: async (endpoint, init) => {
      assert.match(endpoint, /\/snapshot\/s_synthetic_search\?format=json$/); assert.equal(init.method, 'GET');
      calls.push({ provider: 'brightdata-download' }); return Response.json(payloads().brightdata);
    } }));
  assert.equal(result.canonical.identity_confidence, 'unverified_search_match');
  const downloaded = (await saved(cacheDir)).find(e => e.request_kind === 'snapshot_download');
  assert.deepEqual(downloaded.search_origin, envelope.search_origin);
  assert.equal(normalizeSnapshot('brightdata', downloaded).identity_status, 'search_match');
  await replayFile(downloaded.local_cache_path, async s => assert.equal(s.identity_status, 'search_match'));
  assert.deepEqual(calls.map(call => call.provider), ['pdl', 'brightdata', 'brightdata-download']);
});

test('legacy raw_response snapshot rows retain name gates and search ancestry when replayed', async t => {
  const cacheDir = await cache(t), calls = [];
  const { writeFile } = await import('node:fs/promises');
  const rejected = snapshotRow(snapshot(payloads().pdl, { first: 'Wrong', last: 'Person', company: 'Helmsted' }));
  const rejectedFile = join(cacheDir, 'rejected-snapshot-row.json');
  await writeFile(rejectedFile, JSON.stringify(rejected));
  await replayFile(rejectedFile, async replay => {
    assert.equal(replay.identity_status, 'missing_url');
    assert.equal(replay.provenance.decision_receipt.action, 'abstain_reject');
  });
  await quiet(() => main(['--query', 'Chris Maresca Helmsted', '--providers', 'pdl,coresignal', '--local'], env,
    { cacheDir, fetchImpl: transport(payloads(), calls) }));
  const envelope = (await saved(cacheDir)).find(row => row.provider === 'coresignal');
  const followupFile = join(cacheDir, 'followup-snapshot-row.json');
  await writeFile(followupFile, JSON.stringify(snapshotRow(normalizeSnapshot('coresignal', envelope))));
  await replayFile(followupFile, async replay => {
    assert.equal(replay.identity_status, 'search_match');
    assert.equal(replay.provenance.search_origin.resolution_id, envelope.search_origin.resolution_id);
  });
  assert.equal(calls.length, 2);
});


test('shared URL validation trims surrounding whitespace before detecting an explicit scheme', () => {
  assert.equal(normalizeSnapshot('pdl', {
    id: 'trimmed-input', provider: 'pdl', retrieved_at: '2026-10-15T00:00:00Z',
    input: { url: `  ${url}  ` }, http_status: 200, raw_payload: payloads().pdl,
  }).identity_status, 'matched');
});


test('ordinary words inside provider location text cannot become state corroboration', () => {
  for (const [location, returnedLocation] of [['Indiana', 'London in England'], ['Oregon', 'London or Paris'],
    ['Maine', 'Meet me in London'], ['Indiana', 'London IN England']]) {
    const raw = payloads().pdl;
    raw.data.location_name = returnedLocation;
    const decision = snapshot(raw, { first: 'Chris', last: 'Maresca', location }).provenance.decision_receipt;
    assert.equal(decision.scores.context_score, 0, returnedLocation);
    assert.equal(decision.action, 'review_only');
  }
  for (const returnedLocation of ['Tulsa, OK, United States', 'Oklahoma City, ok']) {
    const raw = payloads().pdl;
    raw.data.location_name = returnedLocation;
    const decision = snapshot(raw, { first: 'Chris', last: 'Maresca', location: 'Oklahoma' }).provenance.decision_receipt;
    assert.equal(decision.scores.context_score, 1);
  }
});

test('a preposition in returned location cannot authorize the paid URL waterfall', async t => {
  const cacheDir = await cache(t), calls = [], raw = payloads();
  raw.pdl.data.location_name = 'London in England';
  const result = await quiet(() => main(['--query', 'Chris Maresca in Indiana', '--local'], env,
    { cacheDir, fetchImpl: transport(raw, calls) }));
  assert.deepEqual(calls.map(call => call.provider), ['pdl']);
  assert.equal(result.canonical.identity_confidence, 'unverified_search_match');
  const [envelope] = await saved(cacheDir);
  assert.equal(normalizeSnapshot('pdl', envelope).provenance.decision_receipt.action, 'review_only');
});
