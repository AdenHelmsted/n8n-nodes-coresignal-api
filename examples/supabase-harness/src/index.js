import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collect as coresignal } from './providers/coresignal.js';
import { collect as pdl } from './providers/pdl.js';
import { collect as brightdata, finish as finishBrightdata } from './providers/brightdata.js';
import { normalizeLinkedinUrl, normalizeSnapshot } from './normalize.js';
import { mergeSnapshotsToCanonical } from './merge.js';
import { createDb, preflightDb, storeSnapshot } from './db.js';

const adapters = { coresignal, pdl, brightdata };
export async function replayFile(file, processSnapshot) {
  const envelope = JSON.parse(await readFile(file, 'utf8'));
  // Also accept the original harness's runs/*.json without calling a provider.
  if (!envelope.raw_payload && envelope.raw_response !== undefined) {
    Object.assign(envelope, { input: { url: envelope.requested_linkedin_url }, raw_payload: envelope.raw_response,
      endpoint: envelope.provenance?.endpoint, local_cache_path: resolve(file) });
  }
  if (!adapters[envelope.provider] || !envelope.id || !envelope.retrieved_at || envelope.raw_payload === undefined) throw new Error('Not a saved provider envelope.');
  return processSnapshot(normalizeSnapshot(envelope.provider, envelope), { replay: true });
}
export async function main(args = process.argv.slice(2), env = process.env) {
  const { values: v } = parseArgs({ args, options: {
    url: { type: 'string' }, providers: { type: 'string', default: 'coresignal,pdl,brightdata' },
    resolve: { type: 'boolean' }, first: { type: 'string' }, last: { type: 'string' }, company: { type: 'string' },
    location: { type: 'string' }, domain: { type: 'string' }, replay: { type: 'string' },
    'weekly-refresh': { type: 'boolean' }, limit: { type: 'string', default: '25' }, 'finish-brightdata': { type: 'string' },
    offline: { type: 'boolean' }, local: { type: 'boolean' },
  } });
  const modes = [v.url, v.resolve, v.replay, v['weekly-refresh'], v['finish-brightdata']].filter(Boolean);
  if (modes.length !== 1) throw new Error('Choose --url URL, --resolve --first NAME --last NAME --company COMPANY, --replay FILE, or --weekly-refresh.');
  const providers = [...new Set(v.providers.split(',').map(name => name.trim().toLowerCase()).filter(Boolean))];
  if (!providers.length || providers.some(name => !adapters[name])) throw new Error('Providers: coresignal,pdl,brightdata.');
  if (v.url) v.url = normalizeLinkedinUrl(v.url);
  if (v.resolve && (!v.first || !v.last || !(v.company || v.location))) throw new Error('Resolution requires first/last and company or location.');
  const limit = Number(v.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be 1–100.');
  if (v['weekly-refresh'] && (v.local || v.offline)) throw new Error('Weekly selection requires Supabase.');
  const db = v.local || v.offline ? null : createDb(env);
  if (db) await preflightDb(db); // Detect unapplied migration before any provider request.
  let canonical = null, processed = 0, failures = 0;
  const processSnapshot = async (snapshot, options = {}) => {
    const result = db ? await storeSnapshot(db, snapshot, options) : { local: true };
    if (!db) canonical = mergeSnapshotsToCanonical(canonical, snapshot, snapshot.id);
    processed++;
    console.log(JSON.stringify({ provider: snapshot.provider_name, status: snapshot.http_status, identity: snapshot.identity_status,
      cache: snapshot.local_cache_path, estimated_credits: snapshot.estimated_credits, credits_remaining: snapshot.credits_remaining, ...result }));
    if (snapshot.provider_name === 'brightdata' && snapshot.raw_payload?.snapshot_id) console.log(`Bright Data pending: use --finish-brightdata "${snapshot.local_cache_path}" later; do not resubmit the URL.`);
    if (snapshot.http_status !== 200 || !['matched', 'search_match'].includes(snapshot.identity_status)) failures++;
    return result;
  };
  const run = async input => {
    for (const provider of providers) {
      try {
        if (!input.url && provider !== 'pdl') { console.log(`${provider}: skipped (URL required).`); continue; }
        const envelope = v.offline ? { id: randomUUID(), provider, input, http_status: 200,
          retrieved_at: '2026-10-15T00:00:00Z', request_count: 0, estimated_credits: 0, local_cache_path: 'offline fixture',
          raw_payload: JSON.parse(await readFile(new URL(`../test/fixtures/${provider}.json`, import.meta.url), 'utf8')) }
          : await adapters[provider](input, { env });
        if (!envelope) { console.log(`${provider}: skipped (missing key or unsupported input).`); continue; }
        await processSnapshot(normalizeSnapshot(provider, envelope));
      } catch (error) { failures++; console.error(`${provider}: ${error.message}`); }
    }
  };
  if (v['finish-brightdata']) {
    if (v.offline) throw new Error('Use --replay for offline inspection of a pending response.');
    const envelope = await finishBrightdata(JSON.parse(await readFile(v['finish-brightdata'], 'utf8')), { env });
    if (envelope) await processSnapshot(normalizeSnapshot('brightdata', envelope));
    else console.log('brightdata: skipped (missing key).');
  } else if (v.replay) await replayFile(v.replay, processSnapshot);
  else if (v['weekly-refresh']) {
    const { data, error } = await db.from('people').select('canonical_linkedin_url')
      .eq('identity_confidence', 'verified').lt('last_checked_at', new Date(Date.now() - 7 * 86400_000).toISOString())
      .order('last_checked_at').limit(limit);
    if (error) throw new Error(`Weekly selection failed (${error.code}).`);
    for (const person of data) await run({ url: person.canonical_linkedin_url });
  } else await run({ url: v.url, first: v.first, last: v.last, company: v.company, location: v.location, domain: v.domain });
  if (canonical) console.log(JSON.stringify({ offline_or_local: true, full_name: canonical.full_name,
    providers: canonical.providers_contributed, employment_entries: canonical.employment_history.length,
    education_entries: canonical.education.length, needs_manual_review: canonical.needs_manual_review, profile_hash: canonical.profile_hash }));
  if (failures) throw new Error(`${failures} lookup(s) failed or need identity review; cached responses were retained.`);
  return { processed, failures };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
