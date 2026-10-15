# Helmsted people enrichment

A small Node.js CLI for comparing approved LinkedIn profiles across **Coresignal, People Data Labs (PDL), and Bright Data**, then keeping the evidence and a combined person record in Supabase. Bright Data replaces Apollo in the implementation. This repository stays separate from the legislation project.

The runtime uses native Node.js 22 and one direct package dependency, the official `@supabase/supabase-js` client. The original Coresignal harness remains available. Production code uses small, readable modules. The former physical line ceiling was removed at the user's request; the sole-runtime-dependency constraint remains tested.

## Setup

1. Use a current Node.js 22 release or later and run `npm install`.
2. Add the keys you have to the local `.env`, following [`.env.example`](.env.example):

   ```dotenv
   CORESIGNAL_API_KEY=your-coresignal-key
   PDL_API_KEY=your-pdl-key
   BRIGHTDATA_API_KEY=your-bright-data-key
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SECRET_KEY=your-server-secret
   ```

   Keep server credentials local. The legacy `SUPABASE_SERVICE_ROLE_KEY` also works. Missing provider keys cause that provider to be skipped.
3. For a fresh Supabase project, use its SQL Editor to run [`schema.sql`](schema.sql) first, then all of [`sql/002_canonical_people_and_changes.sql`](sql/002_canonical_people_and_changes.sql). Migration 002 adds canonical people, the change ledger, snapshot links, the atomic import RPC, and the private avatar bucket while preserving existing snapshot columns and reviews. These base migrations are applied to the current pilot; see the hosted audit below.
4. Optional human-review surfaces: apply [`migrations/20261015174745_people_review_views.sql`](migrations/20261015174745_people_review_views.sql) after migration 002. It provides two read-only, service-role-only views. It is now applied and verified in the pilot through the authenticated dashboard SQL Editor and SDK/Data API readback; [hosted audit](docs/audit-and-review-views-2026-10-15.md) records the actual results. Fresh projects still need this file.

## Plain-text person search

Pass a personal LinkedIn URL inside text, or a first/last name with company or location context:

```bash
npm run people -- --query "parse linkedin.com/in/approved-person" --providers coresignal
npm run people -- --query "First Last at Approved Company" --providers pdl
npm run people -- "First Last in Tulsa" --providers pdl
```

These are live requests unless `--offline` is supplied. Name queries require PDL in the selected providers. With `--providers pdl,coresignal,brightdata`, PDL resolves first; the other two run only if a deterministic evidence gate accepts the candidate. The default provider selection includes all three. Choose `--providers pdl` for a single-request resolution test.

The score and interval are **heuristic policy bounds, not calibrated identity probabilities**. Every name-discovered candidate stays `unverified_search_match` and requires human review, including after provider followups, saved-file replay and Bright Data download. Search cannot overwrite an existing verified person's facts. A known URL supplied directly retains the ordinary URL-agreement path.

The parser handles a bounded set of place names and US states; use explicit `at`, `in`, `--company`, or `--location` for ambiguity. It takes the first two name tokens; use `--resolve` flags for multiword names. It does not generate profile facts or perform KYC, broad prospect discovery, or email/phone matching.

See [operations](docs/OPERATIONS.md#plain-text-search-and-the-decision-receipt) for the exact formula and receipt, [Jev research](docs/jev-harness-research-2026-10-15.md) for inspected repositories, and [the implementation account](docs/plain-text-search-2026-10-15.md) for behavior, tests and limits. No extra key, dependency, SQL migration or hosted deployment is required for this change.

## Start with one call

Choose one approved profile and one provider explicitly:

```bash
npm run people -- --url "https://www.linkedin.com/in/approved-person" --providers coresignal
```

Substitute `pdl` or `brightdata` to compare another provider. To run all three sequentially:

```bash
npm run people -- --url "https://www.linkedin.com/in/approved-person" --providers coresignal,pdl,brightdata
```

Each selected, configured provider receives one collection request. There are no automatic provider retries or search fallbacks. Coresignal uses the Employee Multi-source core bundle. Defaults include all three providers, so use `--providers` for a controlled test.

Add `--local` to make the live provider call and save its response without contacting Supabase or downloading a photo:

```bash
npm run people -- --url "https://www.linkedin.com/in/approved-person" --providers pdl --local
```

`--local` still makes a live provider request and can consume credits.

## Save and replay the evidence

Live responses are saved to `.cache/raw/` **before normalization or database writes**, including failures and pending Bright Data jobs. Keep the path printed by the CLI.

After applying the migration, import a saved response without another enrichment or photo request:

```bash
npm run people -- --replay ".cache/raw/<saved-response>.json"
```

Replay can call Supabase. It makes zero provider or CDN requests. Replaying the same ID preserves the original snapshot and its manual review; an already-applied snapshot does not run the canonical merge again.

New responses retain present billing/rate-limit headers verbatim in `billing_headers`; missing headers and older caches produce `null`. The harness no longer estimates credit costs. A remaining balance is not a measured charge, and replay cannot recover headers that were never saved.

If Bright Data returns HTTP 202 with a `snapshot_id`, download the result of that existing job once:

```bash
npm run people -- --finish-brightdata ".cache/raw/<pending-brightdata-response>.json"
```

This command makes one Bright Data download request. It does not start another collection or poll automatically. Its response gets a separate cache file linked to the original collection. See [operations](docs/OPERATIONS.md) before retrying a pending job.

## Other commands

Resolve a name with context through PDL; the same gate applies. Selecting additional providers permits the guarded URL waterfall. The result requires identity review:

```bash
npm run people -- --resolve --first "Chris" --last "Maresca" --company "Helmsted" --location "Oklahoma" --providers pdl
```

Exercise all three mappers and the merge with fictional fixtures, without HTTP or database writes:

```bash
npm run people -- --url "https://www.linkedin.com/in/synthetic-person" --offline
npm test
```

Refresh a bounded set of verified URLs last checked more than seven days ago:

```bash
npm run people -- --weekly-refresh --limit 25 --providers coresignal
```

This runs once when invoked. **No schedule is installed.** The limit defaults to 25 and cannot exceed 100. An all-provider refresh can make up to three collection requests per selected person.

## What Supabase contains

| Resource | Purpose |
| --- | --- |
| `person_enrichments` | One snapshot per run, with raw response, identity result, usage, source mapping, retrieval time, and manual-review fields. |
| `people` | One canonical record per normalized LinkedIn URL, with concurrent jobs, education, field provenance, conflicts, and a stable profile hash. |
| `person_changes` | Changes to canonical profile facts, linked to the snapshot that triggered them. |
| Private `person-avatars` bucket | Accepted profile photos stored internally; downloaded only for matched identities from approved LinkedIn CDN hosts. |

URL agreement establishes identifier agreement, not factual accuracy. Conflicting and unverified claims remain available for review. A `verified` canonical identity is not a completed human accuracy check. Use the snapshot's `review_status`, `review_notes`, and `reviewed_at` in the Table Editor for manual checks. These fields record review decisions; changing them does not automatically undo a prior canonical merge.

## Original harness and validation

The original snapshot-only commands still work:

```bash
npm run enrich -- "https://www.linkedin.com/in/approved-person/"
npm run import -- "runs/<id>.json"
npm run demo
```

Use `npm run people -- --replay "runs/<id>.json"` to apply a saved original run to the new canonical tables. It preserves that run ID. The legacy `import` command writes only the original snapshot table.

Earlier live checks returned HTTP 200 with the approved URL from Coresignal, PDL, and Bright Data. Bright Data's earlier inactive-account HTTP 400 response remains cached. The [historical SDK validation report](docs/validation-2026-10-15.md) records that block's provider coverage, 64 passing tests, and 649 runtime lines. The hosted-audit block recorded **78 passing tests, zero failures/skips, and 653 runtime lines**. The subsequent search feature has **105 passing tests, zero failures/skips, and 1,016 readable runtime lines** after the user removed the ceiling; see [the implementation account](docs/plain-text-search-2026-10-15.md). The review views are deployed; the [audit report](docs/audit-and-review-views-2026-10-15.md) records fresh hosted results and the dashboard/SDK mechanisms used.

That earlier SDK validation observed one canonical person, four linked snapshots, two change events, matching local/hosted hash, and idempotent replay. The combined profile had nine employment entries, two current roles, five education entries, and `needs_manual_review=true`; a separate targeted photo test verified private upload/read restrictions. Fresh physical checks reproduced that data baseline, replayed the cached Coresignal run twice without changing counts/hash, and queried the deployed views: one review-queue row and 20 disagreement rows. This used authenticated SQL Editor execution plus SDK readback, not a plugin SQL tool. No provider/CDN request was made. Manual accuracy across the proposed ten-profile sample remains unmeasured. Start with the [physical-testing guide](docs/PHYSICAL_TEST.md).

See [operations](docs/OPERATIONS.md) for request budgets, failure recovery, merge rules, review steps, and optional PostgreSQL schema tests. Provider storage, retention, and reuse permissions remain unresolved before client rollout. Tenant integration and a production application are not implemented here.

## GitHub reuse

Forks: [OpenProspector](https://github.com/AdenHelmsted/OpenProspector) and [Coresignal's official integration](https://github.com/AdenHelmsted/n8n-nodes-coresignal-api). This CLI adapts their vendor/identifier helpers and Coresignal request pattern without importing the larger applications. Revisions and MIT notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
