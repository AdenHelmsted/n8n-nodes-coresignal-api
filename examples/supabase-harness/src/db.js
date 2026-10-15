import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { supabaseConfig } from '../harness.mjs';
import { canonicalJsonStringify } from './normalize.js';
import { mergeSnapshotsToCanonical } from './merge.js';
import { diffCanonicalPerson } from './diff.js';

export function createDb(env = process.env, fetchImpl = fetch) {
  const { url, key } = supabaseConfig(env);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchImpl } });
}
function checked(result, operation) {
  if (result.error) throw Object.assign(new Error(`${operation} failed (${result.error.code || 'request error'}); replay the cached response.`), { code: result.error.code });
  return result.data;
}
export function snapshotRow(snapshot) {
  const s = snapshot, resolved = `resolve:${createHash('sha256').update(canonicalJsonStringify(s.input || {})).digest('hex')}`;
  return { id: s.id, provider: s.provider_name, provider_name: s.provider_name,
    requested_linkedin_url: s.requested_linkedin_url || resolved, name: s.full_name,
    linkedin_url: s.returned_linkedin_url, headline: s.headline, location: s.location,
    employment_history: s.employment_history, education: s.education, profile_picture_ref: s.avatar_source_url,
    retrieved_at: s.retrieved_at, provider_record_id: s.provider_record_id, source_updated_at: s.source_updated_at,
    match_status: s.http_status !== 200 ? 'unavailable' : ({ matched: 'matched_url', mismatch: 'mismatch' }[s.identity_status] || 'unverified'),
    http_status: s.http_status, request_count: s.request_count ?? 0, estimated_credits: s.estimated_credits ?? null,
    credits_remaining: s.credits_remaining ?? null, raw_response: s.raw_payload,
    provenance: { ...s.provenance, identity_status: s.identity_status, input: s.input, cache_path: s.local_cache_path,
      request_kind: s.request_kind || 'collection', parent_collection_id: s.parent_collection_id ?? null,
      parent_cache_path: s.parent_cache_path ?? null, collection_request_count: s.collection_request_count ?? s.request_count ?? 0 } };
}
export async function persistAvatarIfPresent(db, snapshot, person, fetchImpl = fetch) {
  if (!snapshot.avatar_source_url || snapshot.identity_status !== 'matched') return {};
  try {
    const url = new URL(snapshot.avatar_source_url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !/(^|\.)licdn\.com$/i.test(url.hostname)) throw new Error('Untrusted avatar host');
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    const contentType = response.headers.get('content-type')?.split(';')[0];
    if (response.status !== 200 || !/^image\/(jpeg|png|webp|gif|avif)$/.test(contentType || '')) throw new Error('Invalid avatar response');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 5_242_880) throw new Error('Avatar too large'); chunks.push(chunk); }
    if (size < 500) throw new Error('Avatar too small');
    const bytes = Buffer.concat(chunks), sha = createHash('sha256').update(bytes).digest('hex');
    if (person.avatar_sha256 === sha) return {};
    await mkdir('.cache/avatars', { recursive: true, mode: 0o700 });
    await writeFile(`.cache/avatars/${sha}`, bytes, { mode: 0o600 });
    const path = `${person.id}/${sha}.jpg`;
    checked(await db.storage.from('person-avatars').upload(path, bytes, { contentType, upsert: true }), 'Avatar upload');
    return { avatar_storage_path: `person-avatars/${path}`, avatar_sha256: sha };
  } catch { console.warn('Avatar unavailable; profile processing continues.'); return {}; }
}
export async function storeSnapshot(db, snapshot, { replay = false, fetchImpl = fetch } = {}) {
  checked(await db.from('person_enrichments').upsert(snapshotRow(snapshot), { onConflict: 'id', ignoreDuplicates: true }), 'Snapshot insert');
  const saved = checked(await db.from('person_enrichments').select('canonical_applied_at,person_id').eq('id', snapshot.id).single(), 'Replay check');
  if (saved.canonical_applied_at) return { person_id: saved.person_id, replayed: true };
  const lookup = snapshot.requested_linkedin_url || snapshot.returned_linkedin_url;
  if (!lookup) return { snapshot_only: true };
  for (let attempt = 0; attempt < 3; attempt++) {
    const old = checked(await db.from('people').select('*').eq('canonical_linkedin_url', lookup).maybeSingle(), 'Canonical read');
    const person = mergeSnapshotsToCanonical(old, snapshot, snapshot.id);
    if (!person) return { snapshot_only: true };
    person.id ||= randomUUID();
    person._expected_updated_at = old?.updated_at ?? null;
    if (old?.profile_hash === person.profile_hash) person.last_enriched_at = old.last_enriched_at;
    if (!replay) {
      const avatar = await persistAvatarIfPresent(db, snapshot, person, fetchImpl);
      Object.assign(person, avatar);
      if (avatar.avatar_sha256) person.field_provenance.avatar_storage_path = { provider: snapshot.provider_name,
        enrichment_id: snapshot.id, retrieved_at: snapshot.retrieved_at, source_url: snapshot.avatar_source_url, sha256: avatar.avatar_sha256 };
    }
    const change = diffCanonicalPerson(old, person, snapshot.id, snapshot.provider_name);
    const result = await db.rpc('apply_person_enrichment', { p_person: person, p_change: change, p_enrichment_id: snapshot.id, p_expected_hash: old?.profile_hash ?? null });
    if (result.error?.code === '40001' && attempt < 2) continue;
    return { ...checked(result, 'Canonical transaction'), changed: Boolean(change) };
  }
}
export async function preflightDb(db) {
  checked(await db.from('people').select('id').limit(0), 'Migration 002 preflight');
  checked(await db.from('person_enrichments').select('person_id,provider_name,canonical_applied_at').limit(0), 'Snapshot migration preflight');
  checked(await db.from('person_changes').select('id').limit(0), 'Change ledger preflight');
  const probe = await db.rpc('apply_person_enrichment', { p_person: {}, p_change: null, p_enrichment_id: randomUUID(), p_expected_hash: null });
  if (probe.error?.code !== '23503') throw new Error('Migration 002 RPC preflight failed; apply the complete SQL migration before collecting.');
}
