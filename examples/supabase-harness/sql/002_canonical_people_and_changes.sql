-- Apply schema.sql first. This additive migration keeps every existing snapshot and review.
begin;

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  canonical_linkedin_url text unique not null,
  linkedin_slug text unique not null,
  full_name text,
  first_name text,
  last_name text,
  headline text,
  location text,
  current_title text,
  current_company text,
  avatar_storage_path text,
  avatar_sha256 text,
  employment_history jsonb not null default '[]'::jsonb,
  education jsonb not null default '[]'::jsonb,
  field_provenance jsonb not null default '{}'::jsonb,
  providers_contributed text[] not null default '{}', -- coresignal, brightdata, pdl
  profile_hash text not null,
  identity_confidence text not null default 'verified'
    check (identity_confidence in ('verified', 'conflict', 'unverified_search_match')),
  needs_manual_review boolean not null default false,
  last_enriched_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_people_last_checked_at on public.people (last_checked_at);
create index if not exists idx_people_needs_review on public.people (needs_manual_review)
  where needs_manual_review = true;

alter table public.person_enrichments
  add column if not exists person_id uuid references public.people(id) on delete set null,
  add column if not exists provider_name text not null default 'coresignal',
  add column if not exists canonical_applied_at timestamptz;
update public.person_enrichments set provider_name = provider where provider_name is distinct from provider;
create index if not exists idx_person_enrichments_person_id on public.person_enrichments (person_id);

create table if not exists public.person_changes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  trigger_enrichment_id uuid references public.person_enrichments(id) on delete set null,
  provider_name text not null,
  previous_hash text not null,
  new_hash text not null,
  change_types text[] not null default '{}',
  changed_fields jsonb not null default '{}'::jsonb,
  advisor_summary text not null,
  detected_at timestamptz not null default now()
);
create index if not exists idx_person_changes_person_id on public.person_changes (person_id, detected_at desc);
create unique index if not exists idx_person_changes_trigger_once
  on public.person_changes (trigger_enrichment_id) where trigger_enrichment_id is not null;

alter table public.people enable row level security;
alter table public.person_changes enable row level security;
revoke all on public.people, public.person_changes from anon, authenticated;
grant select, insert, update, delete on public.people, public.person_changes to service_role;

insert into storage.buckets (id, name, public) values ('person-avatars', 'person-avatars', false)
  on conflict (id) do update set public = false;

-- Snapshot insertion remains an SDK upsert (ignore duplicates). This RPC commits its
-- canonical merge, optional change event and snapshot link together. A stale caller
-- gets 40001 and must re-read/re-merge; no provider request needs repeating.
-- p_person._expected_updated_at also protects same-hash provenance/metadata updates.
create or replace function public.apply_person_enrichment(
  p_person jsonb, p_change jsonb, p_enrichment_id uuid, p_expected_hash text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_snapshot public.person_enrichments;
  v_old public.people;
  v_new public.people;
  v_exists boolean;
  v_inserted uuid;
begin
  select * into v_snapshot from public.person_enrichments where id = p_enrichment_id for update;
  if not found then raise exception 'Snapshot % does not exist', p_enrichment_id using errcode = '23503'; end if;
  if v_snapshot.canonical_applied_at is not null then
    return jsonb_build_object('person_id', v_snapshot.person_id, 'applied', false, 'replayed', true);
  end if;
  if p_person->>'canonical_linkedin_url' is null then
    raise exception 'Canonical LinkedIn URL is required' using errcode = '22023';
  end if;
  select * into v_old from public.people
    where canonical_linkedin_url = p_person->>'canonical_linkedin_url' for update;
  v_exists := found;
  if (v_exists and v_old.profile_hash is distinct from p_expected_hash)
    or (not v_exists and p_expected_hash is not null) then
    raise exception 'Canonical person changed; re-read and merge the saved snapshot' using errcode = '40001';
  end if;
  if p_person ? '_expected_updated_at' and (
    (v_exists and v_old.updated_at is distinct from (p_person->>'_expected_updated_at')::timestamptz)
    or (not v_exists and p_person->>'_expected_updated_at' is not null)
  ) then
    raise exception 'Canonical metadata changed; re-read and merge the saved snapshot' using errcode = '40001';
  end if;

  v_new := jsonb_populate_record(v_old, p_person);
  v_new.id := coalesce(v_old.id, v_new.id, gen_random_uuid());
  v_new.employment_history := coalesce(v_new.employment_history, '[]'::jsonb);
  v_new.education := coalesce(v_new.education, '[]'::jsonb);
  v_new.field_provenance := coalesce(v_new.field_provenance, '{}'::jsonb);
  v_new.providers_contributed := coalesce(v_new.providers_contributed, '{}'::text[]);
  v_new.identity_confidence := coalesce(v_new.identity_confidence, 'verified');
  v_new.needs_manual_review := coalesce(v_new.needs_manual_review, false);
  v_new.last_enriched_at := coalesce(v_new.last_enriched_at, now());
  v_new.last_checked_at := coalesce(v_new.last_checked_at, now());
  v_new.created_at := coalesce(v_old.created_at, now());
  v_new.updated_at := clock_timestamp();

  if v_exists then
    update public.people set
      full_name = v_new.full_name, first_name = v_new.first_name, last_name = v_new.last_name,
      headline = v_new.headline, location = v_new.location,
      current_title = v_new.current_title, current_company = v_new.current_company,
      avatar_storage_path = v_new.avatar_storage_path, avatar_sha256 = v_new.avatar_sha256,
      employment_history = v_new.employment_history, education = v_new.education,
      field_provenance = v_new.field_provenance, providers_contributed = v_new.providers_contributed,
      profile_hash = v_new.profile_hash, identity_confidence = v_new.identity_confidence,
      needs_manual_review = v_new.needs_manual_review, last_enriched_at = v_new.last_enriched_at,
      last_checked_at = v_new.last_checked_at, updated_at = v_new.updated_at
      where id = v_old.id;
  else
    insert into public.people select (v_new).* on conflict (canonical_linkedin_url) do nothing returning id into v_inserted;
    if v_inserted is null then
      raise exception 'Canonical person was seeded concurrently; re-read and merge the saved snapshot' using errcode = '40001';
    end if;
  end if;

  if v_exists and v_old.profile_hash is distinct from v_new.profile_hash then
    if p_change is null or p_change->>'previous_hash' is distinct from v_old.profile_hash
      or p_change->>'new_hash' is distinct from v_new.profile_hash then
      raise exception 'A matching change event is required when the profile hash changes' using errcode = '22023';
    end if;
    insert into public.person_changes (
      person_id, trigger_enrichment_id, provider_name, previous_hash, new_hash,
      change_types, changed_fields, advisor_summary
    ) values (
      v_new.id, p_enrichment_id, v_snapshot.provider_name, v_old.profile_hash, v_new.profile_hash,
      array(select jsonb_array_elements_text(coalesce(p_change->'change_types', '[]'::jsonb))),
      coalesce(p_change->'changed_fields', '{}'::jsonb), p_change->>'advisor_summary'
    );
  end if;
  update public.person_enrichments set person_id = v_new.id, canonical_applied_at = now() where id = p_enrichment_id;
  return jsonb_build_object('person_id', v_new.id, 'applied', true, 'replayed', false);
end;
$$;
revoke all on function public.apply_person_enrichment(jsonb, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.apply_person_enrichment(jsonb, jsonb, uuid, text) to service_role;

commit;
