import { normalizeLinkedinUrl } from '../identifiers.js';
import { requestCached } from './request.js';

const apiKey = env => env.BRIGHTDATA_API_KEY || env.BRIGHT_DATA_API_KEY || env.BRIGHT_DATA_TOKEN || env.BRIGHTDATA_API_TOKEN;

// Official LinkedIn profiles dataset; synchronous API accepts {input:[{url}]}.
// https://docs.brightdata.com/api-reference/scrapers/synchronous-requests
export async function collect(input, { env = process.env, fetchImpl = fetch, cacheDir = '.cache/raw', metadata = {} } = {}) {
  const key = apiKey(env);
  if (!key || !input.url) return null;
  const url = normalizeLinkedinUrl(input.url);
  const endpoint = 'https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_l1viktl72bvl7bjuj0&format=json&include_errors=true';
  // Server may return 202 + snapshot_id after 60 seconds. Cache it; never resubmit/poll automatically.
  return requestCached('brightdata', { url }, endpoint, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ input: [{ url }] }), signal: AbortSignal.timeout(70_000),
  }, { fetchImpl, cacheDir, secret: key, metadata });
}

// Download an already-started job once; this does not trigger another collection.
export async function finish(envelope, { env = process.env, fetchImpl = fetch, cacheDir = '.cache/raw', metadata = {} } = {}) {
  const key = apiKey(env);
  if (!key) return null;
  const snapshotId = envelope?.raw_payload?.snapshot_id;
  if (envelope?.provider !== 'brightdata' || !/^s(?:d|r)?_[A-Za-z0-9_-]+$/.test(snapshotId || '')) {
    throw new Error('Finish requires a cached Bright Data response containing a valid snapshot_id.');
  }
  const input = { url: normalizeLinkedinUrl(envelope.input?.url) };
  const endpoint = `https://api.brightdata.com/datasets/v3/snapshot/${encodeURIComponent(snapshotId)}?format=json`;
  return requestCached('brightdata', input, endpoint, {
    method: 'GET', headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000),
  }, { fetchImpl, cacheDir, secret: key, metadata: { ...metadata, ...(envelope.search_origin ? { search_origin: envelope.search_origin } : {}),
    parent_collection_id: envelope.parent_collection_id || envelope.id,
    parent_cache_path: envelope.parent_cache_path || envelope.local_cache_path,
    collection_request_count: 0, request_kind: 'snapshot_download',
  } });
}
