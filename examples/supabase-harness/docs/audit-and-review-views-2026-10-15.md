# Review views and billing-evidence audit

This block prepares read-only review views and honest response-header capture. It makes **zero live Coresignal, PDL, Bright Data, or CDN requests**. The user requires hosted checks and view application through the Supabase plugin.

## Hosted verification status

The user reports that the Supabase plugin should be present. The rechecked tool catalog still reports it uninstalled in this environment and exposes no Supabase SQL tools. This availability discrepancy remains unresolved. Consequently, this block has not freshly queried hosted people/snapshots/changes/storage, applied the review-view migration to the hosted project, or queried those views there. No current hosted result is inferred from local tests or a project SDK credential; no REST audit was substituted for the requested plugin audit.

The [earlier validation report](validation-2026-10-15.md) records historical SDK observations: one person, four linked snapshots, two changes, matching local/hosted hash, idempotent replay, and a private photo check. It does not fulfill the current plugin-only audit requirement. Counts, current photo existence, and hosted view outputs remain to be re-observed through the plugin.

After connection, the remaining hosted work is:

1. Query the three tables and check canonical counts, identity/review flags, provenance, snapshot links, and the two change events.
2. Inspect the existing private `person-avatars` bucket/object without a new image download.
3. Apply [`../migrations/20261015174745_people_review_views.sql`](../migrations/20261015174745_people_review_views.sql) after the existing base schema/migration 002.
4. Query both views for the approved person and record exact observed output counts/values, access restrictions, and the mechanism used.

The read-only [audit query file](../sql/review_audit_queries.sql) prepares those queries for execution after the migration. It is SQL source, not hosted evidence; object-listing metadata does not verify current photo bytes.

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

The migration is prepared and verified locally. Hosted application and output remain pending the plugin steps above.

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

Legacy replay forwards captured header metadata when present; normalization makes absent old headers and estimate output null without editing source caches. Offline fixture retrieval time is generated at execution rather than hardcoded. No provider, CDN, or hosted REST checks ran in this block. These local results do not establish hosted view deployment or current hosted data/storage state.
