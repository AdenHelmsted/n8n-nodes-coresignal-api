import { normalizeLinkedinUrl } from '../normalize.js';
import { matchingInput, requestCached } from './request.js';

// https://docs.peopledatalabs.com/docs/input-parameters-person-enrichment-api
export async function collect(input, { env = process.env, fetchImpl = fetch, cacheDir = '.cache/raw' } = {}) {
  const key = env.PDL_API_KEY || env.PEOPLEDATALABS_API_KEY;
  if (!key) return null;
  input = matchingInput(input);
  const params = new URLSearchParams({ min_likelihood: '6', include_if_matched: 'true' });
  if (input.url) {
    input = { url: normalizeLinkedinUrl(input.url) };
    params.set('profile', input.url);
  } else {
    if (!input.first || !input.last || !(input.company || input.location)) {
      throw new Error('PDL resolution requires first and last names plus company or location.');
    }
    for (const [field, param] of Object.entries({ first: 'first_name', last: 'last_name', company: 'company', location: 'location' })) {
      if (input[field]) params.set(param, input[field]);
    }
  }
  const endpoint = `https://api.peopledatalabs.com/v5/person/enrich?${params}`;
  return requestCached('pdl', input, endpoint, {
    method: 'GET', headers: { 'X-Api-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000),
  }, { fetchImpl, cacheDir, secret: key });
}
