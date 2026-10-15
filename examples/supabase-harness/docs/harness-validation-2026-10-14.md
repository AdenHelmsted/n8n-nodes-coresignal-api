# Harness validation — October 14, 2026

## Live Coresignal test

- User approved `https://www.linkedin.com/in/chris-maresca/` for one lookup.
- Exactly one provider GET, using the Employee Multi-source core bundle.
- HTTP 200; returned name Chris Maresca; normalized returned LinkedIn URL matches the approved URL.
- Seven employment entries and one education entry retained. Name, headline, location and picture reference are present.
- Response reported `x-credits-remaining: 1990`. Documented/estimated cost is 10 credits; no before-request balance was measured, so actual credit delta is not asserted.
- Live response uses `linkedin_url`; harness now supports that field and the documented `professional_network_url` variant. The saved response was reprocessed locally after fixing the mapping, without another provider call.
- Local evidence: `runs/bc2884c8-37af-4e97-8998-8c7cb1bcfa8c.json`. It is Git-ignored and was not published to GitHub.
- Identity URL agreement is established. Employment/education accuracy and freshness have not been manually verified.

## Code and database checks

- Eight Node tests pass: URL validation, one-call construction, input/key failure before a lookup, API/network errors without retries, identity mismatches, live response field variant, Supabase duplicate-safe import, and database-error handling.
- Offline fictional demo records zero provider requests and zero credits.
- Schema validated using PGlite's PostgreSQL engine in a temporary directory, with no production dependency changes. Seven checks pass: repeatable schema execution; RLS; client-role CRUD rejection; service-role CRUD; full JSON/provenance round trip; duplicate replay preserving reviews; separate snapshots preserving conflicts.
- The user ran `schema.sql`; the live Supabase Data API confirms the table exists (HTTP 200).
- Imported the saved Chris Maresca run into `public.person_enrichments` without another Coresignal request. Live read-back verified all seven person fields, complete employment/education arrays, raw response, provenance, provider identifiers, retrieval/source timestamps and usage metadata against the saved run. The review remains `pending`; factual accuracy has not been manually verified.

## GitHub

Both upstream repositories were forked into AdenHelmsted's account. The standalone harness is published at:

<https://github.com/AdenHelmsted/n8n-nodes-coresignal-api/tree/people-enrichment-harness/examples/supabase-harness>

Commit: `cdb05ccfa44429a65386035dde5b66949132466a`. Only code, setup instructions, MIT notices and fictional fixtures were published; no keys or real profile responses.
