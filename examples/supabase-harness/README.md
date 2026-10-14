# Simple people enrichment harness

One approved LinkedIn URL -> one Coresignal request -> a saved JSON run -> Supabase.
Separate from the legislation project. One script, one database table, one runtime dependency: the official Supabase JavaScript client. Node.js 22 or later.

## Setup

1. Run `npm install`.
2. Put these values in your local `.env` (see `.env.example`; keep any existing values):

   ```dotenv
   CORESIGNAL_API_KEY=your-key
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SECRET_KEY=your-server-secret
   ```

   Legacy `SUPABASE_SERVICE_ROLE_KEY` is also accepted. Use a server secret, never a publishable/anon key. `.env` and saved responses are ignored by Git.

3. Open your Supabase project's **SQL Editor**, paste all of [`schema.sql`](schema.sql), and run it once.

## One profile

```bash
npm run enrich -- "https://www.linkedin.com/in/approved-person/"
```

The CLI makes exactly one GET to Coresignal's Employee Multi-source endpoint with `bundle=core_employee_data`. The core bundle is documented at 10 credits per successful record. There is no search, automatic retry, or refresh scheduler. The API's remaining balance is logged separately from the estimated charge; the harness does not claim a measured credit delta.

Test Coresignal without saving to Supabase:

```bash
npm run enrich -- "https://www.linkedin.com/in/approved-person/" --local
```

Each attempt is saved under `runs/<id>.json` before a database write. To save that response later, or retry a failed Supabase write:

```bash
npm run import -- runs/<id>.json
```

`import` uses the saved response and **does not call Coresignal**. Replaying the same ID leaves its existing database row and manual review unchanged. A new `enrich` invocation makes a new provider request and creates a separate row. Use the import command for the already-collected test response.

## What is stored

`person_enrichments` contains name, LinkedIn URL, headline, location, all employment entries, education, and the profile-picture URL reference. Each row also retains the requested identifier, provider, retrieval time, source update time, provider record ID, actual source-field mapping, raw response, HTTP status and usage metadata.

Rows are snapshots rather than automatic overwrites: competing or stale claims stay visible. The response URL must agree with the requested URL to receive `matched_url`; a different or missing URL is saved for review and exits with a nonzero status. Both `linkedin_url` (observed live) and `professional_network_url` (documented variant) are supported. `matched_url` is identifier agreement, not verified factual accuracy. Dates and concurrent jobs remain intact.

In Supabase's Table Editor, set `review_status` to `correct`, `wrong`, or `uncertain`, add `review_notes` describing missing/stale/conflicting fields, and set `reviewed_at`. Provider retention/storage permission still determines how long you can keep these rows and local JSON files.

## Offline checks

```bash
npm test
npm run demo
```

The fictional demo makes no API requests and records zero usage. Tests cover one-call behavior, API errors, returned identity, multiple jobs, source provenance, and replay behavior through the official Supabase client. No live keys are needed for tests.

## GitHub reuse

Forked [OpenProspector](https://github.com/AdenHelmsted/OpenProspector) and [Coresignal's official integration](https://github.com/AdenHelmsted/n8n-nodes-coresignal-api). Adapted only the vendor request/identifier helpers and the Coresignal slug/auth pattern. The harness runs independently of both larger applications. Exact upstream revisions, adapted files and MIT notices are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

Provider references: [collect endpoint and bundles](https://docs.coresignal.com/employee-data/api/collect), [core fields](https://docs.coresignal.com/employee-data/bundles/core), [credit headers](https://docs.coresignal.com/api-introduction/credits).
