import { createHash } from 'node:crypto';

const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
function linkedin(input, kind) {
  if (!text(input)) throw new Error('LinkedIn URL is required.');
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input.trim() : `https://${input.trim()}`);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port
      || !/^(?:www\.|[a-z]{2,3}\.)?linkedin\.com$/i.test(url.hostname)) throw new Error('Invalid LinkedIn host.');
  const match = new RegExp(`^/${kind}/([^/]+)/?$`).exec(url.pathname);
  const slug = match && decodeURIComponent(match[1]).normalize('NFC').toLowerCase();
  if (!slug || !/^[\p{L}\p{N}_-]+$/u.test(slug)) throw new Error(`Invalid LinkedIn ${kind} URL.`);
  return `https://www.linkedin.com/${kind}/${encodeURIComponent(slug)}`;
}
export const normalizeLinkedinUrl = input => linkedin(input, 'in');
export const normalizeCompanyLinkedinUrl = input => linkedin(input, 'company');
const safeUrl = (value, company = false) => { try { return company ? normalizeCompanyLinkedinUrl(value) : normalizeLinkedinUrl(value); } catch { return null; } };
const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
const months = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
function date(value, year, month) {
  const validYear = year && /^\d{4}$/.test(String(year)) ? String(year) : null;
  if (validYear && Number.isInteger(Number(month)) && month >= 1 && month <= 12) return `${validYear}-${String(Number(month)).padStart(2, '0')}`;
  const valueText = text(value), iso = /^(\d{4})(?:-(0[1-9]|1[0-2]))?(?:-\d{2})?$/.exec(valueText || '');
  if (iso) return `${iso[1]}${iso[2] ? `-${iso[2]}` : ''}`;
  const named = /^([a-z]+)\s+(\d{4})$/i.exec(valueText || ''), index = named && months.indexOf(named[1].slice(0, 3).toLowerCase());
  return named && index >= 0 ? `${named[2]}-${String(index + 1).padStart(2, '0')}` : validYear;
}
export const normStr = value => (text(value) || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\b(inc|llc|corp)\b/g, '').replace(/\s+/g, ' ').trim();
export const employmentKey = job => `${normStr(job.company_name)}|${normStr(job.title)}|${(job.start_date || '').slice(0, 4)}`;
export function canonicalJsonStringify(value) {
  const sort = item => Array.isArray(item) ? item.map(sort) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, sort(item[key])])) : item;
  return JSON.stringify(sort(value));
}
const jobFields = ['title', 'company_name', 'company_linkedin_url', 'start_date', 'end_date', 'is_current', 'location', 'description'];
const eduFields = ['school_name', 'degree', 'field_of_study', 'start_date', 'end_date'];
export function computeProfileHash(person) {
  const strip = (entries, fields) => list(entries).map(entry => Object.fromEntries(fields.map(key => [key, entry[key] ?? null])))
    .sort((a, b) => canonicalJsonStringify(a).localeCompare(canonicalJsonStringify(b), 'en'));
  const payload = { full_name: person.full_name ?? null, headline: person.headline ?? null, location: person.location ?? null,
    employment_history: strip(person.employment_history, jobFields), education: strip(person.education, eduFields) };
  return createHash('sha256').update(canonicalJsonStringify(payload)).digest('hex');
}
export function normalizeSnapshot(provider, envelope) {
  if (!['coresignal', 'pdl', 'brightdata'].includes(provider)) throw new Error(`Unsupported provider: ${provider}`);
  const raw = envelope.raw_payload, body = Array.isArray(raw) ? raw[0] : raw;
  const p = envelope.http_status === 200 && body && typeof body === 'object' ? (provider === 'pdl' ? body.data || body : body) : {};
  const core = provider === 'coresignal', pdl = provider === 'pdl';
  const lowConfidence = pdl && body?.likelihood !== undefined && (!Number.isFinite(body.likelihood) || body.likelihood < 6);
  const requested = safeUrl(envelope.input?.url), returned = safeUrl(core ? p.linkedin_url || p.professional_network_url : pdl ? p.linkedin_url : p.url);
  const jobs = list(p.experience).map(job => {
    const end = date(pdl ? job.end_date : core ? job.date_to : null, core && job.date_to_year, core && job.date_to_month);
    const current = core ? job.active_experience === 1 || job.active_experience === true : pdl && !job.end_date;
    return { title: text(core ? job.position_title : pdl ? job.title?.name : job.title), company_name: text(core ? job.company_name : pdl ? job.company?.name : job.company),
      company_linkedin_url: safeUrl(pdl ? job.company?.linkedin_url : core ? job.company_linkedin_url : null, true),
      start_date: date(pdl ? job.start_date : core ? job.date_from : null, core && job.date_from_year, core && job.date_from_month),
      end_date: end, is_current: !end && current, current_status_known: Boolean(end || (core ? 'active_experience' in job : pdl && 'end_date' in job)),
      location: text(pdl ? job.location_names?.[0] : core ? job.location : null), description: text(pdl ? job.summary : core ? job.description : text(job.description_html)?.replace(/<[^>]*>/g, ' ')) };
  });
  const education = list(p.education).map(edu => ({ school_name: text(core ? edu.institution_name : pdl ? edu.school?.name : edu.title),
    degree: text(pdl ? edu.degrees?.[0] : core ? edu.degree : null), field_of_study: text(pdl ? edu.majors?.[0] : core ? edu.field_of_study : null),
    start_date: date(pdl ? edu.start_date : edu.start_year, core && edu.date_from_year), end_date: date(pdl ? edu.end_date : edu.end_year, core && edu.date_to_year) }));
  const fields = core ? { full_name: 'full_name', first_name: 'first_name', last_name: 'last_name', headline: 'headline', location: 'location_full', employment_history: 'experience', education: 'education', avatar_source_url: 'picture_url' }
    : pdl ? { full_name: 'full_name', first_name: 'first_name', last_name: 'last_name', headline: p.headline ? 'headline' : 'derived:job_title+job_company_name', location: 'location_name', employment_history: 'experience', education: 'education' }
      : { full_name: 'name', first_name: 'first_name', last_name: 'last_name', headline: 'position', location: p.location ? 'location' : 'city', employment_history: 'experience', education: 'education', avatar_source_url: 'avatar' };
  fields.returned_linkedin_url = core ? (p.linkedin_url ? 'linkedin_url' : 'professional_network_url') : pdl ? 'linkedin_url' : 'url';
  return { ...envelope, provider_name: provider, provider_record_id: p.id == null ? null : String(p.id), requested_linkedin_url: requested, returned_linkedin_url: returned,
    identity_status: lowConfidence || p.is_deleted === 1 || p.is_deleted === true || !returned ? 'missing_url' : !requested ? 'search_match' : requested === returned ? 'matched' : 'mismatch',
    full_name: text(core || pdl ? p.full_name : p.name), first_name: text(p.first_name), last_name: text(p.last_name),
    headline: text(core ? p.headline : pdl ? p.headline || (p.job_title && p.job_company_name ? `${p.job_title} at ${p.job_company_name}` : p.job_title) : p.position),
    location: text(core ? p.location_full : pdl ? p.location_name : p.location || p.city), avatar_source_url: text(core ? p.picture_url : pdl ? null : p.avatar),
    employment_history: jobs, education, source_updated_at: text(core ? p.updated_at : null),
    provenance: { endpoint: envelope.endpoint ?? null, fields }, raw_payload: raw };
}
