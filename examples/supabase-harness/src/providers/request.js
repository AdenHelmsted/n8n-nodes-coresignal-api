import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

// Only public matching inputs are retained; credentials and request headers never are.
export function matchingInput(input) {
  return Object.fromEntries(['url', 'first', 'last', 'company', 'location', 'domain', 'query']
    .filter(key => typeof input[key] === 'string' && input[key].trim())
    .map(key => [key, input[key].trim()]));
}

export async function requestCached(provider, input, endpoint, init, {
  fetchImpl = fetch, cacheDir = '.cache/raw', secret = '', metadata = {},
} = {}) {
  input = matchingInput(input);
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  // Fail before spending credits if the local cache cannot be written.
  const probe = resolve(cacheDir, `.write-check-${randomUUID()}`);
  await writeFile(probe, '', { flag: 'wx', mode: 0o600 });
  await unlink(probe);
  const retrieved_at = new Date().toISOString(), id = randomUUID();
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const local_cache_path = resolve(cacheDir, `${provider}_${hash}_${retrieved_at.replaceAll(':', '-')}_${id}.json`);
  let http_status = null, raw_payload, credits_remaining = null, billing_headers = null;
  try {
    const response = await fetchImpl(endpoint, { ...init, redirect: 'error' });
    http_status = response.status;
    const value = response.headers.get('x-credits-remaining');
    credits_remaining = value !== null && /^\d+$/.test(value) ? Number(value) : null;
    const present = Object.fromEntries(['x-credits-remaining', 'x-ratelimit-remaining', 'x-call-credits-spent',
      'x-call-credits-type', 'x-totallimit-remaining', 'x-totallimit-purchased-remaining', 'x-lifetime-used', 'retry-after']
      .map(name => [name, response.headers.get(name)]).filter(([, value]) => value !== null));
    billing_headers = Object.keys(present).length ? present : null;
    let body = await response.text();
    if (secret) body = body.replaceAll(secret, '[REDACTED]');
    try { raw_payload = JSON.parse(body); } catch { raw_payload = body; }
  } catch {
    raw_payload = { error: 'Network error or timeout; no automatic retry.' };
  }
  const envelope = { ...metadata, id, provider, input, retrieved_at, http_status, endpoint, request_count: 1,
    credits_remaining, billing_headers, estimated_credits: null,
    raw_payload, local_cache_path };
  // This is the first persisted record and always precedes normalization/database work.
  await writeFile(local_cache_path, `${JSON.stringify(envelope, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return envelope;
}
