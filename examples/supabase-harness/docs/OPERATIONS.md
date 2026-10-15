# People-enrichment operations

This internal evaluation CLI collects evidence for approved profiles and builds a canonical Supabase record for comparison. The intended application boundary is an internal database and internal avatar storage; production application and tenant integration are outside this repository. The enrichment process itself contacts external providers and, for eligible live imports, LinkedIn's image CDN.

## Install and prepare the database

Use a current Node.js 22 release or later. `npm install` installs the only direct runtime dependency, `@supabase/supabase-js`. Requests, files, normalization, hashing, argument parsing, and tests use native Node modules. Runtime source stays under the requested 750-line ceiling, excluding tests, SQL migrations, and documentation.

Configure these preferred names in `.env`:

| Variable | Purpose |
| --- | --- |
| `CORESIGNAL_API_KEY` | Coresignal Employee Multi-source core lookup. |
| `PDL_API_KEY` | PDL v5 Person Enrichment. |
| `BRIGHTDATA_API_KEY` | Bright Data LinkedIn Profiles collection and snapshot download. |
| `SUPABASE_URL` | The intended Supabase project's HTTPS URL. |
| `SUPABASE_SECRET_KEY` | Server-side Supabase secret. |

`SUPABASE_SERVICE_ROLE_KEY` remains a supported legacy alias. PDL also accepts `PEOPLEDATALABS_API_KEY`; Bright Data accepts `BRIGHT_DATA_API_KEY`, `BRIGHT_DATA_TOKEN`, or `BRIGHTDATA_API_TOKEN`. Prefer `.env.example` names. Missing keys skip that provider; they do not trigger a fallback or fixture mode automatically.

In Supabase's SQL Editor, apply the complete files in this order:

1. [`../schema.sql`](../schema.sql): existing `person_enrichments` table and permissions.
2. [`../sql/002_canonical_people_and_changes.sql`](../sql/002_canonical_people_and_changes.sql): canonical tables, additive snapshot columns, indexes, private avatar bucket, and `apply_person_enrichment` RPC.
3. Optional: [`../migrations/20261015174745_people_review_views.sql`](../migrations/20261015174745_people_review_views.sql), adding service-role-only, read-only review views after migration 002. Hosted application through the plugin is pending; see [audit status](audit-and-review-views-2026-10-15.md).

Migration 002 expects UUID snapshot IDs and preserves baseline columns and manual reviews. It is repeatable and sets the avatar bucket private even if that bucket already exists. Snapshot import uses the official SDK; the RPC atomically applies the canonical record, any required change event, and the snapshot link.

Earlier SDK validation recorded migration 002 applied and hosted preflight passing. The current mission requires fresh audit/application/query checks through the Supabase plugin; those remain pending authenticated plugin SQL tools. Fresh projects still need the base SQL files above. Before collecting, CLI preflight checks both new tables, additive snapshot columns, and RPC availability/permissions using a deliberately missing snapshot UUID. That probe must return `23503` and writes no data. Replay an existing response to check a newly configured database without another provider call. A publishable/anonymous key cannot operate these internal tables. Anonymous and authenticated roles have no table access or RPC execution permission under these migrations.

## Choose the request scope

Run commands from the repository root. Replace placeholder URLs with approved profiles.

```bash
# One configured provider's collection request.
npm run people -- --url "https://www.linkedin.com/in/approved-person" --providers coresignal

# Compare all three sequentially; Bright Data replaces Apollo.
npm run people -- --url "https://www.linkedin.com/in/approved-person" --providers coresignal,pdl,brightdata

# Live request and raw cache; no Supabase or photo download.
npm run people -- --url "https://www.linkedin.com/in/approved-person" --providers pdl --local

# PDL name/context resolution; identity still needs review.
npm run people -- --resolve --first "Chris" --last "Maresca" --company "Helmsted" --location "Oklahoma" --providers pdl

# Fictional fixtures only; no HTTP or database writes.
npm run people -- --url "https://www.linkedin.com/in/synthetic-person" --offline
```

`--providers` defaults to `coresignal,pdl,brightdata`. Each configured provider receives one request per input; duplicate provider names are removed. Coresignal and Bright Data support URLs here. PDL supports a URL or first/last name with company or location. The CLI accepts `--domain`, but no current adapter sends it as a matching parameter.

The normalizer accepts LinkedIn personal profile URLs, including scheme-less provider values. It produces `https://www.linkedin.com/in/<lowercase-slug>`, stripping query strings, hashes, and trailing slashes. Company URLs have a separate normalizer. Other hosts, credentials, extra path segments, and invalid profile paths are rejected.

## Request and retry budgets

| Operation | External requests and limits |
| --- | --- |
| Coresignal lookup | One GET, core bundle, 30-second timeout. |
| PDL lookup/resolution | One GET, `min_likelihood=6`, 30-second timeout. |
| Bright Data collection | One POST to the LinkedIn Profiles dataset, 70-second timeout. |
| Bright Data finish | One GET for an existing `snapshot_id`, 30-second timeout; no new collection. |
| Avatar | Separate eligible CDN request, five-second timeout; skipped during replay. |
| Canonical CAS retry | At most three database application attempts; no new enrichment request. |

Provider requests reject redirects and do not retry automatically. There is no automatic polling, fallback search, or resubmission. A new live invocation is a new attempt and may consume credits. Even a timeout can leave a completed or charged upstream request; inspect evidence and the provider dashboard before collecting again.

`request_count` records an attempted provider HTTP request. New writes set the compatibility column `estimated_credits` to `null`; no pricing-derived charge is calculated. `credits_remaining` can retain an observed numeric balance but is not consumption. Bright Data downloads record `request_kind: snapshot_download`, `collection_request_count: 0`, and links to the originating collection. Check account usage and charges independently.

### Billing and rate-limit evidence

The request wrapper reads these response-header names case-insensitively and keeps present values as strings in `billing_headers`:

- `x-credits-remaining`, `x-ratelimit-remaining`, and `retry-after`.
- `x-call-credits-spent`, `x-call-credits-type`, `x-totallimit-remaining`, `x-totallimit-purchased-remaining`, and `x-lifetime-used`.

The object is saved in the raw cache envelope before normalization and copied into snapshot provenance. If none are returned, it is `null`. Older caches lacking the object also produce `null`; replay does not reconstruct a header from a balance scalar or price table. A provider-reported credit-spent header is evidence in that provider's units, not a monetary invoice. Remaining quotas and lifetime totals do not establish a particular request's billed debit.

The four original Chris files saved no raw header object. The Coresignal run retained a 1,990 balance scalar and a computed estimate of 10; PDL retained a computed estimate of 1; both Bright Data attempts retained null estimates/balances. Those historical estimates were not measured charges. Original evidence stays unchanged, and duplicate-safe replay does not rewrite existing stored snapshots to manufacture header evidence. See the [local metadata audit](audit-and-review-views-2026-10-15.md).

## Raw cache and recovery

Before spending credits, the requester creates the cache directory and verifies it can write a temporary file. Every completed provider response is then saved to:

```text
.cache/raw/<provider>_<sha256-matching-input>_<timestamp>_<run-id>.json
```

The envelope contains a run UUID, public matching input, endpoint, retrieval time, HTTP status, usage metadata, original payload, and local path. Failed/non-JSON responses and network-error attempts also produce evidence. Keys and request headers are not retained; echoed API keys are redacted from response text. Cache writes precede normalization and Supabase writes. Correct any disk failure before collecting again.

`.env`, `.cache/`, `runs/`, and local upstream checkouts are ignored by Git. Cached profiles/photos still contain personal information. Restrict access and include local files in the provider-specific retention/deletion process; `.gitignore` does not provide access control or retention.

When a database step fails, reuse the cached response:

```bash
# Supabase import with zero provider or CDN requests.
npm run people -- --replay ".cache/raw/<saved-response>.json"

# Local inspection with zero HTTP, including no Supabase requests.
npm run people -- --replay ".cache/raw/<saved-response>.json" --local
```

Replay preserves retrieval time, usage metadata, and UUID. Snapshot insert ignores duplicate IDs, retaining stored evidence and manual review. Once `canonical_applied_at` is set, that snapshot is not merged again. A snapshot-only result can be replayed later if a canonical record subsequently exists to flag or link. Keep envelopes unchanged; use fresh runs for fresh evidence.

The transaction compares the previous profile hash and database update timestamp. On SQLSTATE `40001`, the CLI re-reads the person and re-merges the saved snapshot, up to three application attempts. After persistent failure, fix the database issue and replay. Canonical changes, required ledger events, and snapshot links commit together.

### Bright Data HTTP 202

A synchronous collection can return HTTP 202 with `snapshot_id` rather than a profile. That pending response is cached and does not create verified facts. The incomplete lookup gives a nonzero exit code.

Download the existing job explicitly:

```bash
npm run people -- --finish-brightdata ".cache/raw/<pending-brightdata-response>.json"
```

Add `--local` to save the result locally only. This contacts Bright Data once, caches the new response, and links it to the original collection. If still pending, inspect the response and choose when to make another explicit download. Do not rerun `--url` just to finish a job. `--replay` cannot retrieve a pending job's result because it makes no provider requests.

## Identity and human review

| Signal | Meaning |
| --- | --- |
| Snapshot `matched` / stored `matched_url` | Requested and returned canonical LinkedIn URLs agree. |
| Snapshot `mismatch` | Returned URL identifies another profile; canonical facts are protected. |
| Snapshot `missing_url` | A trustworthy returned identifier is unavailable, the record is deleted, or PDL confidence is explicitly insufficient. |
| Snapshot `search_match` | Name/context result without a requested URL; a candidate for human review. |
| Person `identity_confidence=verified` | Identity established through URL agreement, not factual accuracy certification. |
| Snapshot `review_status` | Human decision: `pending`, `correct`, `wrong`, or `uncertain`. |

Mismatched/missing-URL evidence stays in snapshots. It cannot seed a person or overwrite verified fields. If the existing requested person is found, it is flagged for review; URL mismatch sets its identity confidence to `conflict`. Name/context candidates can seed `unverified_search_match` records with a review flag, but search results cannot overwrite an existing verified person's facts.

PDL requests likelihood at least six; explicitly lower or malformed returned likelihood blocks canonical use. URL agreement and likelihood still require manual accuracy checks. `needs_manual_review` also flags competing claims and remains set across later merges. The CLI does not automatically resolve review decisions.

For the initial approximately ten-profile sample, include approved people with similar names and simultaneous jobs. In the Supabase Table Editor:

1. Compare returned identity/requested URL against the approved reference.
2. Check name, headline, location, every job, education, and picture availability against the manually reviewed profile.
3. Set `review_status`, describe wrong matches/stale claims/omissions/conflicts in `review_notes`, and set `reviewed_at`.
4. Record request counts, actually captured headers, and dashboard usage. Mark missing billing evidence unmeasured. Separate identity accuracy, completeness, and freshness.

Review fields are audit labels, not an approval workflow. Marking a previously merged snapshot `wrong` does not roll back canonical fields. Corrections, review resolution, and production acceptance require operator handling; this CLI does not implement that workflow.

### Read-only review views

The optional review migration provides `public.v_review_queue` (one row per person) and `public.v_person_claim_disagreements` (one row per field with recorded conflicts, including employment/education fields). Both use invoker security and grant only `SELECT` to `service_role`; their query structure prevents updates. They preserve existing permissions and do not modify people, snapshots, claims, or hashes.

Queue `linkedin_url` aliases `people.canonical_linkedin_url`. Review notes come from linked snapshots. Its review summary prioritizes `wrong`, then `uncertain`, then `pending`, then `correct`; it is not new identity verification. Employment/education counts count canonical entries, while `conflicting_field_count` counts displayed fields with recorded conflicts. `all_provider_claims` contains the selected claim and recorded competing claims, not a reconstruction of every provider's identical or absent claims.

After applying the migration, SQL reviewers can inspect:

```sql
select * from public.v_review_queue order by updated_at desc;
select * from public.v_person_claim_disagreements order by person_id, claim_type;
```

For the current mission, execute/apply/verify these through the connected Supabase plugin. SQL Editor application is an alternative for fresh manual setup, but it is not a substitute for claiming plugin verification. Current hosted view application/query results remain unobserved pending connection.

## Canonical selection, provenance, and changes

Accepted fields retain provider, enrichment UUID, retrieval time, and source-update time when reported. Competing non-empty claims remain in provenance and immutable snapshots. Null/empty incoming strings do not erase selected values.

Ordinary scalar selection prioritizes Coresignal, Bright Data, then PDL. Older explicitly dated source claims cannot displace newer dated selected claims; same-provider updates use source/retrieval freshness. Priority is deterministic selection, not evidence of accuracy. Descriptions prefer the longest claim; compatible dates retain month precision over year-only precision. Current status uses the freshest observed status and does not infer an ending from an omitted job.

Employment deduplicates on normalized company, title, and start year, preserving different concurrent roles. Sorting puts current roles first, then descending start date and deterministic company/key order. The first current entry supplies `current_title` and `current_company`; other current roles remain intact. Education deduplicates on normalized school/degree. Unknown dates can prevent safe job deduplication, and incomplete provider fields remain missing.

The profile hash covers normalized full name, headline, location, employment, and education. It excludes provenance, provider lists, retrieval times, avatar changes, and source ordering. First seed produces no change event. An unchanged hash advances eligible check metadata without a change row. Changed hashes create before/after evidence and classifications for added/ended jobs, title/company, location, headline, name, or education. A newly discovered historical job is an added claim, not proof a job started this week. Advisor summaries request source review.

## Private avatars

Only live snapshots with matched URL identity can download pictures. The downloader accepts HTTPS CDN hosts under `licdn.com`, rejects credentials/custom ports/redirects, and accepts JPEG, PNG, WebP, GIF, or AVIF MIME types. Accepted size is 500–5,242,880 bytes.

Accepted bytes receive a SHA-256 digest and are cached locally before upload. Identical bytes skip upload. The private object path is `person-avatars/<person-id>/<sha256>.jpg`; MIME type remains the downloaded format even when the path ends in `.jpg`. Canonical people store the internal path/hash, with provider, snapshot UUID, retrieval time, source URL, and digest in avatar provenance. Untrusted, expired, or failed images produce a non-fatal warning.

Replay skips CDN downloads and avatar uploads, including after an earlier upload or canonical transaction failed. Existing references remain; missing avatars may need a later approved live import. Production serving of private objects is outside this repository. Do not render provider photo URLs directly as a substitute for internal avatars.

## Weekly refresh

```bash
npm run people -- --weekly-refresh --limit 25 --providers coresignal
```

Selection includes only `identity_confidence=verified` people whose `last_checked_at` is older than seven days, oldest first. Default limit is 25; maximum is 100. Selection requires Supabase and rejects `--local`/`--offline`. Selected providers run sequentially per person; accepted check metadata advances, and hash changes create ledger events.

No scheduler is installed. Run manually during the pilot. At the 100-person cap, all three configured providers can make up to 300 collection requests, plus separate eligible avatar downloads. Choose one provider and a small limit until usage/quality are measured. Failed or unverified lookups can remain due. Review conflicting/unverified people before changing their identity status to make them eligible again.

## Legacy harness and tests

`npm run enrich`, `npm run import`, and `npm run demo` remain available. `enrich` keeps the original one-call Coresignal behavior, raw cache, `runs/<id>.json` evidence, and snapshot-only write. `import` preserves the existing row/review and makes no Coresignal request.

To carry an original run into the canonical tables:

```bash
npm run people -- --replay "runs/<id>.json"
```

Use the original run file to preserve its UUID. Do not import both that run and its separate raw-cache envelope as independent evidence for the same request.

```bash
npm test
npm run demo
npm run people -- --url "https://www.linkedin.com/in/synthetic-person" --offline
```

Tests cover baseline behavior, provider contracts/cache ordering, normalization, conflicts/concurrent jobs, stable hashes, diffs, replay, CAS, and avatar limits. Transport tests use the official Supabase client without a hosted project. Schema and full-pipeline integration tests use optional **test-only** PGlite and skip when unavailable. `test/schema.test.js` documents an isolated installation; `PGLITE_MODULE_PATH` can point to its module entry for both suites. PGlite is not an application dependency. A skipped database suite does not verify hosted deployment.

The [historical SDK validation report](validation-2026-10-15.md) records that earlier block's 64 passing tests and 649 production JavaScript lines. Provider checks succeeded for the approved profile with matching returned URLs; Bright Data's inactive-account HTTP 400 remains cached beside its later success. Current verification reports **77 passing tests, zero failures/skips, and 653 production JavaScript lines** in the [new audit report](audit-and-review-views-2026-10-15.md). The full local database suites used external test-only PGlite; application dependencies and the lockfile were unchanged.

Earlier SDK checks recorded one hosted person, four linked snapshots, two change events, and idempotent replay. The combined record contained nine employment entries, two current roles, five education entries, and `needs_manual_review=true`. Its local/hosted hash agreed: `d34dcb1fadf713d7d4c319686a0ee6bbb69279def6b6e4c5f9573a5f2d682e02`. These are historical observations, not a fresh plugin query.

That earlier block also recorded an 8,235-byte JPEG in the private avatar bucket, signed-read HTTP 200 with matching SHA, and anonymous-public-read HTTP 400. It used a separate CDN download and did not change the profile hash. The current block makes no provider/CDN calls; storage state still needs the requested fresh plugin inspection. Manual sample accuracy remains unmeasured.

## Before client rollout

Resolve provider retention, internal storage, redistribution, reuse, and photo rights for the intended use. Local copies and an internal Supabase database do not settle those terms. This repository does not establish zero-retention agreements, certification, or isolation from third-party services.

The pilot leaves tenant authorization, production query/display integration, private-avatar serving, review remediation, scheduling, retention/deletion automation, and a measured ten-profile accuracy report for later work. Keep those decisions separate from proving this small enrichment dataset.
