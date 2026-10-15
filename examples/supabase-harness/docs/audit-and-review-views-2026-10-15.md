# Review views and billing-evidence audit

This report separates the original local implementation checks from the hosted physical checks completed on October 15, 2026. The physical checks made **zero live Coresignal, PDL, Bright Data, or CDN requests**, and production JavaScript remained unchanged.

## Hosted verification completed

The Supabase plugin is now reported installed, but this session still exposes no Supabase SQL tool. After the user signed in with the project admin account and authorized continuation, the existing review migration was applied through the **authenticated Supabase dashboard SQL Editor**, not through a plugin SQL tool. SDK/Data API reads independently verified the resulting rows. This completes the requested hosted work through the dashboard; it does not claim plugin execution.

Project: **Helmsted Market Data**, ref `ikyuxvexotyntivlsljt`. The SQL Editor reported database `postgres`, executing role `postgres`, and PostgreSQL **17.6**. The actual table columns were inspected before applying [`../migrations/20261015174745_people_review_views.sql`](../migrations/20261015174745_people_review_views.sql). Its result was **Success. No rows returned**. The complete read-only [`../sql/review_audit_queries.sql`](../sql/review_audit_queries.sql) then executed successfully, and focused SQL queries verified the queue and permissions. Fresh SDK reads recorded:

| Hosted observation | Actual result |
| --- | --- |
| Canonical people | 1 |
| Linked snapshots | 4: Coresignal 200, PDL 200, Bright Data 200, earlier Bright Data 400 |
| Snapshot human reviews | All pending |
| Change events | 2, linked to the PDL and successful Bright Data imports |
| Canonical employment entries | 9, including 2 current roles |
| Canonical education entries | 5 |
| Identity / manual review | `verified` URL identity / `needs_manual_review=true` |
| Profile hash | `d34dcb1fadf713d7d4c319686a0ee6bbb69279def6b6e4c5f9573a5f2d682e02` |
| Private avatar catalog | `person-avatars` is private; matching object metadata reports 8,235 bytes, `image/jpeg` |

The original run `bc2884c8-37af-4e97-8998-8c7cb1bcfa8c` was replayed twice through `npm run people -- --replay`. Both returned `replayed:true`; person/snapshot/change counts and the profile hash stayed unchanged. No provider or CDN was contacted. Snapshot reviews remained pending.

### Actual hosted view results

`v_review_queue` returned one row for Chris Maresca: pending review, 9 employment entries, 5 education entries, **20 conflicting fields**, and manual review required. `v_person_claim_disagreements` returned **20 rows: 5 scalar, 13 employment, and 2 education**. Eighteen selected claims were from Coresignal and two from PDL. These are recorded disagreements, not twenty proven errors; case differences, historical claims, and genuinely different facts still require review.

Both views report `security_invoker=true` and `is_updatable=NO`. A separate compact permissions query confirmed, for each view: `anon SELECT=false`, `authenticated SELECT=false`, `service_role SELECT=true`, and `service_role INSERT/UPDATE/DELETE=false`. The migration adds no base-table writes and does not modify legislation resources. Both datasets currently share the project's `public` schema but use separate tables, views, and codebases; this is table separation, not a separate database/schema security boundary.

The dashboard Advisor Center was inspected with all filters cleared. It lists RLS-enabled/no-policy notices for the internal people tables and legislation tables, unused indexes, and an Auth connection-management recommendation. The people tables deliberately deny ordinary client access and use server credentials, so no permissive client policy was added. No advisor item naming either new view was shown. The existing Auth/legislation findings were not changed; this inspection is not a blanket security certification.

Private evidence is retained under ignored `.cache/audit/`, including `review-views-2026-10-15T20-36-33.212Z.json` and `hosted-review-queue.jpg`. The fresh storage check verifies catalog existence/metadata only, not current image bytes. The earlier [SDK validation](validation-2026-10-15.md) documents the separate historical signed-byte/SHA check. No fresh photo request was needed for this block.

All current observations still cover **one approved person**. Human accuracy for the proposed ten-profile sample is unmeasured. Follow [the physical-testing guide](PHYSICAL_TEST.md) to approve and evaluate the remaining profiles before adding merge features or scheduling refreshes.

## Local cache metadata: observed facts

Only envelope keys and usage metadata were inspected; no credentials or private profile body values are included here.

| Original local evidence | HTTP status | Request count | Raw/header object retained | Historical `estimated_credits` | Retained `credits_remaining` |
| --- | ---: | ---: | --- | ---: | ---: |
| Coresignal `runs/*.json` | 200 | 1 | Absent | 10, computed | 1990 |
| PDL `.cache/raw/*.json` | 200 | 1 | Absent | 1, computed | null |
| Bright Data success `.cache/raw/*.json` | 200 | 1 | Absent | null | null |
| Bright Data inactive-account `.cache/raw/*.json` | 400 | 1 | Absent | null | null |

None of these four files contains `billing_headers`, a raw response-header object, or header metadata in provenance. The Coresignal balance is a previously converted scalar; its original header string was not preserved. It must not be reconstructed into a synthetic `x-credits-remaining` header. PDL's historical estimate does not establish that `x-call-credits-spent` was present. No provider charge is measured by these caches.

Original cache files remain unchanged. Old-cache replay uses `billing_headers=null`. Existing duplicate snapshots retain their original evidence; new normalized snapshot writes set `estimated_credits=null`. Historical computed values are not silently relabeled as measurements.

## Prepared review views

The migration adds no JavaScript or base-table mutations:

- `public.v_review_queue`: one row per person; canonical URL, identity/review flags, canonical entry counts, conflicting-field count, linked snapshot review summary/notes, and update time.
- `public.v_person_claim_disagreements`: conflicting scalar, employment, and education fields, with the displayed value, selected provider, selected/competing provenance, and entry context.

Both are read-only, use `security_invoker=true`, and grant only `SELECT` to `service_role`. Queue notes/statuses aggregate actual linked snapshot reviews. The summary prioritizes wrong, uncertain, pending, then correct; it does not certify identity or accuracy. Canonical entry counts are not counts of independently confirmed jobs or schools. Disagreement rows show recorded competing claims, not inferred provider values or every identical supporting claim.

The migration is verified locally and now applied to the hosted project through the authenticated SQL Editor. Actual output and permissions are recorded above.

## Header capture contract

Future live responses can supply these allowlisted headers, read case-insensitively:

```text
x-credits-remaining
x-ratelimit-remaining
x-call-credits-spent
x-call-credits-type
x-totallimit-remaining
x-totallimit-purchased-remaining
x-lifetime-used
retry-after
```

Present values are retained as returned strings in cache `billing_headers` and snapshot provenance. If none are present, the object is `null`. No absent value is fabricated, calculated from pricing, or recovered through another provider call. Header capture is tested with mocked responses; this block does not establish which headers a future live account will return.

The compatibility field `estimated_credits` is now null for new output/writes. The original 64 test cases remain; the three assertions expecting computed Core/PDL estimates are updated to null to follow the user's newer no-estimate requirement. Merge rules, concurrent roles, date precision, identity handling, and replay idempotency remain in scope for regression checks.

Credit-spent headers are provider-reported units. Remaining balances, rate limits, lifetime totals, request counts, and `retry-after` do not independently establish a monetary charge or a particular request's debit. Missing billing evidence remains absent/unmeasured.

## Observed local verification

`npm test`: **78 passing, 0 failing, 0 skipped**. Production JavaScript: **653 physical lines**, including the legacy harness, below both the 750-line ceiling and the preferred 675-line target.

The full suite used external, test-only PGlite for SQL schema/view checks and the official Supabase SDK's local database integration. No application dependency or lockfile changes were required. Tests verify exact header strings (including `0001`) survive cache/provenance/database transport, absent headers remain null, historical caches stay unchanged, and both views query locally with the intended read-only permissions and review semantics. Existing merge, concurrent-role, date-precision, and replay scenarios remain covered.

Legacy replay forwards captured header metadata when present; normalization makes absent old headers and estimate output null without editing source caches. Offline fixture retrieval time is generated at execution rather than hardcoded. The original local implementation block made no provider, CDN, or hosted REST checks. The later physical-testing block recorded above added authenticated dashboard SQL execution and fresh SDK/Data API checks, with no provider or CDN calls. The full 78-test suite and fictional three-provider offline run were repeated during that physical-testing block.
