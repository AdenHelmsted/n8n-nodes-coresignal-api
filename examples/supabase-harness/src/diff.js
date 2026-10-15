import { employmentKey, canonicalJsonStringify } from './normalize.js';

export function diffCanonicalPerson(oldPerson, newPerson, triggerEnrichmentId, providerName) {
  if (!oldPerson || oldPerson.profile_hash === newPerson.profile_hash) return null;
  const changed_fields = {}, change_types = [];
  const compare = (field, type) => {
    if (canonicalJsonStringify(oldPerson[field]) !== canonicalJsonStringify(newPerson[field])) {
      changed_fields[field] = { before: oldPerson[field] ?? null, after: newPerson[field] ?? null };
      if (type) change_types.push(type);
    }
  };
  for (const [field, type] of [['full_name', 'name_changed'], ['current_title', 'title_changed'], ['current_company', 'company_changed'], ['location', 'location_changed'], ['headline', 'headline_changed']]) compare(field, type);
  const oldJobs = new Map((oldPerson.employment_history || []).map(job => [employmentKey(job), job]));
  const newJobs = newPerson.employment_history || [], added = newJobs.filter(job => !oldJobs.has(employmentKey(job)));
  if (added.length) change_types.push('job_added');
  if (newJobs.some(job => oldJobs.get(employmentKey(job))?.is_current && (!job.is_current || job.end_date))) change_types.push('job_ended');
  const strip = entries => (entries || []).map(({ sources, field_provenance, ...fields }) => fields)
    .sort((a, b) => canonicalJsonStringify(a).localeCompare(canonicalJsonStringify(b), 'en'));
  for (const [field, type] of [['employment_history', null], ['education', 'education_changed']]) {
    if (canonicalJsonStringify(strip(oldPerson[field])) !== canonicalJsonStringify(strip(newPerson[field]))) { compare(field, type); }
  }
  const changes = [...new Set(change_types)];
  const descriptions = changes.map(type => ({ job_added: 'added employment', job_ended: 'has a reported role ending', title_changed: 'has an updated current title', company_changed: 'has an updated current company',
    location_changed: `has an updated location (${newPerson.location || 'unknown'})`, headline_changed: 'has an updated headline', education_changed: 'has updated education', name_changed: 'has an updated name' })[type]);
  return { person_id: newPerson.id, trigger_enrichment_id: triggerEnrichmentId, provider_name: providerName,
    previous_hash: oldPerson.profile_hash, new_hash: newPerson.profile_hash, change_types: changes, changed_fields,
    advisor_summary: `${newPerson.full_name || 'This person'} ${descriptions.join('; ') || 'has updated profile details'}; review the source claims.` };
}
