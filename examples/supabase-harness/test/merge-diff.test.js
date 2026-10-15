import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeLinkedinUrl, normalizeCompanyLinkedinUrl, normalizeSnapshot, employmentKey, canonicalJsonStringify, computeProfileHash } from '../src/normalize.js';
import { mergeSnapshotsToCanonical } from '../src/merge.js';
import { diffCanonicalPerson } from '../src/diff.js';

const core = JSON.parse(await readFile(new URL('../fixtures/person.json', import.meta.url), 'utf8'));
const pdl = JSON.parse(await readFile(new URL('./fixtures/pdl-normalize.json', import.meta.url), 'utf8'));
const url = 'https://www.linkedin.com/in/synthetic-person';
const when = '2026-10-15T12:00:00Z';
const envelope = (raw, extra = {}) => ({ raw_payload: raw, http_status: 200, input: { url }, retrieved_at: when, request_count: 1, local_cache_path: '/offline/synthetic.json', ...extra });
const snapshot = (provider = 'coresignal', raw = core, extra = {}) => normalizeSnapshot(provider, envelope(raw, extra));
const seed = () => mergeSnapshotsToCanonical(null, snapshot(), 'core-1');

test('strict personal URL normalization accepts scheme-less provider strings and keeps company validation separate', () => {
  assert.equal(normalizeLinkedinUrl('linkedin.com/in/Synthetic-Person/?a=1#top'), url);
  assert.equal(normalizeLinkedinUrl('http://uk.linkedin.com/in/Synthetic-Person/'), url);
  assert.equal(normalizeCompanyLinkedinUrl('linkedin.com/company/Acme-LLC'), 'https://www.linkedin.com/company/acme-llc');
  for (const bad of ['linkedin.com/company/x', 'linkedin.com/in/a/b', 'linkedin.com/in/x%2Fy', 'linkedin.com.evil/in/x', 'https://evil@linkedin.com/in/x', 'ftp://linkedin.com/in/x', 'https://linkedin.com:8080/in/x']) assert.throws(() => normalizeLinkedinUrl(bad));
  assert.throws(() => normalizeCompanyLinkedinUrl(url));
});

test('Coresignal maps actual linkedin_url, precise observed dates, names and simultaneous jobs', () => {
  const value = snapshot('coresignal', { ...core, linkedin_url: url, first_name: 'Synthetic', last_name: 'Person',
    experience: [...core.experience, { company_name: 'Recent LLC', position_title: 'Trustee', date_from: 'July 2026', date_from_year: 2026, date_from_month: 7, active_experience: 1 }] });
  assert.equal(value.identity_status, 'matched');
  assert.equal(value.provenance.fields.returned_linkedin_url, 'linkedin_url');
  assert.equal(value.first_name, 'Synthetic');
  assert.equal(value.last_name, 'Person');
  assert.equal(value.employment_history[2].start_date, '2026-07');
  assert.equal(value.education[0].start_date, '2001');
  assert.equal(value.employment_history.filter(job => job.is_current).length, 3);
});

test('Coresignal parses precise date strings before falling back to structured year-only dates', () => {
  const value = snapshot('coresignal', { ...core, experience: [
    { company_name: 'Synthetic', position_title: 'Advisor', active_experience: 0, date_from_year: 2020, date_from: 'March 2020', date_to_year: 2025, date_to: '2025-08' },
    { company_name: 'Synthetic', position_title: 'Trustee', active_experience: 1, date_from_year: 2024, date_from: '2024' }
  ] });
  assert.equal(value.employment_history[0].start_date, '2020-03');
  assert.equal(value.employment_history[0].end_date, '2025-08');
  assert.equal(value.employment_history[1].start_date, '2024');
});

test('PDL normalizes wrappers, company identifiers, derived headline and ended primary roles', () => {
  const value = snapshot('pdl', pdl);
  assert.equal(value.identity_status, 'matched');
  assert.equal(value.headline, 'advisor at example advisors');
  assert.equal(value.provenance.fields.headline, 'derived:job_title+job_company_name');
  assert.equal(value.employment_history[0].company_linkedin_url, 'https://www.linkedin.com/company/example-advisors');
  assert.equal(value.employment_history[1].is_current, false);
  assert.equal(value.employment_history[1].end_date, '2022');
  assert.equal(value.avatar_source_url, null);
});

test('search, mismatch, missing, failed and deleted records remain unverified', () => {
  assert.equal(snapshot('pdl', pdl, { input: { first: 'Synthetic', last: 'Person' } }).identity_status, 'search_match');
  assert.equal(snapshot('coresignal', { ...core, linkedin_url: 'linkedin.com/in/wrong-person' }).identity_status, 'mismatch');
  assert.equal(snapshot('coresignal', {}).identity_status, 'missing_url');
  assert.equal(snapshot('coresignal', core, { http_status: 401 }).identity_status, 'missing_url');
  assert.equal(snapshot('coresignal', { ...core, is_deleted: true }).identity_status, 'missing_url');
  assert.throws(() => snapshot('apollo', {}), /Unsupported/);
});

test('PDL likelihood below six or malformed confidence cannot create or update a canonical record', () => {
  const person = seed();
  for (const likelihood of [0, 5, '5', null]) {
    const weak = snapshot('pdl', { ...pdl, likelihood });
    assert.equal(weak.identity_status, 'missing_url');
    assert.equal(mergeSnapshotsToCanonical(null, weak, 'weak'), null);
    const reviewed = mergeSnapshotsToCanonical(person, weak, 'weak');
    assert.equal(reviewed.needs_manual_review, true);
    assert.equal(reviewed.profile_hash, person.profile_hash);
  }
  assert.equal(snapshot('pdl', { ...pdl, likelihood: 6 }).identity_status, 'matched');
});

test('merge keeps provider priority, records conflicting claims, enriches gaps, and unions simultaneous jobs', () => {
  const first = seed();
  const merged = mergeSnapshotsToCanonical(first, snapshot('pdl', pdl), 'pdl-1');
  assert.equal(merged.full_name, 'Synthetic Person');
  assert.equal(merged.first_name, 'synthetic');
  assert.equal(merged.field_provenance.full_name.provider, 'coresignal');
  assert.equal(merged.field_provenance.full_name.conflicts[0].provider, 'pdl');
  assert.equal(merged.employment_history.filter(job => job.is_current).length, 2);
  assert.equal(merged.employment_history.length, 3);
  const advisor = merged.employment_history.find(job => job.title === 'Advisor');
  assert.deepEqual(advisor.sources, ['coresignal', 'pdl']);
  assert.equal(advisor.description, 'Long synthetic description from the secondary provider.');
  assert.equal(advisor.start_date, '2020-01');
  assert.deepEqual(merged.providers_contributed, ['coresignal', 'pdl']);
  assert.equal(merged.needs_manual_review, true);
  assert.deepEqual(first.providers_contributed, ['coresignal']);
});

test('BrightData scalar records combine with higher and lower priority providers', () => {
  const bright = snapshot('brightdata', [{ id: 'b-1', url, name: 'Synthetic Person BRIGHT', position: 'Bright headline', city: 'Bright City', avatar: 'https://example.com/avatar.jpg', experience: [], education: [] }]);
  const withPdl = mergeSnapshotsToCanonical(null, snapshot('pdl', pdl), 'pdl-1');
  const withBright = mergeSnapshotsToCanonical(withPdl, bright, 'bright-1');
  assert.equal(withBright.headline, 'Bright headline');
  const withCore = mergeSnapshotsToCanonical(withBright, snapshot(), 'core-1');
  assert.equal(withCore.headline, core.headline);
  assert.deepEqual(withCore.providers_contributed, ['brightdata', 'coresignal', 'pdl']);
});

test('BrightData documented nested fields map without inventing job dates or current status from prose', async () => {
  const raw = JSON.parse(await readFile(new URL('./fixtures/brightdata.json', import.meta.url), 'utf8'));
  const normalized = snapshot('brightdata', raw);
  const record = Array.isArray(raw) ? raw[0] : raw;
  assert.equal(normalized.employment_history[0].company_name, record.experience[0].company);
  assert.equal(normalized.employment_history[0].start_date, null);
  assert.equal(normalized.employment_history[0].end_date, null);
  assert.equal(normalized.employment_history[0].current_status_known, false);
  assert.equal(normalized.education[0].start_date, record.education[0].start_year);
  assert.equal(normalized.education[0].degree, null);
  assert.equal(normalized.provenance.fields.location, 'location');
});

test('stale same-provider and older known dataset facts cannot overwrite selected strings or current status', () => {
  const fresh = snapshot('coresignal', { ...core, updated_at: '2026-10-14T00:00:00Z' });
  const person = mergeSnapshotsToCanonical(null, fresh, 'fresh');
  const stale = snapshot('coresignal', { ...core, updated_at: '2026-01-01T00:00:00Z', headline: 'Stale headline',
    experience: [{ ...core.experience[0], active_experience: 0, date_to: '2025-01' }] }, { retrieved_at: '2026-10-16T00:00:00Z' });
  const merged = mergeSnapshotsToCanonical(person, stale, 'stale');
  assert.equal(merged.headline, core.headline);
  assert.equal(merged.employment_history.find(job => job.title === 'Advisor').is_current, true);
  assert.equal(merged.employment_history.find(job => job.title === 'Advisor').end_date, null);
  assert.equal(merged.profile_hash, person.profile_hash);
  assert.equal(merged.field_provenance.headline.conflicts[0].value, 'Stale headline');
});

test('failed identity never mutates canonical facts; search seed requires human review', () => {
  const person = seed();
  const wrong = snapshot('coresignal', { ...core, linkedin_url: 'linkedin.com/in/other', headline: 'Wrong person' });
  assert.equal(mergeSnapshotsToCanonical(null, wrong, 'wrong'), null);
  const flagged = mergeSnapshotsToCanonical(person, wrong, 'wrong');
  assert.equal(flagged.headline, person.headline);
  assert.equal(flagged.profile_hash, person.profile_hash);
  assert.equal(flagged.identity_confidence, 'conflict');
  assert.equal(flagged.needs_manual_review, true);
  const search = mergeSnapshotsToCanonical(null, snapshot('pdl', pdl, { input: { first: 'Synthetic' } }), 'search');
  assert.equal(search.identity_confidence, 'unverified_search_match');
  assert.equal(search.needs_manual_review, true);
  assert.equal(mergeSnapshotsToCanonical(search, snapshot(), 'verified').identity_confidence, 'verified');
});

test('name-context search cannot overwrite an existing verified person even with a higher-priority provider', () => {
  const person = mergeSnapshotsToCanonical(null, snapshot('pdl', pdl), 'verified-pdl');
  const searching = snapshot('coresignal', { ...core, full_name: 'Different Name', headline: 'Changed from search' }, { input: { first: 'Synthetic', last: 'Person' } });
  const reviewed = mergeSnapshotsToCanonical(person, searching, 'search-only');
  assert.equal(reviewed.full_name, person.full_name);
  assert.equal(reviewed.headline, person.headline);
  assert.equal(reviewed.profile_hash, person.profile_hash);
  assert.deepEqual(reviewed.field_provenance, person.field_provenance);
  assert.equal(reviewed.identity_confidence, 'verified');
  assert.equal(reviewed.needs_manual_review, true);
});

test('same source facts merge deterministically regardless of provider order and conflicts require review', () => {
  const firstCore = mergeSnapshotsToCanonical(seed(), snapshot('pdl', pdl), 'pdl-1');
  const firstPdl = mergeSnapshotsToCanonical(mergeSnapshotsToCanonical(null, snapshot('pdl', pdl), 'pdl-1'), snapshot(), 'core-1');
  assert.equal(firstCore.profile_hash, firstPdl.profile_hash);
  assert.deepEqual(firstCore.providers_contributed, firstPdl.providers_contributed);
  assert.deepEqual(firstCore.employment_history.map(job => job.sources), firstPdl.employment_history.map(job => job.sources));
  assert.deepEqual(firstCore.field_provenance, firstPdl.field_provenance);
  assert.deepEqual(firstCore.employment_history, firstPdl.employment_history);
  assert.equal(firstCore.needs_manual_review, true);
  assert.equal(firstPdl.needs_manual_review, true);
  assert.equal(firstCore.field_provenance.headline.provider, firstPdl.field_provenance.headline.provider);
  const jobsOnly = snapshot('coresignal', { ...core, experience: [{ ...core.experience[0], description: 'Changed job field' }], updated_at: '2026-10-15T00:00:00Z' });
  const prior = snapshot('coresignal', { ...core, experience: [{ ...core.experience[0], description: 'Older job description' }] });
  const withJobConflict = mergeSnapshotsToCanonical(mergeSnapshotsToCanonical(null, prior, 'prior'), jobsOnly, 'job-conflict');
  assert.equal(withJobConflict.needs_manual_review, true);
});

test('empty or omitted fields never erase selected data and omission does not end a job', () => {
  const person = seed();
  const omission = snapshot('coresignal', { ...core, headline: '', location_full: null, experience: [], education: [], updated_at: '2026-10-15T12:00:00Z' });
  const merged = mergeSnapshotsToCanonical(person, omission, 'omitted');
  assert.equal(merged.profile_hash, person.profile_hash);
  assert.equal(diffCanonicalPerson(person, merged, 'omitted', 'coresignal'), null);
  const unknown = snapshot(); unknown.employment_history = [{ ...unknown.employment_history[0], is_current: false, current_status_known: false }];
  const stillCurrent = mergeSnapshotsToCanonical(person, unknown, 'unknown');
  assert.equal(stillCurrent.employment_history.filter(job => job.is_current).length, 2);
});

test('job and education dates keep compatible month precision across fresher lower-precision reports', () => {
  const precise = snapshot('coresignal', { ...core, updated_at: '2026-10-01T00:00:00Z', experience: [{ ...core.experience[0], active_experience: 0, date_from: '2020-03', date_to: '2025-08' }] });
  precise.education = [{ school_name: 'Synthetic School', degree: 'MBA', field_of_study: null, start_date: '2001-09', end_date: '2005-05' }];
  const lessPrecise = snapshot('coresignal', { ...core, updated_at: '2026-10-14T00:00:00Z', experience: [{ ...core.experience[0], active_experience: 0, date_from: '2020', date_to: '2025' }] });
  lessPrecise.education = [{ ...precise.education[0], start_date: '2001', end_date: '2005' }];
  const person = mergeSnapshotsToCanonical(null, precise, 'precise');
  const merged = mergeSnapshotsToCanonical(person, lessPrecise, 'year-only');
  assert.equal(merged.employment_history[0].start_date, '2020-03');
  assert.equal(merged.employment_history[0].end_date, '2025-08');
  assert.equal(merged.education[0].start_date, '2001-09');
  assert.equal(merged.education[0].end_date, '2005-05');
  assert.equal(merged.profile_hash, person.profile_hash);
  const reverse = mergeSnapshotsToCanonical(mergeSnapshotsToCanonical(null, lessPrecise, 'year-only'), precise, 'precise');
  assert.equal(reverse.employment_history[0].start_date, '2020-03');
  assert.equal(reverse.employment_history[0].end_date, '2025-08');
  assert.equal(reverse.education[0].start_date, '2001-09');
  assert.equal(reverse.education[0].end_date, '2005-05');
});

test('reactivating a role retains its previous end-date claims and source provenance', () => {
  const ended = snapshot('coresignal', { ...core, updated_at: '2026-10-01T00:00:00Z', experience: [{ ...core.experience[0], active_experience: 0, date_to: '2024-08' }] });
  const correctedEnd = snapshot('coresignal', { ...core, updated_at: '2026-10-02T00:00:00Z', experience: [{ ...core.experience[0], active_experience: 0, date_to: '2025-08' }] });
  const active = snapshot('coresignal', { ...core, updated_at: '2026-10-03T00:00:00Z', experience: [{ ...core.experience[0], active_experience: 1, date_to: null }] });
  const before = mergeSnapshotsToCanonical(mergeSnapshotsToCanonical(null, ended, 'ended'), correctedEnd, 'corrected-end');
  const after = mergeSnapshotsToCanonical(before, active, 'reactivated');
  const role = after.employment_history[0];
  assert.equal(role.is_current, true);
  assert.equal(role.end_date, null);
  assert.equal(role.field_provenance.end_date.enrichment_id, 'reactivated');
  assert.ok(role.field_provenance.end_date.conflicts.some(claim => claim.value === '2024-08' && claim.enrichment_id === 'ended'));
  assert.ok(role.field_provenance.end_date.conflicts.some(claim => claim.value === '2025-08' && claim.enrichment_id === 'corrected-end'));
  assert.notEqual(after.profile_hash, before.profile_hash);
});

test('hash ignores provenance and source order, canonical JSON recursively orders keys', () => {
  const person = seed();
  const shuffled = { ...person, retrieved_at: '2099-01-01T00:00:00Z', field_provenance: {}, providers_contributed: ['other'], employment_history: [...person.employment_history].reverse().map(job => ({ ...job, sources: ['other'], field_provenance: {} })), education: [...person.education].reverse() };
  assert.equal(computeProfileHash(person), computeProfileHash(shuffled));
  assert.equal(canonicalJsonStringify({ z: { y: 2, x: 1 }, a: [2, 1] }), '{"a":[2,1],"z":{"x":1,"y":2}}');
  assert.equal(employmentKey({ company_name: 'ACME, Inc.', title: 'Board-Member', start_date: '2020-01' }), 'acme|board member|2020');
});

test('weekly diff classifies explicit role ending, added role, title, company, location and education updates', () => {
  const person = seed(); person.id = 'person-1';
  const changed = snapshot('coresignal', { ...core, location_full: 'Dallas, Texas', headline: 'New headline', updated_at: '2026-10-15T13:00:00Z',
    experience: [{ ...core.experience[0], active_experience: 0, date_to: '2026-10' }, { company_name: 'New Advisors', position_title: 'Director', active_experience: 1, date_from: '2026-10' }],
    education: [...core.education, { institution_name: 'New School', degree: 'MBA', date_from_year: 2026 }] });
  const merged = mergeSnapshotsToCanonical(person, changed, 'updated');
  const diff = diffCanonicalPerson(person, merged, 'updated', 'coresignal');
  for (const type of ['job_added', 'job_ended', 'title_changed', 'company_changed', 'location_changed', 'headline_changed', 'education_changed']) assert.ok(diff.change_types.includes(type), type);
  assert.equal(diff.person_id, person.id);
  assert.equal(diff.trigger_enrichment_id, 'updated');
  assert.match(diff.advisor_summary, /review the source claims/);
  assert.equal(merged.employment_history.some(job => job.company_name === 'Example Foundation' && job.is_current), true);
  assert.equal(diffCanonicalPerson(null, merged, 'seed', 'coresignal'), null);
});
