# Three-provider implementation and live evidence

Evidence recorded October 15, 2026 UTC. The later October 15 requests occurred late October 14 in America/Chicago. Only Chris Maresca's previously approved LinkedIn profile was queried. No client roster or prospect discovery was used.

## Live calls and coverage

| Provider | Actual collection HTTP attempts | Outcome | Jobs | Education | Name | Headline | Location | Photo reference |
| --- | ---: | --- | ---: | ---: | --- | --- | --- | --- |
| Coresignal core bundle | 1, October 14 | HTTP 200; returned URL agrees | 7 | 1 | Present | Present | Present | Present |
| PDL Person Enrich | 1, October 15 UTC | HTTP 200; returned URL agrees | 7 | 4 | Present | Derived from job title/company | Missing | Not supplied by mapper |
| Bright Data LinkedIn profiles dataset | 2, October 15 UTC | First HTTP 400, "Customer is not active"; one retry after user reported activation returned HTTP 200 and matching URL | 0 | 1 | Present | Missing | Present | Present |

Bright Data's successful response had a null employment history. Empty fields are retained as coverage findings; the harness does not manufacture jobs from the top-level company or parse dates/current status from prose. Browser API activation alone was not assumed to activate the dataset: the actual dataset endpoint was tested and succeeded.

There were four collection HTTP attempts across the experiment, three successful responses and one account-activation failure. No automatic provider retries, polling or snapshot downloads occurred. Coresignal estimated usage is 10 credits and its reported remaining balance was 1,990. PDL estimated usage is 1 credit. Bright Data credit usage and before/after balance deltas were not reported by these responses. These are actual request counts and estimated credit units, not measured charges.

The three successful returned URLs agree with the approved input. This is one person's identifier-agreement check across three providers, **not** three independently verified people or a factual accuracy benchmark. Employment, education and freshness still need a human check.

## Combined record from saved responses

All three saved successful responses were normalized and merged locally without another provider call:

- Three contributing providers; nine employment entries, including two current roles; five education entries.
- Overlapping entries were merged by normalized company/title/start-year. Different titles or degrees remain separate, so the union counts do not imply nine independently confirmed jobs or five schools.
- Conflicting top-level claims remain visible for name components, headline and location; five employment entries also have conflicting field claims. Some name conflicts are differences in letter case.
- `needs_manual_review = true`. Provider priority chooses a displayed claim; it does not certify the claim.
- Stable combined profile hash: `d34dcb1fadf713d7d4c319686a0ee6bbb69279def6b6e4c5f9573a5f2d682e02`.

Raw payloads remain in ignored local files, including PDL's extra fields outside the seven-field canonical model. Raw provider data must be treated as sensitive internal evidence and handled under the applicable provider agreement. No real payload, image, credential or cache file is published to GitHub.

Local evidence IDs:

| Provider / outcome | Snapshot UUID | Saved evidence |
| --- | --- | --- |
| Coresignal success | `bc2884c8-37af-4e97-8998-8c7cb1bcfa8c` | `runs/<UUID>.json` |
| PDL success | `81eb1b7f-c552-4fb3-810a-91161ddb75ff` | `.cache/raw/pdl_*_<UUID>.json` |
| Bright Data account inactive | `66f62eac-00a7-4442-a495-71be355196a6` | `.cache/raw/brightdata_*_<UUID>.json` |
| Bright Data success | `7dddc529-e20e-43e0-b2a3-d34504d59976` | `.cache/raw/brightdata_*_<UUID>.json` |

## Code verification

`npm test`: **64 passing, 0 failing, 0 skipped**. Tests use fictional fixtures and mocked provider traffic; no test consumes provider credits.

The original eight harness checks and seven PostgreSQL checks remain covered. New checks exercise exact adapter endpoints/auth, input validation, cache-write preflight, HTTP/network failures, pending Bright Data downloads, name-context identity review, simultaneous jobs, date precision, field conflicts, stale facts, stable hashes, job changes, replay without provider/CDN calls, partial migration detection, private avatars, compare-and-swap retries and repeatable SQL migrations.

An integration check runs the official Supabase SDK against a local PostgREST bridge backed by PGlite's PostgreSQL engine. It covers cached provider response through snapshot insertion, three-provider canonical merge, change event, transaction rollback and idempotent old replay. It is a local database test, not evidence that the new migration has been deployed to the hosted project.

Production JavaScript: **649 physical lines**, including the legacy harness. The test suite enforces strictly fewer than 750. Runtime dependencies remain native Node 22 plus `@supabase/supabase-js`. The external PostgreSQL test engine is optional test tooling outside this repository's application dependencies.

## Hosted Supabase status

The original `person_enrichments` table contains the previously verified Coresignal snapshot. A live read confirmed one profile, one Coresignal row and a pending manual review.

Migration `sql/002_canonical_people_and_changes.sql` is prepared and locally verified. At this report's creation, hosted deployment is pending the user's SQL Editor execution: the available Data API credential cannot run DDL and the CLI has no login token. After deployment, import the saved successful responses with `--replay`; this requires no new provider or CDN requests. Photo bytes remain unpopulated during replay by design.

No weekly scheduler, client-facing access, household linking or production rollout is enabled. Weekly refresh is an explicit, capped CLI command.

## Remaining pilot evidence

Choose nine additional approved subjects, including similar names and concurrent jobs, before running the ten-profile comparison. For each approved person and provider, record correct/wrong/ambiguous identity, each field's correctness/missingness/staleness, checked-at time, reviewer evidence and measured account usage where available. The original research document supplies the provider/pricing/license comparison; its commercial facts are dated October 14 and must be confirmed against the applicable account agreement.

Provider retention, storage, combined-data display, vendor reuse, photo rights and deletion obligations remain unresolved before client rollout. An internal Supabase copy is an online mirror and does not establish zero-retention rights or compliance certification.
