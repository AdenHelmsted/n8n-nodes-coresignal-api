-- Run once in the Supabase SQL editor. Internal pilot: server credentials only.
create table if not exists public.person_enrichments (
  id uuid primary key,
  provider text not null,
  requested_linkedin_url text not null,
  name text,
  linkedin_url text,
  headline text,
  location text,
  employment_history jsonb,
  education jsonb,
  profile_picture_ref text,
  retrieved_at timestamptz not null,
  provider_record_id text,
  source_updated_at text,
  match_status text not null check (match_status in ('matched_url', 'mismatch', 'unverified', 'unavailable')),
  http_status integer,
  request_count integer not null,
  estimated_credits integer,
  credits_remaining bigint,
  provenance jsonb not null,
  raw_response jsonb,
  review_status text not null default 'pending' check (review_status in ('pending', 'correct', 'wrong', 'uncertain')),
  review_notes text,
  reviewed_at timestamptz
);

create index if not exists person_enrichments_lookup
  on public.person_enrichments (requested_linkedin_url, retrieved_at desc);

alter table public.person_enrichments enable row level security;
revoke all on public.person_enrichments from anon, authenticated;
grant select, insert, update, delete on public.person_enrichments to service_role;

-- Every lookup is a separate row. Comparing rows preserves conflicting facts.
-- matched_url only means identifier agreement, not manually verified accuracy.
-- Mark reviews in the Table Editor; use notes for stale/missing fields and conflicts.
