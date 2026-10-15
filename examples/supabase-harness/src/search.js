import { normalizeLinkedinUrl, normStr } from './identifiers.js';

const STATE_NAMES_BY_CODE = new Map([
  ['al', 'alabama'], ['ak', 'alaska'], ['az', 'arizona'],
  ['ar', 'arkansas'], ['ca', 'california'], ['co', 'colorado'],
  ['ct', 'connecticut'], ['de', 'delaware'], ['fl', 'florida'],
  ['ga', 'georgia'], ['hi', 'hawaii'], ['id', 'idaho'],
  ['il', 'illinois'], ['in', 'indiana'], ['ia', 'iowa'],
  ['ks', 'kansas'], ['ky', 'kentucky'], ['la', 'louisiana'],
  ['me', 'maine'], ['md', 'maryland'], ['ma', 'massachusetts'],
  ['mi', 'michigan'], ['mn', 'minnesota'], ['ms', 'mississippi'],
  ['mo', 'missouri'], ['mt', 'montana'], ['ne', 'nebraska'],
  ['nv', 'nevada'], ['nh', 'new hampshire'], ['nj', 'new jersey'],
  ['nm', 'new mexico'], ['ny', 'new york'], ['nc', 'north carolina'],
  ['nd', 'north dakota'], ['oh', 'ohio'], ['ok', 'oklahoma'],
  ['or', 'oregon'], ['pa', 'pennsylvania'], ['ri', 'rhode island'],
  ['sc', 'south carolina'], ['sd', 'south dakota'], ['tn', 'tennessee'],
  ['tx', 'texas'], ['ut', 'utah'], ['vt', 'vermont'],
  ['va', 'virginia'], ['wa', 'washington'], ['wv', 'west virginia'],
  ['wi', 'wisconsin'], ['wy', 'wyoming'], ['dc', 'district of columbia'],
]);
const STATE_NAMES = new Set(STATE_NAMES_BY_CODE.values());
const METROS = new Set([
  'tulsa', 'oklahoma city', 'nyc', 'new york', 'dallas', 'london',
  'san francisco', 'chicago', 'boston', 'los angeles', 'seattle',
  'austin', 'miami', 'denver', 'atlanta', 'san diego',
  'philadelphia', 'washington dc',
]);

const SEARCH_POLICY = Object.freeze({
  version: 'people-search-v1',
  scoreKind: 'heuristic_evidence_band',
  weights: Object.freeze({ name: 0.65, context: 0.25, likelihood: 0.10 }),
  uncertainty: Object.freeze({ base: 0.02, fuzzyName: 0.08, missingContext: 0.20, missingLikelihood: 0.25 }),
  missingLikelihoodScore: 0.5,
  minProviderLikelihood: 6,
  acceptThreshold: 0.75,
  reviewThreshold: 0.50,
});
const NAME_TOKEN = /^[\p{L}][\p{L}\p{M}'’.-]*$/u;
const QUERY_INPUT_ERROR = 'Query needs first and last name plus company or location; use --company or --location for ambiguous input.';
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;

function extractPersonalUrl(query) {
  const candidates = query.match(/https?:\/\/[^\s<>"']+|(?<![\p{L}\p{N}_./@-])(?:[\w-]+\.)*linkedin\.com[^\s<>"']*/giu) || [];
  const links = candidates.filter(value => /linkedin\.com/i.test(value));
  const urls = new Set(links.map(value => normalizeLinkedinUrl(value.replace(/[)\],.;!?]+$/g, ''))));
  if (urls.size > 1 || !urls.size && /linkedin\.com/i.test(query)) {
    throw new Error('Query must contain one valid personal LinkedIn URL.');
  }
  return urls.values().next().value ?? null;
}

function isLocationContext(context) {
  const normalized = normStr(context);
  if (STATE_NAMES_BY_CODE.has(normalized) || STATE_NAMES.has(normalized) || METROS.has(normalized)) {
    return true;
  }
  const cityState = /,\s*([a-z]{2})$/i.exec(context);
  return Boolean(cityState && STATE_NAMES_BY_CODE.has(cityState[1].toLowerCase()));
}

function classifyContext(context, connector) {
  if (connector === 'at') return 'company';
  if (connector === 'in' || isLocationContext(context)) return 'location';
  return 'company';
}

function contextOverrides(overrides) {
  return Object.fromEntries(['company', 'location', 'domain']
    .filter(key => text(overrides[key]))
    .map(key => [key, overrides[key].trim()]));
}

export function parseQuery(query, overrides = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 2048) {
    throw new Error('Use a nonempty query of at most 2048 characters.');
  }
  const url = extractPersonalUrl(query);
  if (url) return { url };

  const tokens = query.trim().split(/\s+/);
  const first = tokens.shift()?.replace(/,+$/, '');
  const last = tokens.shift()?.replace(/,+$/, '');
  const rest = tokens.join(' ').replace(/^[,\s-]+/, '');
  const hint = /^(at|in|from)\s+(.+)$/i.exec(rest);
  const connector = hint?.[1].toLowerCase();
  const context = (hint?.[2] || rest).trim();
  const supplied = contextOverrides(overrides);
  const suppliedContext = Boolean(supplied.company || supplied.location);

  // An uppercase state code such as IN is a place; a trailing lowercase "in" is an unfinished connector.
  const uppercaseStateCode = /^[A-Z]{2}$/.test(context) && STATE_NAMES_BY_CODE.has(context.toLowerCase());
  const danglingConnector = /^(at|in|from)$/i.test(context) && !uppercaseStateCode;
  const validName = [first, last].every(value => NAME_TOKEN.test(value || ''));
  if (!validName || !suppliedContext && (!context || danglingConnector)) {
    throw new Error(QUERY_INPUT_ERROR);
  }

  if (suppliedContext) return { first, last, ...supplied, query };
  const slot = classifyContext(context, connector);
  return { first, last, ...supplied, [slot]: context, query };
}

function normalizeName(value) {
  return (text(value) || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function hasSingleEdit(left, right) {
  if (!left || !right) return false;
  let index = 0;
  while (index < Math.min(left.length, right.length) && left[index] === right[index]) index++;
  if (left.length === right.length) {
    const replacement = left.slice(index + 1) === right.slice(index + 1);
    const transposition = left[index] === right[index + 1] && left[index + 1] === right[index]
      && left.slice(index + 2) === right.slice(index + 2);
    return replacement || transposition;
  }
  if (Math.abs(left.length - right.length) !== 1) return false;
  if (left.length > right.length) return left.slice(index + 1) === right.slice(index);
  return left.slice(index) === right.slice(index + 1);
}

function scoreName(input, snapshot) {
  const fullNameTokens = snapshot.full_name?.split(/\s+/) || [];
  const first = normalizeName(input.first);
  const last = normalizeName(input.last);
  const returnedFirst = normalizeName(snapshot.first_name || fullNameTokens[0]);
  const returnedLast = normalizeName(snapshot.last_name || fullNameTokens.at(-1));
  if (!first || !last || !returnedFirst || !returnedLast) return 0;
  if (first === returnedFirst && last === returnedLast) return 1;

  const editedLast = first === returnedFirst && hasSingleEdit(last, returnedLast);
  const editedFirst = last === returnedLast && hasSingleEdit(first, returnedFirst);
  return editedLast || editedFirst ? 0.8 : 0;
}

function normalizeLocation(value) {
  // Expand only complete comma-separated place components (or a standalone code).
  // Ordinary words such as "in", "or" and "me" inside location text are not states.
  const components = (text(value) || '').split(',').map(part => {
    const component = part.trim();
    return STATE_NAMES_BY_CODE.get(component.toLowerCase()) || component;
  });
  return normStr(components.join(', ')).replace(/\bnyc\b/g, 'new york');
}

function containsPhrase(value, phrase) {
  return Boolean(phrase) && ` ${value} `.includes(` ${phrase} `);
}

function scoreContext(kind, target, snapshot) {
  const normalize = kind === 'location' ? normalizeLocation : normStr;
  const wanted = normalize(target);
  const sourceValues = kind === 'location'
    ? [snapshot.location]
    : snapshot.employment_history.map(job => job.company_name);
  const values = sourceValues.map(normalize).filter(Boolean);
  const headline = kind === 'company' ? normStr(snapshot.headline) : '';
  if (!values.length && !headline) return 0.5;

  const matchingValue = values.some(value => kind === 'company' ? value === wanted : containsPhrase(value, wanted));
  if (matchingValue || containsPhrase(headline, wanted)) return 1;
  return 0;
}

function scoreContexts(input, snapshot) {
  const contexts = ['company', 'location'].filter(key => text(input[key]));
  if (!contexts.length) return 0.5;
  // Supplying both slots makes the weaker signal decisive; a matching company cannot hide a wrong location.
  return Math.min(...contexts.map(key => scoreContext(key, input[key], snapshot)));
}

function uncertaintyRadius(scores) {
  const uncertainty = SEARCH_POLICY.uncertainty;
  let radius = uncertainty.base;
  if (scores.name_score === 0.8) radius += uncertainty.fuzzyName;
  if (scores.context_score === 0.5) radius += uncertainty.missingContext;
  if (scores.likelihood_score === null) radius += uncertainty.missingLikelihood;
  return radius;
}

function hasPersonalUrl(value) {
  try {
    normalizeLinkedinUrl(value);
    return true;
  } catch {
    return false;
  }
}

function canEvaluateCandidate(snapshot, likelihood, likelihoodScore) {
  const validLikelihood = likelihood === undefined
    || likelihoodScore !== null && likelihood >= SEARCH_POLICY.minProviderLikelihood;
  return snapshot.http_status === 200
    && snapshot.identity_status === 'search_match'
    && hasPersonalUrl(snapshot.returned_linkedin_url)
    && validLikelihood;
}

function confidenceBand(confidence, radius, eligible, nameScore) {
  // Round the lower bound down and upper bound up; floating-point noise must not move a boundary by a cent.
  let low = 0;
  if (eligible && nameScore > 0) {
    low = Math.max(0, Math.floor((confidence - radius + 1e-9) * 100) / 100);
  }
  const high = Math.min(1, Math.ceil((confidence + radius - 1e-9) * 100) / 100);
  return [low, high];
}

function policyAction(low) {
  if (low >= SEARCH_POLICY.acceptThreshold) return 'accept_and_waterfall';
  if (low >= SEARCH_POLICY.reviewThreshold) return 'review_only';
  return 'abstain_reject';
}

export function decideSearch(snapshot) {
  const input = snapshot.input || {};
  const body = Array.isArray(snapshot.raw_payload) ? snapshot.raw_payload[0] : snapshot.raw_payload;
  const likelihood = body?.likelihood;
  const validLikelihood = Number.isFinite(likelihood) && likelihood >= 0 && likelihood <= 10;
  const scores = {
    name_score: scoreName(input, snapshot),
    context_score: scoreContexts(input, snapshot),
    likelihood_score: validLikelihood ? likelihood / 10 : null,
  };

  // Local policy weights and uncertainty penalties are heuristic, not calibrated probabilities or statistical intervals.
  const weights = SEARCH_POLICY.weights;
  const weightedScore = weights.name * scores.name_score + weights.context * scores.context_score
    + weights.likelihood * (scores.likelihood_score ?? SEARCH_POLICY.missingLikelihoodScore);
  const confidence = Math.round(weightedScore * 100) / 100;
  const eligible = canEvaluateCandidate(snapshot, likelihood, scores.likelihood_score);
  const interval = confidenceBand(confidence, uncertaintyRadius(scores), eligible, scores.name_score);
  const classifiedInput = Object.fromEntries(['first', 'last', 'company', 'location']
    .filter(key => text(input[key]))
    .map(key => [key, input[key]]));

  return {
    policy_version: SEARCH_POLICY.version,
    score_kind: SEARCH_POLICY.scoreKind,
    query: input.query ?? [input.first, input.last, input.company, input.location].filter(Boolean).join(' '),
    classified_input: classifiedInput,
    scores,
    confidence,
    confidence_interval: interval,
    min_confidence_gate: SEARCH_POLICY.acceptThreshold,
    action: policyAction(interval[0]),
  };
}
