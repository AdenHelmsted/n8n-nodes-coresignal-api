import { computeProfileHash, employmentKey, normStr, canonicalJsonStringify, normalizeLinkedinUrl } from './normalize.js';
export { employmentKey } from './normalize.js';

const priority = { coresignal: 1, brightdata: 2, pdl: 3 };
const present = value => value !== null && value !== undefined && value !== '';
const stamp = source => Date.parse(source?.source_updated_at || source?.retrieved_at || '') || 0;
const newer = (next, previous) => stamp(next) >= stamp(previous);
function preferred(next, previous) {
  if (!previous) return true;
  if (next.source_updated_at && previous.source_updated_at && !newer(next, previous)) return false;
  return (priority[next.provider] || 99) < (priority[previous.provider] || 99)
    || next.provider === previous.provider && newer(next, previous);
}
function selectField(target, provenance, field, value, origin, specific = false, freshest = false) {
  if (!present(value)) return;
  const previous = provenance[field], same = canonicalJsonStringify(target[field]) === canonicalJsonStringify(value);
  const longer = field === 'description' && String(value).length > String(target[field] || '').length;
  const shorter = field === 'description' && !longer && present(target[field]) && !same;
  const compatibleDates = specific && present(target[field]) && (String(value).startsWith(String(target[field])) || String(target[field]).startsWith(String(value)));
  const choose = !shorter && (compatibleDates && !same ? String(value).length > String(target[field]).length
    : !present(target[field]) || longer || (freshest ? newer(origin, previous) && (stamp(origin) !== stamp(previous) || preferred(origin, previous)) : preferred(origin, previous)));
  const conflicts = [...(previous?.conflicts || [])];
  if (!same && present(target[field])) {
    const { conflicts: oldConflicts, ...previousOrigin } = previous || {};
    const claim = choose ? { value: target[field], ...previousOrigin } : { value, ...origin };
    if (!conflicts.some(item => canonicalJsonStringify(item) === canonicalJsonStringify(claim))) conflicts.push(claim);
  }
  conflicts.sort((a, b) => canonicalJsonStringify(a).localeCompare(canonicalJsonStringify(b), 'en'));
  if (choose) { target[field] = value; provenance[field] = { ...origin, ...(conflicts.length ? { conflicts } : {}) }; }
  else if (previous && conflicts.length) provenance[field] = { ...previous, conflicts };
}
function mergeEntries(previous, incoming, key, origin, employment) {
  const records = new Map((previous || []).map(entry => [key(entry), structuredClone(entry)]));
  for (const entry of incoming || []) {
    const identity = key(entry);
    if (!identity.replaceAll('|', '')) continue;
    const old = records.get(identity), merged = old || {}, provenance = merged.field_provenance ||= {};
    for (const [field, value] of Object.entries(entry)) {
      if (['sources', 'field_provenance', 'is_current', 'end_date', 'current_status_known'].includes(field)) continue;
      selectField(merged, provenance, field, value, origin, field === 'start_date');
    }
    if (employment) {
      const statusOrigin = provenance.is_current;
      const observed = entry.current_status_known !== false;
      if (observed && (!old || newer(origin, statusOrigin) && (stamp(origin) !== stamp(statusOrigin) || preferred(origin, statusOrigin)))) {
        selectField(merged, provenance, 'is_current', Boolean(entry.is_current && !entry.end_date), origin, false, true);
        if (entry.end_date) selectField(merged, provenance, 'end_date', entry.end_date, origin, true, true);
        else if (entry.is_current) {
          const { conflicts: previousConflicts = [], ...priorOrigin } = provenance.end_date || {};
          const conflicts = [...previousConflicts, ...(merged.end_date ? [{ value: merged.end_date, ...priorOrigin }] : [])];
          conflicts.sort((a, b) => canonicalJsonStringify(a).localeCompare(canonicalJsonStringify(b), 'en'));
          merged.end_date = null; provenance.end_date = { ...origin, ...(conflicts.length ? { conflicts } : {}) };
        }
      } else if (observed && old && (entry.is_current !== merged.is_current || entry.end_date !== merged.end_date)) {
        const claims = provenance.is_current?.conflicts || [];
        claims.push({ value: entry.is_current, end_date: entry.end_date, ...origin });
        provenance.is_current = { ...(provenance.is_current || origin), conflicts: claims };
      }
      if (entry.end_date && merged.end_date) selectField(merged, provenance, 'end_date', entry.end_date, origin, true, true);
      merged.is_current = Boolean(merged.end_date ? false : merged.is_current);
    } else selectField(merged, provenance, 'end_date', entry.end_date, origin, true);
    merged.sources = [...new Set([...(merged.sources || []), origin.provider])].sort();
    records.set(identity, merged);
  }
  return [...records.values()].sort((a, b) => employment
    ? Number(b.is_current) - Number(a.is_current) || (b.start_date || '').localeCompare(a.start_date || '', 'en') || (a.company_name || '').localeCompare(b.company_name || '', 'en') || key(a).localeCompare(key(b), 'en')
    : key(a).localeCompare(key(b), 'en'));
}
export function mergeSnapshotsToCanonical(existing, snapshot, enrichmentId) {
  const invalid = !['matched', 'search_match'].includes(snapshot.identity_status);
  if (invalid) return existing ? { ...structuredClone(existing), needs_manual_review: true, identity_confidence: snapshot.identity_status === 'mismatch' ? 'conflict' : existing.identity_confidence } : null;
  const returned = normalizeLinkedinUrl(snapshot.returned_linkedin_url);
  if (existing && normalizeLinkedinUrl(existing.canonical_linkedin_url) !== returned) return { ...structuredClone(existing), needs_manual_review: true, identity_confidence: 'conflict' };
  if (existing?.identity_confidence === 'verified' && snapshot.identity_status === 'search_match') return { ...structuredClone(existing), needs_manual_review: true };
  const person = existing ? structuredClone(existing) : { canonical_linkedin_url: returned, linkedin_slug: returned.split('/').at(-1), field_provenance: {}, employment_history: [], education: [], providers_contributed: [] };
  const origin = { provider: snapshot.provider_name, enrichment_id: enrichmentId, retrieved_at: snapshot.retrieved_at, source_updated_at: snapshot.source_updated_at ?? null };
  person.field_provenance ||= {};
  for (const field of ['full_name', 'first_name', 'last_name', 'headline', 'location']) selectField(person, person.field_provenance, field, snapshot[field], origin);
  person.employment_history = mergeEntries(person.employment_history, snapshot.employment_history, employmentKey, origin, true);
  person.education = mergeEntries(person.education, snapshot.education, entry => `${normStr(entry.school_name)}|${normStr(entry.degree)}`, origin, false);
  const current = person.employment_history.find(entry => entry.is_current);
  person.current_title = current?.title ?? null; person.current_company = current?.company_name ?? null;
  person.providers_contributed = [...new Set([...(person.providers_contributed || []), snapshot.provider_name])].sort();
  person.identity_confidence = snapshot.identity_status === 'search_match' ? existing?.identity_confidence === 'verified' ? 'verified' : 'unverified_search_match' : 'verified';
  const conflicted = [person.field_provenance, ...person.employment_history.map(job => job.field_provenance), ...person.education.map(edu => edu.field_provenance)]
    .some(fields => Object.values(fields || {}).some(claim => claim.conflicts?.length));
  person.needs_manual_review = Boolean(existing?.needs_manual_review || snapshot.identity_status === 'search_match' || conflicted);
  person.last_enriched_at = [existing?.last_enriched_at, snapshot.retrieved_at].filter(Boolean).sort().at(-1);
  person.last_checked_at = [existing?.last_checked_at, snapshot.retrieved_at].filter(Boolean).sort().at(-1);
  person.updated_at = person.last_enriched_at; person.profile_hash = computeProfileHash(person);
  return person;
}
