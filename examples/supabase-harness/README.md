# Helmsted people enrichment

A small Node.js CLI for comparing approved LinkedIn profiles across **Coresignal, People Data Labs (PDL), and Bright Data**, then keeping the evidence and a combined person record in Supabase. Bright Data replaces Apollo in the implementation. This repository stays separate from the legislation project.

The runtime uses native Node.js 22 and one direct package dependency, the official `@supabase/supabase-js` client. The original Coresignal harness remains available. Implementation stays below the 750-line runtime budget; tests, SQL, and documentation are excluded.

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
3. For a fresh Supabase project, use its SQL Editor to run [`schema.sql`](schema.sql) first, then all of [`sql/002_canonical_people_and_changes.sql`](sql/002_canonical_people_and_changes.sql). Migration 002 adds canonical people, the change ledger, snapshot links, the atomic import RPC, and the private avatar bucket while preserving existing snapshot columns and reviews. Both migrations are now applied to the configured hosted pilot; its verification is recorded below.

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

If Bright Data returns HTTP 202 with a `snapshot_id`, download the result of that existing job once:

```bash
npm run people -- --finish-brightdata ".cache/raw/<pending-brightdata-response>.json"
```

This command makes one Bright Data download request. It does not start another collection or poll automatically. Its response gets a separate cache file linked to the original collection. See [operations](docs/OPERATIONS.md) before retrying a pending job.

## Other commands

Resolve a name with context through PDL; the result requires identity review:

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

Live provider checks have returned HTTP 200 with the approved URL from Coresignal, PDL, and Bright Data. Bright Data's earlier inactive-account HTTP 400 response remains cached. The [validation report](docs/validation-2026-10-15.md) records provider coverage, **64 passing tests with no skips**, and **649 runtime lines**.

Hosted migration preflight now passes. Replaying the four cached responses produced one canonical person, four linked snapshots, and two change events without new provider requests. Replaying them again left those counts and the profile hash unchanged. The hosted profile matches the local combined record: nine employment entries, two current roles, five education entries, and `needs_manual_review=true`. A separate targeted photo test verified private upload, signed read, and blocked anonymous public read; normal CLI replay still makes no CDN requests. These checks establish working requests, identifier agreement, and hosted database/storage behavior; manual accuracy across the proposed ten-profile sample remains unmeasured.

See [operations](docs/OPERATIONS.md) for request budgets, failure recovery, merge rules, review steps, and optional PostgreSQL schema tests. Provider storage, retention, and reuse permissions remain unresolved before client rollout. Tenant integration and a production application are not implemented here.

## GitHub reuse

Forks: [OpenProspector](https://github.com/AdenHelmsted/OpenProspector) and [Coresignal's official integration](https://github.com/AdenHelmsted/n8n-nodes-coresignal-api). This CLI adapts their vendor/identifier helpers and Coresignal request pattern without importing the larger applications. Revisions and MIT notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
