import { normalizeLinkedinUrl } from '../identifiers.js';
import { requestCached } from './request.js';

// Existing tested Employee Multi-source core bundle endpoint and apikey auth.
export async function collect(input, { env = process.env, fetchImpl = fetch, cacheDir = '.cache/raw', metadata = {} } = {}) {
  const key = env.CORESIGNAL_API_KEY;
  if (!key || !input.url) return null;
  const url = normalizeLinkedinUrl(input.url);
  const endpoint = `https://api.coresignal.com/cdapi/v2/employee_multi_source/collect/${url.split('/')[4]}?bundle=core_employee_data`;
  return requestCached('coresignal', { url }, endpoint, {
    method: 'GET', headers: { apikey: key, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000),
  }, { fetchImpl, cacheDir, secret: key, metadata });
}
