# Physical test: the first ten approved people

This guide records the earlier hosted baseline. The user subsequently authorized the plain-text search feature and removed its line ceiling; see [the implementation account](plain-text-search-2026-10-15.md). During the upcoming human sample, keep production behavior stable while collecting review evidence. Use the existing CLI and manual review to learn where provider data is accurate, incomplete, stale, or duplicated. Do not add fuzzy matching, overrides, or background refresh before reviewing the sample with Chris.

## What has been checked

Local checks on Node **v22.23.2** returned **78 passing tests, zero failures, zero skips**, with **653 physical production JavaScript lines**. The fictional three-provider offline run returned four employment entries, two education entries, and `needs_manual_review=true`.

Fresh SDK/Data API checks recorded this hosted baseline:

- One person; nine employment entries, including two current roles; five education entries; manual review required.
- Four linked snapshots, all pending review: Coresignal 200, PDL 200, Bright Data 200, and its earlier inactive-account 400.
- Two change events. These reflect claims added during provider imports, not proof of a real job change during the experiment.
- Profile hash: `d34dcb1fadf713d7d4c319686a0ee6bbb69279def6b6e4c5f9573a5f2d682e02`.
- A private `person-avatars` bucket and matching photo catalog entry with 8,235-byte JPEG metadata. Catalog metadata does not re-verify current image bytes.

The original Coresignal run was replayed twice through the expanded CLI; both returned `replayed:true` without provider/CDN requests. The review migration and complete audit SQL have now successfully run through the authenticated Supabase dashboard SQL Editor after user sign-in. Fresh SDK/Data API readback agrees. Plugin SQL tools were not used.

The deployed review baseline is one queue row for Chris: identity verified, review pending, nine employment entries, five education entries, 20 conflicting fields, and null review notes. The disagreement view contains 20 rows: five scalar, 13 employment, and two education fields. Both views use invoker security and are non-updatable; `service_role` has SELECT without view write privileges, and anonymous/authenticated roles cannot SELECT. No JavaScript changed and no live provider/CDN request was made for this deployment.

## Understand which commands make live requests

| Operation | Provider/CDN activity | Supabase activity |
| --- | --- | --- |
| Unit tests and `--offline` | None; fixtures/mocked traffic only | None hosted; tests use local PostgreSQL tooling |
| `--replay` | No provider or CDN requests | Reads/writes through Supabase |
| Review/audit SQL | No provider or CDN requests | Database queries; the view migration adds SQL views |
| Live `--url` | One collection per selected, configured provider; eligible photo downloads are separate | Snapshot/canonical/change writes |
| Live `--resolve` | One configured PDL resolution request | Stores candidate/review evidence |
| `--finish-brightdata` | One existing-job download request; an eligible returned photo may be downloaded | Stores the new response and canonical evidence |

Live provider requests can consume account usage. `--local` still makes a live provider request; it only skips Supabase and photos. Replay consumes no provider credits, but ordinary Supabase usage remains separate. No command estimates provider charges.

## 1. Run the offline checks from WSL

```bash
cd /home/nowel/projects/helmsted-Linkedin-Scout
node --version
npm test
npm run people -- --url "https://www.linkedin.com/in/synthetic-person" --providers coresignal,pdl,brightdata --offline
```

Current expected test summary: 105 passed, zero failed/skipped. The 78-test/653-line figures above describe the earlier hosted baseline. Expected fictional CLI summary: all three providers matched, estimates null, four employment entries, two education entries, and review required. This is fixture behavior, not a live provider observation.

The full suite needs external test-only PGlite. Without it, database tests skip and nested tests do not all register; any skipped database suite is an incomplete check. The current full suite includes three additional search/database scenarios. The validated WSL installation is discoverable at `/tmp/helmsted-schema-check/node_modules/@electric-sql/pglite/dist/index.js`; see [operations](OPERATIONS.md) if it is unavailable. No application dependency or JavaScript change is needed for the existing validated setup.

## 2. Inspect the already-deployed review views

**No further migration application is required in the checked pilot project.** The base schema, canonical migration, and review-view migration are already applied, and the complete read-only [`../sql/review_audit_queries.sql`](../sql/review_audit_queries.sql) executed successfully in the authenticated SQL Editor. The hosted audit reported PostgreSQL 17.6 under role `postgres`; subsequent SDK reads agreed with its review results.

For the physical test, rerun the read-only audit SQL whenever you need a before/after comparison. Save actual outputs internally and confirm:

1. The person, snapshot, change-event, hash, and review baseline above.
2. The private bucket and matching object catalog row.
3. Before adding new subjects: one queue row with 20 conflicting fields and 20 disagreement rows (five scalar, 13 employment, two education).
4. Invoker security, non-updatable views, service-role SELECT without view write privileges, and no anonymous/authenticated SELECT.

The resources target the people dataset in `public`; deployment did not modify legislation tables. SQL queries are the dependable review surface even if the dashboard does not show views in the Table Editor. For a shorter inspection:

```sql
select * from public.v_review_queue order by updated_at desc;
select * from public.v_person_claim_disagreements order by person_id, claim_type;
```

For a different, fresh project, setup still requires these complete files in order: [`../schema.sql`](../schema.sql), [`../sql/002_canonical_people_and_changes.sql`](../sql/002_canonical_people_and_changes.sql), then [`../migrations/20261015174745_people_review_views.sql`](../migrations/20261015174745_people_review_views.sql). Verify actual hosted output there rather than treating this pilot's results or local tests as deployment proof.

## 3. Repeat a cached import without another lookup

Run the original approved Coresignal evidence twice:

```bash
npm run people -- --replay "runs/bc2884c8-37af-4e97-8998-8c7cb1bcfa8c.json"
npm run people -- --replay "runs/bc2884c8-37af-4e97-8998-8c7cb1bcfa8c.json"
```

Both should report `replayed:true` for an already-applied run. Re-run the audit SQL and compare counts/hash before and after: no extra snapshot or change event should appear. These commands make Supabase calls but no provider/CDN calls.

Use expanded `--replay`, which preserves the input file. The legacy `npm run import` re-maps and rewrites its supplied run JSON. Do not import both a legacy run and its separate raw-cache envelope as independent evidence for one request; their UUIDs can differ.

## 4. Approve the nine additional profiles

Get the exact profiles approved with Chris before any new live request. Include:

- A person with simultaneous operating, board, and foundation/trustee roles.
- A common name, with known company/location context for resolution.
- A person who recently changed jobs, to expose provider lag.

Keep an internal list of canonical LinkedIn URL, reference name, scenario, approved providers, approval note, and reviewer. Leave unknown reference facts blank; do not invent them to complete the list.

There is no bulk test runner or hidden retry loop. Work one approved person at a time. Nine people across three configured providers means up to 27 initial collection attempts, plus any optional PDL resolution and Bright Data downloads. Photos are separate CDN activity. Use one provider for the first live smoke test, then expand deliberately.

## 5. Optional: test name resolution before URL enrichment

To observe a newly seeded `unverified_search_match`, choose an approved person who does not yet have a verified canonical record and resolve them first:

```bash
# LIVE PDL REQUEST. Replace every placeholder with approved context.
npm run people -- --resolve --first "<First>" --last "<Last>" --company "<Company>" --location "<Location>" --providers pdl
```

This is an additional provider request and can consume usage. Inspect the returned candidate manually before proceeding. Name/context matching is not factual or identity approval. If the returned URL already belongs to a verified canonical record, the code intentionally preserves verified identity/facts and flags review; it does not downgrade that person merely to demonstrate the candidate status. A later matched URL import can establish URL agreement for a new candidate.

## 6. Run approved URL lookups

The following URLs are placeholders, not approved subjects. Replace them before running.

```bash
# LIVE: first smoke test, one selected provider.
npm run people -- --url "https://www.linkedin.com/in/<approved-slug>" --providers coresignal

# LIVE: selected three-provider comparison for an approved person.
npm run people -- --url "https://www.linkedin.com/in/<approved-slug>" --providers coresignal,pdl,brightdata
```

Each invocation is new collection activity. If you already ran Coresignal in the first command, repeating the all-provider command collects Coresignal again. To avoid that duplicate, run `--providers pdl,brightdata` for the remaining comparison. Keep each printed cache path and note the actual attempts.

Missing keys skip providers. A run with skips does not establish that all three providers were tested. HTTP errors, URL mismatches, and pending responses remain cached and can yield a nonzero exit code. Inspect the saved response/status before deciding whether another live attempt is justified; do not retry automatically.

### If Bright Data returns HTTP 202

Use the existing pending envelope path printed by the CLI:

```bash
# LIVE DOWNLOAD REQUEST; does not start another collection.
npm run people -- --finish-brightdata ".cache/raw/<pending-envelope>.json"
```

Wait until you choose to check the existing job, then invoke once. A still-pending response is cached again; there is no polling loop. The download avoids a second collection submission but is not guaranteed free or unmetered. Inspect actual header/account usage. Do not rerun `--url` just to finish the same job.

## 7. Review facts and usage with Chris

Use the two SQL views for comparison. Edit source snapshots in the **`person_enrichments` base table** in Supabase Table Editor:

- `review_status`: `correct`, `wrong`, `uncertain`, or leave `pending` until checked.
- `review_notes`: the observed wrong identity, missing field, stale claim, duplicate, or disagreement, with reference evidence.
- `reviewed_at`: the actual review time.

The views are read-only. Their review status summarizes linked snapshots, separately from URL identity. A `verified` identity means URL agreement, not completed human accuracy review. Canonical entry counts are combined claims, not independently confirmed jobs/schools.

For each person/provider, record:

| Check | What to record |
| --- | --- |
| Identity | Correct, wrong, or ambiguous; requested and returned URL agreement |
| Seven requested fields | Correctness/missingness/staleness for name, URL, headline, location, employment, education, picture reference |
| Concurrent employment | Every real current role preserved; separate roles not accidentally collapsed |
| Dates and changes | Actual year/month precision and whether a reported change is real or newly discovered old information |
| Conflicts/duplicates | Which displayed/competing claims need review; do not merge them manually during the pilot |
| Usage | Actual request attempts/statuses, captured header strings, account usage where available, and absent/unmeasured billing evidence |

New billing metadata is null when no allowlisted headers were returned. The old caches do not contain raw headers; the old Core balance and computed Core/PDL estimates cannot be reconstructed into measured billing. See [the billing audit](audit-and-review-views-2026-10-15.md).

Changing review notes/status does not roll back canonical facts or implement an adjudication lock. Record corrections in notes for follow-up; avoid direct edits to canonical jobs, education, hash, or provenance that would bypass the audit path. Keep raw evidence and review worksheets internal.

Finish with the manually checked ten-person comparison before running weekly refresh, scheduling automation, or changing merge rules. Provider storage/reuse/retention and photo rights still need resolution before client rollout.
