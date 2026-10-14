// MIT adaptations credited in THIRD_PARTY_NOTICES.md.
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const API = 'https://api.coresignal.com/cdapi/v2/employee_multi_source/collect/';
const SOURCES = {
  name: 'full_name', linkedin_url: 'professional_network_url', headline: 'headline',
  location: 'location_full', employment_history: 'experience',
  education: 'education', profile_picture_ref: 'picture_url',
};

// Adapted from OpenProspector's linkedinSlug; validate the host and entire path.
export function linkedinUrl(input) {
  const url = new URL(input.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port
      || !/^(?:www\.|[a-z]{2,3}\.)?linkedin\.com$/i.test(url.hostname)) {
    throw new Error('Use a LinkedIn profile URL: https://www.linkedin.com/in/person/');
  }
  const match = /^\/in\/([^/]+)\/?$/.exec(url.pathname);
  const slug = match && decodeURIComponent(match[1]).normalize('NFC').toLowerCase();
  if (!slug || !/^[\p{L}\p{N}_-]+$/u.test(slug)) throw new Error('Invalid LinkedIn profile path.');
  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;
}

// Adapted from OpenProspector's vendorFetch. One request, with no retries/redirects.
export async function vendorFetch(url, apiKey, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    method: 'GET', headers: { Accept: 'application/json', apikey: apiKey },
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  const balance = response.headers.get('x-credits-remaining');
  return {
    status: response.status, body,
    creditsRemaining: balance !== null && /^\d+$/.test(balance) ? Number(balance) : null,
  };
}

export function makeSnapshot(requestedUrl, result, { id = randomUUID(), retrievedAt = new Date().toISOString() } = {}) {
  const requested = linkedinUrl(requestedUrl);
  const raw = result.body;
  const record = result.status === 200 && raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const sources = { ...SOURCES, linkedin_url: typeof record.linkedin_url === 'string' ? 'linkedin_url' : 'professional_network_url' };
  let returned = null;
  try { returned = linkedinUrl(record[sources.linkedin_url]); } catch { /* Unverified identifier. */ }
  let match = returned === requested ? 'matched_url' : returned ? 'mismatch' : 'unverified';
  if (result.status !== 200) match = 'unavailable';
  if (record.is_deleted === 1 || record.is_deleted === true) match = 'unavailable';
  const person = Object.fromEntries(Object.keys(SOURCES).map(field => [field, null]));
  for (const [field, source] of Object.entries(sources)) {
    const value = record[source];
    person[field] = ['employment_history', 'education'].includes(field)
      ? (Array.isArray(value) ? value : null)
      : (typeof value === 'string' ? value : null);
  }
  person.linkedin_url = returned;
  return {
    id, provider: 'coresignal', requested_linkedin_url: requested,
    ...person, retrieved_at: retrievedAt, provider_record_id: record.id == null ? null : String(record.id),
    source_updated_at: record.updated_at ?? null, match_status: match,
    http_status: result.status, request_count: 1,
    estimated_credits: result.status === 200 ? 10 : null,
    credits_remaining: result.creditsRemaining ?? null,
    provenance: { endpoint: result.endpoint ?? null, bundle: 'core_employee_data', fields: sources },
    raw_response: raw ?? null,
  };
}

export async function collectPerson(url, apiKey, fetchImpl = fetch) {
  if (!apiKey) throw new Error('Set CORESIGNAL_API_KEY in .env.');
  const canonical = linkedinUrl(url);
  // Request construction adapted from Coresignal's official get_by_slug node.
  const endpoint = `${API}${canonical.split('/')[4]}?bundle=core_employee_data`;
  let result;
  try { result = await vendorFetch(endpoint, apiKey, fetchImpl); }
  catch { result = { status: null, body: { error: 'Network error or timeout; no automatic retry.' } }; }
  return makeSnapshot(canonical, { ...result, endpoint });
}

export function supabaseConfig(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY, or use --local.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('SUPABASE_URL must use HTTPS (except local development).');
  }
  return { url, key };
}

export async function saveToSupabase(snapshot, { url, key, fetchImpl = fetch }) {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchImpl },
  });
  // A replay keeps the same run ID; ignoring duplicates preserves manual reviews.
  const { error } = await client.from('person_enrichments')
    .upsert(snapshot, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw new Error(`Supabase save failed (${error.code ?? 'request error'}). Import the saved run to retry.`);
}

async function writeRun(snapshot) {
  await mkdir('runs', { recursive: true, mode: 0o700 });
  const path = resolve('runs', `${snapshot.id}.json`);
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return path;
}

function summarize(snapshot) {
  console.log(JSON.stringify({
    id: snapshot.id, http_status: snapshot.http_status, match_status: snapshot.match_status,
    employment_entries: snapshot.employment_history?.length ?? 0,
    education_entries: snapshot.education?.length ?? 0,
    estimated_credits: snapshot.estimated_credits, credits_remaining: snapshot.credits_remaining,
  }, null, 2));
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { local: { type: 'boolean' } } });
  const [command, input] = positionals;
  if (!['enrich', 'import', 'demo'].includes(command) || positionals.length !== (command === 'demo' ? 1 : 2)) {
    throw new Error('Usage: npm run enrich -- <LinkedIn URL> [--local]\n       npm run import -- <saved run.json>\n       npm run demo');
  }
  const local = values.local || command === 'demo';
  const config = local ? null : supabaseConfig(env); // Check config before any provider charge.
  let snapshot;
  if (command === 'import') {
    snapshot = JSON.parse(await readFile(input, 'utf8'));
    if (!/^[0-9a-f-]{36}$/i.test(snapshot.id ?? '') || snapshot.provider !== 'coresignal'
        || !snapshot.requested_linkedin_url || !snapshot.provenance) {
      throw new Error('Import a saved harness run, not a raw provider response.');
    }
    // Reapply current field mappings to the original response without another lookup.
    if (!snapshot.provenance.synthetic) {
      snapshot = makeSnapshot(snapshot.requested_linkedin_url, {
        status: snapshot.http_status, body: snapshot.raw_response,
        creditsRemaining: snapshot.credits_remaining, endpoint: snapshot.provenance.endpoint,
      }, { id: snapshot.id, retrievedAt: snapshot.retrieved_at });
      await writeFile(input, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
    }
    console.log(`Saved run: ${resolve(input)}`);
  } else {
    // Test the output directory before spending a provider credit.
    await mkdir('runs', { recursive: true, mode: 0o700 });
    const probe = resolve('runs', `.write-check-${randomUUID()}`);
    await writeFile(probe, '', { flag: 'wx', mode: 0o600 });
    await unlink(probe);
    snapshot = command === 'demo'
      ? makeSnapshot('https://www.linkedin.com/in/synthetic-person/', {
        status: 200, body: JSON.parse(await readFile(new URL('./fixtures/person.json', import.meta.url), 'utf8')),
      })
      : await collectPerson(input, env.CORESIGNAL_API_KEY);
    if (command === 'demo') {
      snapshot.request_count = 0;
      snapshot.estimated_credits = 0;
      snapshot.provenance.synthetic = true;
    }
    console.log(`Saved run: ${await writeRun(snapshot)}`);
  }
  summarize(snapshot);
  if (config) {
    await saveToSupabase(snapshot, config);
    console.log('Saved to Supabase person_enrichments (existing run IDs are left unchanged).');
  }
  if (snapshot.http_status !== 200) throw new Error('Coresignal lookup failed. Inspect the saved run; no retry was made.');
  if (snapshot.match_status !== 'matched_url') throw new Error('Returned identity needs manual review. Inspect the saved run.');
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
