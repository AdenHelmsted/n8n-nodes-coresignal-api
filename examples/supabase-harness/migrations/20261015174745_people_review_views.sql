-- Apply after schema.sql and sql/002_canonical_people_and_changes.sql.
-- Review surfaces only: no provider requests, data updates, or inferred claims.
begin;

create or replace view public.v_person_claim_disagreements with (security_invoker = true) as
with field_claims as (
  select p.id as person_id, p.full_name, 'scalar.' || f.key as claim_type,
    to_jsonb(p)->f.key as selected_value, f.value as origin, null::jsonb as entry_context
  from public.people p
  cross join lateral jsonb_each(case when jsonb_typeof(p.field_provenance) = 'object'
    then p.field_provenance else '{}'::jsonb end) f
  union all
  select p.id, p.full_name, 'employment[' || e.ordinality || '].' || f.key,
    e.value->f.key, f.value, e.value - 'field_provenance'
  from public.people p
  cross join lateral jsonb_array_elements(p.employment_history) with ordinality e
  cross join lateral jsonb_each(case when jsonb_typeof(e.value->'field_provenance') = 'object'
    then e.value->'field_provenance' else '{}'::jsonb end) f
  union all
  select p.id, p.full_name, 'education[' || e.ordinality || '].' || f.key,
    e.value->f.key, f.value, e.value - 'field_provenance'
  from public.people p
  cross join lateral jsonb_array_elements(p.education) with ordinality e
  cross join lateral jsonb_each(case when jsonb_typeof(e.value->'field_provenance') = 'object'
    then e.value->'field_provenance' else '{}'::jsonb end) f
)
select person_id, full_name, claim_type, selected_value #>> '{}' as displayed_value,
  origin->>'provider' as selected_provider,
  jsonb_build_object(
    'selected', (origin - 'conflicts') || jsonb_build_object('value', selected_value),
    'conflicts', origin->'conflicts',
    'entry_context', entry_context
  ) as all_provider_claims,
  true as needs_review
from field_claims
where jsonb_array_length(case when jsonb_typeof(origin->'conflicts') = 'array'
  then origin->'conflicts' else '[]'::jsonb end) > 0;

create or replace view public.v_review_queue with (security_invoker = true) as
select p.id, p.full_name, p.canonical_linkedin_url as linkedin_url,
  p.identity_confidence, p.needs_manual_review,
  -- Summary of actual snapshot reviews; identifier agreement is not fact verification.
  -- Precedence: wrong > uncertain > pending > correct. No linked reviews yields NULL.
  r.review_status, r.review_statuses,
  jsonb_array_length(p.employment_history) as employment_claim_count,
  jsonb_array_length(p.education) as education_claim_count,
  c.conflicting_field_count, r.review_notes, p.updated_at
from public.people p
left join lateral (
  select case
    when bool_or(e.review_status = 'wrong') then 'wrong'
    when bool_or(e.review_status = 'uncertain') then 'uncertain'
    when bool_or(e.review_status = 'pending') then 'pending'
    when bool_and(e.review_status = 'correct') then 'correct'
  end as review_status,
  array_agg(distinct e.review_status order by e.review_status) as review_statuses,
  jsonb_agg(jsonb_build_object(
    'enrichment_id', e.id, 'provider', e.provider_name, 'review_status', e.review_status,
    'reviewed_at', e.reviewed_at, 'notes', e.review_notes
  ) order by e.retrieved_at, e.id) filter (where nullif(btrim(e.review_notes), '') is not null) as review_notes
  from public.person_enrichments e where e.person_id = p.id
) r on true
left join lateral (
  select count(*) as conflicting_field_count from public.v_person_claim_disagreements d where d.person_id = p.id
) c on true;

-- Invoker security preserves base-table permissions/RLS. UNION and joins also make
-- these views structurally non-updatable, including for privileged SQL reviewers.
revoke all on public.v_review_queue, public.v_person_claim_disagreements from public, anon, authenticated, service_role;
grant select on public.v_review_queue, public.v_person_claim_disagreements to service_role;

comment on view public.v_review_queue is 'Read-only person review queue; review_status summarizes actual linked snapshot reviews, not factual verification.';
comment on view public.v_person_claim_disagreements is 'Read-only fields with recorded conflicts only; selected values/origins and competing claims are preserved without inferring missing provider facts.';

commit;
