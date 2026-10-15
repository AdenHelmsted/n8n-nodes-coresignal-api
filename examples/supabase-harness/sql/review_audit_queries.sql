-- Repeatable read-only hosted audit queries; source SQL is not observed output.
-- Executed through the authenticated SQL Editor on 2026-10-15; see the audit report.
-- Run after the review-view migration. Inspect the returned schema before relying
-- on any result. These queries do not collect provider data or download photos.
begin read only;

select current_database() as database_name, current_user as database_role,
  current_setting('server_version') as postgres_version;

select table_schema, table_name, column_name, data_type
from information_schema.columns
where (table_schema = 'public' and table_name in (
  'people', 'person_enrichments', 'person_changes', 'v_review_queue', 'v_person_claim_disagreements'))
  or (table_schema = 'storage' and table_name in ('buckets', 'objects'))
order by table_schema, table_name, ordinal_position;

select (select count(*) from public.people) as people,
  (select count(*) from public.person_enrichments) as snapshots,
  (select count(*) from public.person_changes) as changes;

select p.id, p.full_name, p.canonical_linkedin_url, p.identity_confidence,
  p.needs_manual_review, jsonb_array_length(p.employment_history) as employment_entries,
  (select count(*) from jsonb_array_elements(p.employment_history) j where j->>'is_current' = 'true') as current_roles,
  jsonb_array_length(p.education) as education_entries,
  p.profile_hash, p.field_provenance, p.employment_history, p.education,
  p.avatar_storage_path, p.avatar_sha256, p.updated_at
from public.people p where p.canonical_linkedin_url = 'https://www.linkedin.com/in/chris-maresca';

select e.id, e.provider, e.provider_name, e.http_status, e.person_id,
  e.retrieved_at, e.canonical_applied_at, e.review_status, e.review_notes,
  e.request_count, e.estimated_credits as historical_estimate_not_measured_spend,
  e.credits_remaining, e.provenance->'billing_headers' as billing_headers
from public.person_enrichments e join public.people p on p.id = e.person_id
where p.canonical_linkedin_url = 'https://www.linkedin.com/in/chris-maresca'
order by e.retrieved_at, e.id;

select c.id, c.person_id, c.trigger_enrichment_id, c.provider_name,
  c.previous_hash, c.new_hash, c.change_types, c.changed_fields, c.advisor_summary, c.detected_at
from public.person_changes c join public.people p on p.id = c.person_id
where p.canonical_linkedin_url = 'https://www.linkedin.com/in/chris-maresca'
order by c.detected_at, c.id;

select id, name, public from storage.buckets where id = 'person-avatars';
-- Inspect the object's actual catalog row; listing does not verify current bytes.
select p.id as person_id, p.avatar_storage_path,
  to_jsonb(o) is not null as matching_object_exists,
  to_jsonb(o)->>'name' as object_name, to_jsonb(o)->'metadata' as object_metadata
from public.people p left join storage.objects o
  on to_jsonb(o)->>'bucket_id' = 'person-avatars'
  and 'person-avatars/' || (to_jsonb(o)->>'name') = p.avatar_storage_path
where p.canonical_linkedin_url = 'https://www.linkedin.com/in/chris-maresca';

select * from public.v_review_queue
where linkedin_url = 'https://www.linkedin.com/in/chris-maresca';
select d.* from public.v_person_claim_disagreements d join public.people p on p.id = d.person_id
where p.canonical_linkedin_url = 'https://www.linkedin.com/in/chris-maresca'
order by d.claim_type;

select c.relname, c.reloptions, v.is_updatable,
  has_table_privilege('service_role', c.oid, 'SELECT') as service_select,
  has_table_privilege('service_role', c.oid, 'INSERT,UPDATE,DELETE') as service_write,
  has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select
from pg_class c join information_schema.views v
  on v.table_schema = 'public' and v.table_name = c.relname
where c.oid in ('public.v_review_queue'::regclass, 'public.v_person_claim_disagreements'::regclass);

commit;
