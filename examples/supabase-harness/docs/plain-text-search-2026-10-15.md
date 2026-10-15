# Plain-text people search: implementation and accountability

Date: October 15, 2026. This describes the native query/parser/policy/waterfall feature added after the hosted review-view audit. It records implemented behavior separately from measured real-person accuracy.

## Delivered result

An operator can supply a personal LinkedIn URL inside text, or a first and last name with company/location context. A name query goes to People Data Labs first. The resulting evidence is evaluated by a deterministic, versioned policy. Only an accepted decision permits the remaining selected providers to collect the discovered URL.

A search-discovered URL remains an **unverified candidate** through followups, raw-file replay, exported-row replay and Bright Data's delayed download. The policy does not generate person facts, certify identity, or replace human review. Existing verified canonical facts are protected from search-origin updates.

The implementation uses native Node.js 22 and the existing Supabase SDK. It adds no dependency, model service, web application, new provider, table, migration or scheduler. It leaves the legislation code and database resources untouched. No provider, CDN or hosted Supabase request was made while implementing or testing this change.

The original mission imposed a 750-physical-line ceiling and preferred 715. The first implementation reached 715. The user then explicitly removed the ceiling and asked for readable, strong code without bloat. The new parser/policy and shared identifier helpers were separated into readable modules; the CLI flow was expanded. The observed production total is **1,016 physical JS/MJS lines**, including the 162-line legacy harness. The sole-runtime-dependency constraint remains enforced by a test.

## Research before implementation

Four actual Jev harnesses were inspected with pinned revisions and confirmed licenses. The full [research report](jev-harness-research-2026-10-15.md) links their source, manifests and licenses.

- TypeSafeAI/jev-harness: MIT; useful explicit validation, policy and receipt boundaries. It identifies itself as independent community work, not an official TypeSafe SDK.
- AntonioCoppe/jev-harness: MIT; useful separation of intended action, confidence policy and allowed action. Its model SDK is unnecessary here, and its shadow mode still calls a backend.
- Cyanheads/jev-harness: Apache-2.0; useful labeled evaluation and threshold analysis. Its Bun/TypeScript/model workflow exceeds this CLI's needs.
- Txy02/jev-harness: MIT; a clear three-way action/review/reject gate, implemented in Python around actual model inference.

The adopted idea is evidence → explicit policy → recorded outcome. No upstream implementation source was copied or vendored. No Jev model runs in this project. The local string comparisons and weights are our documented policy, not an algorithm claimed to come from an upstream project.

## Architecture and file responsibilities

| File | Responsibility |
| --- | --- |
| `src/identifiers.js` | Shared strict personal/company LinkedIn URL validation and organization-text normalization. Pure leaf module. |
| `src/search.js` | Query parsing, finite location classification, name/context comparisons, score/band calculation and the v1 action receipt. Pure module; no network, database or filesystem calls. |
| `src/normalize.js` | Existing provider-field mappings and fact normalization, then application of the search decision or inherited origin. Reexports existing identifier APIs and new parser/policy APIs for compatibility. |
| `src/index.js` | Primary-mode validation, selected-provider ordering, PDL resolution, conditional followups, CLI summaries, replay and existing refresh/finish modes. Accepts injected transports/cache directories for offline integration tests. |
| `src/providers/request.js` | Existing one-attempt HTTP/cache contract. Retains original query as matching metadata; keys stay in request headers and out of saved matching inputs. |
| Provider adapters | Existing endpoint/auth construction; now forward search-origin metadata to the cache. Bright Data finish carries it into downloaded results too. |
| `src/db.js`, `src/merge.js`, `src/diff.js` | Existing official SDK writes, replay/CAS transaction, canonical selection, conflict retention and change ledger. No new merge or SQL mechanism was introduced. |
| `harness.mjs` | Existing legacy commands. Its URL wrapper now shares the validator while retaining absolute-URL input and trailing-slash output. |
| `test/query.test.js` | Parser/policy and mocked full-CLI/receipt/replay/download regressions. |
| `test/query-pipeline.test.js` | Official SDK → mocked REST → local PostgreSQL tests of identity, snapshot links, protected facts and replay/manual reviews. |
| `test/runtime-contract.test.js` | Replaces the revoked line-count cap with the sole-direct-dependency constraint. |

The module split avoids a circular dependency: identifiers is a leaf; search uses identifiers; normalize uses both; orchestration uses those modules. Provider adapters and the legacy URL wrapper import the leaf validator directly. Existing callers can still import normalization APIs from `src/normalize.js`.

## Parsing contract

### Personal URL input

A query can contain a personal LinkedIn URL with or without a scheme, surrounded by prose or punctuation. The parser extracts and validates the whole candidate rather than trusting a substring that merely resembles LinkedIn. The existing normalizer handles allowed LinkedIn hosts, slug normalization, tracking parameters and trailing slashes.

An operator-supplied URL follows the existing URL-enrichment path; it does not first ask PDL to guess the person. Selected provider order remains unchanged. Provider URL agreement can yield the existing `verified` identity label, which means agreement with the requested identifier, not documentary identity verification.

Company URLs, malformed escapes, invalid hosts, credentials, extra profile-path segments and multiple distinct personal URLs reject before provider collection. Repeated occurrences of the same normalized personal URL are accepted. A query containing invalid LinkedIn links rejects conservatively rather than selecting a convenient valid substring. The parser accepts at most 2,048 characters.

### Name/context input

The first token is the first name, the second is the last name, and remaining tokens form one context. It does not invent missing names or infer a hidden surname. Examples from the mission are parser examples, not assertions about real people's current employment or location:

| Input | Parsed slot |
| --- | --- |
| `Chris Maresca Helmsted` | first Chris, last Maresca, company Helmsted |
| `Chris Marseca Helmsted` | same company; typo preserved for comparison rather than silently corrected |
| `Chris Maresca at Helmsted` | explicit company Helmsted |
| `Aden Nowell Tulsa` | location Tulsa |
| `Aden Nowell in Oklahoma City, OK` | explicit location Oklahoma City, OK |
| `First Last JP Morgan` | company JP Morgan |
| `First Last IN` | location Indiana's uppercase postal code |

`at` directly selects company; `in` directly selects location. `from`, commas and a separating hyphen are accepted without pretending to disambiguate every natural-language sentence. Without a direct hint the classifier recognizes all 50 US states/codes, DC, valid city/state suffixes and a finite metro dictionary. Other contexts default to company. NYC and New York normalize together for comparison.

The state dictionary uses a Map, so words such as Constructor and toString cannot be mistaken for inherited JavaScript properties. Uppercase IN is accepted as Indiana, while a trailing lowercase `in` without a place is rejected as an unfinished connector.

Explicit `--company` and/or `--location` take precedence over inferred context. If either flag is supplied, only the supplied context slots are used; the parser does not silently preserve a conflicting inferred slot. If both are supplied, both are checked. A name with no context is accepted only with usable context flags.

First/last names containing spaces cannot be reliably parsed by the two-token query grammar. Use the existing `--resolve --first "..." --last "..."` flags for those cases. Names can include letters, apostrophes, periods and hyphens. Domain metadata is still not a matching parameter; no email/phone/address matching flags were added.

## PDL resolution and request scope

Name queries must select PDL. The CLI fails early if the provider list excludes it; it does not add a hidden provider request. PDL runs first regardless of its position in the selected list. Duplicate provider names are removed.

The existing PDL Person Enrichment endpoint performs one best-match lookup using first/last and company/location, with `min_likelihood=6` and `include_if_matched=true`. It is not the separate broad Person Search endpoint and does not return a ranked discovery UI.

The raw response is cached before normalization or database operations. Its actual matching input and original query are retained. Missing credentials skip the provider. HTTP errors, network failures and invalid identities preserve evidence but cannot initiate URL followups. No automatic retry or fallback search was added.

Once the normalized PDL snapshot has been processed successfully, an `accept_and_waterfall` receipt permits remaining selected/configured URL providers to run sequentially on its returned personal URL. Their order follows the original selection. Selecting only PDL makes one resolution request even when its policy permits a waterfall; no unselected provider is called.

A passing three-provider name run attempts one PDL collection, one Coresignal collection and one Bright Data collection. A review/reject run stops after PDL. Missing keys reduce actual attempts. Explicit Bright Data downloads are additional requests. Provider or storage failures do not trigger provider retries; inspect saved evidence before collecting again.

## Exact score and uncertainty policy

The frozen policy revision is `people-search-v1`. Its `score_kind` is `heuristic_evidence_band`. The field name `confidence` follows the mission; it is an evidence score, not an empirically measured probability. Its interval is not a statistical confidence interval or a certified error bound.

### Name signal

Normalized first and last agreement scores 1.00. A single insertion, deletion, substitution or adjacent transposition in one name scores 0.80 only if the other name agrees exactly. Both names edited, a larger mismatch or a missing usable name scores zero.

The candidate's observed first/last provider fields are preferred. If one is missing, tokens of its observed full name may be used only for comparison. The scorer does not write inferred names back into profile facts and does not correct the operator's typo in the raw input.

### Context signal

For company, the normalized query must equal a normalized employment company or occur as a complete phrase in the headline. It is not arbitrary substring similarity: Helm does not automatically match Helmsted. The shared organization normalizer preserves the existing treatment of punctuation and common legal suffixes.

For location, the requested phrase must match within the normalized returned location. Standalone or complete comma-separated state-code components expand to full names, and NYC/New York is a supported alias. Ordinary words inside a location string, such as “in” in “London in England,” are never expanded into Indiana; a regression covers this false-acceptance risk. Company and location signals are kept in their own slots; a company mentioned only in a location string is not credited as employment.

Matching evidence scores 1.00. Absent applicable fields score 0.50. Populated but nonmatching evidence scores zero. If company and location are both supplied, their minimum is used so one strong signal cannot conceal the other mismatch. Employment history can corroborate a company even if it is historical; this is not a claim of current employment.

### Provider likelihood and formula

A finite numeric PDL likelihood between zero and ten is divided by ten. Missing likelihood produces null. Explicitly invalid, out-of-range or below-six likelihood prevents acceptance and canonical use. A missing value widens the band and cannot pass the v1 waterfall threshold.

```text
point = round_to_2_decimals(
    0.65 * name_score
  + 0.25 * context_score
  + 0.10 * (likelihood_score if present, otherwise 0.50)
)

radius = 0.02
       + 0.08 for a fuzzy name
       + 0.20 for missing context evidence
       + 0.25 for missing likelihood
```

The lower endpoint is point minus radius, rounded down; the upper is point plus radius, rounded up. Endpoints are clamped to zero through one. Tiny floating-point tolerance prevents binary rounding noise from moving an exact cent boundary.

A zero name score forces the lower endpoint to zero. So do non-200 responses, unusable returned personal URLs, deleted/invalid candidate identity and explicitly unacceptable likelihood. A high weighted point cannot override these vetoes.

Actual outputs from fictional fixtures:

| Scenario | Point | Interval | Action |
| --- | ---: | --- | --- |
| Exact name, matching context, likelihood 9 | 0.99 | [0.97,1.00] | accept_and_waterfall |
| One transposition, matching context, likelihood 9 | 0.86 | [0.76,0.96] | accept_and_waterfall |
| Exact name, contradictory context, likelihood 9 | 0.74 | [0.72,0.76] | review_only |
| Exact name/context, likelihood absent | 0.95 | [0.68,1.00] | review_only |
| Fuzzy name/context match, likelihood 8 | 0.85 | [0.75,0.95] | accept_and_waterfall |
| Fuzzy name/context match, likelihood 7 | 0.84 | [0.74,0.94] | review_only |
| Wrong name, matching context, likelihood 10 | 0.35 | [0.00,0.37] | abstain_reject |

The accept threshold uses the lower endpoint, not the point or upper endpoint. A lower bound at least 0.75 permits followups; 0.50 through below 0.75 produces review-only; below 0.50 produces rejection. These thresholds are tested at their exact boundaries.

Review-only records can seed an unverified candidate and save evidence. Rejected responses still save the raw snapshot and receipt but cannot seed accepted canonical facts. If a linked person already exists, the existing merge behavior may flag it for review while preserving facts. Rejection/pending/error paths return a nonzero CLI outcome where identity/status failed; a stored review-only candidate is a valid review outcome.

## Identity protection and durable ancestry

The central invariant is that agreeing with a URL chosen by PDL is not independent confirmation of the operator's intended person.

The PDL name/context snapshot is `search_match`. New canonical records use `unverified_search_match` and `needs_manual_review=true`. Before a followup response is normalized, its raw cache includes `search_origin` with the PDL resolution UUID and decision receipt. This ancestry is carried into snapshot provenance.

If a followup provider returns the guessed URL, normalization labels it `search_match` instead of ordinary `matched`. Missing or different returned URLs remain invalid/mismatched; search ancestry cannot conceal them. The existing merger therefore keeps newly searched people unverified and prevents higher-priority search providers from overwriting an existing verified person's facts, hash, field provenance, provider contributions or enrichment state. Review flags remain sticky.

The followup's inherited receipt describes the parent PDL resolution, not an independent confidence score for that provider's name or job claims. Its parent UUID makes this explicit and traceable. Other provider facts still undergo the existing deterministic merge/conflict rules for an unverified candidate.

No human approval system was added. Setting a snapshot review label does not automatically promote identity, fix facts or lock a manual override. After manually confirming the intended URL, the operator can deliberately run the normal `--url` path. The existing `verified` label then means identifier agreement, not legal/KYC certification.

### Raw cache and exported-row replay

The initial PDL file contains raw provider data and original matching inputs. The receipt is computed during normalization and saved in database provenance; the raw file is not rewritten to insert the decision. Replaying a complete name/context cache re-evaluates the versioned policy from its original evidence instead of trusting a pasted receipt.

Followup raw caches contain the parent receipt and origin. Replay retains that origin and cannot promote them. Exported snapshot rows use `raw_response` instead of `raw_payload` and store matching input/origin in provenance; replay now restores those too. This closes a subtle bypass where importing an exported row could otherwise lose the name gate or mistake a guessed URL for a supplied URL.

Replay never starts another provider waterfall, downloads a photo or changes the saved input file. The existing UUID/replay ledger and duplicate-safe insert preserve previously stored snapshots and manual review fields. Already-applied snapshots do not re-merge or create duplicate events. There is one current policy implementation; the version label is audit metadata rather than an automatic historical-policy registry.

### Bright Data delayed results

A 202 response retains the raw pending job and search origin. The CLI requires an explicit `--finish-brightdata` request to download that existing job. The new download envelope has its own ID, collection parent metadata and the original search origin. Normalization and replay keep the downloaded person unverified.

There is no polling loop and no second collection submission. A download is still an HTTP request and is not promised free. Failed or still-pending responses remain cached for operator inspection.

### Photos, refresh and database scope

The existing avatar downloader requires `matched` identity. Search-origin snapshots are `search_match`, so this change does not download or upload guessed candidates' photos. Provider picture references remain available as evidence. A later confirmed explicit-URL import can use the existing private-photo path.

Weekly refresh still selects only verified people older than seven days and runs only when invoked. No schedule was added. Existing jobs/schools deduplication, date precision, conflict provenance, CAS retries and transactional change events remain unchanged.

All new data fits existing JSONB provenance and existing identity/review columns. There is **no SQL to apply for this feature**. Publishing the code does not itself collect new people or update hosted rows. New receipts appear there only after an approved search/import is actually run.

## Validation evidence

The final local verification recorded **105 tests passed, zero failed, zero skipped**. It includes the optional external test-only PGlite suites using the real official Supabase client over a mocked REST transport into local PostgreSQL-compatible execution. PGlite remains outside application dependencies.

A second protection was enabled for the final run: the default global fetch implementation was replaced with a guard that rejects any unexpected real fetch. Injected mock transports still processed synthetic provider/SDK requests. The run completed without a default-fetch attempt. Logs are retained privately in ignored `.cache/audit/query-test-results.txt`.

The existing 77 non-budget functional/database test cases remain. The revoked line-ceiling test was replaced with the sole-dependency contract. Twenty-seven additional search-related regressions bring the total to 105.

The new coverage checks:

- Embedded/schemeless/regional URLs, trailing punctuation, repeated equivalent URLs, multiple distinct URLs, malicious-looking hosts, malformed paths and whitespace trimming.
- Exact mission company/location examples, explicit flags, connectors, multiword context, all 50 states and codes, DC and metro aliases, ordinary company names that resemble JavaScript prototype properties.
- Exact/fuzzy/wrong/missing names, missing vs contradictory context, two-context minimum, malformed/absent likelihood and exact action boundaries.
- PDL-first ordering, selected-provider deduplication, missing credentials, HTTP failures and zero followups after review/rejection.
- Unverified canonical identity after a successful full mocked waterfall.
- Wrong followup URLs staying mismatched.
- Raw-envelope and exported-row replay preserving gate inputs and search ancestry.
- Bright Data pending collection, explicit download and downloaded-file replay preserving the original decision/identity.
- Official SDK/database snapshot links, protected verified facts/hash/provenance/contributions, change-event counts, replay idempotency and preservation of human review status/notes/time.

Before implementing, the baseline run exposed an existing wall-clock-sensitive test. `test/pipeline.test.js` set its purported newer source update to a fixed 23:00 UTC on October 15. The current time had passed that timestamp, so freshness logic correctly rejected the update and the job-ended assertion failed. The test now uses a timestamp one minute after the actual test time. Its assertions were retained; production freshness logic was not weakened.

These tests establish software behavior under controlled inputs. They do **not** establish real PDL match accuracy, provider freshness, actual charges, model calibration, retention rights or production suitability. No new live sample was run.

## How to use and physically evaluate it

From WSL:

```bash
cd /home/nowel/projects/helmsted-Linkedin-Scout
npm test
npm run people -- --query "Synthetic Person at Example Advisors" --offline
```

The offline command uses fictional fixtures, performs no HTTP/database writes, runs the gated three-provider path, and should report an unverified candidate. It cannot prove a real match.

For an approved live person, start with one PDL request:

```bash
npm run people -- --query "First Last at Approved Company" --providers pdl
```

After deliberately choosing to test the full gated path:

```bash
npm run people -- --query "First Last in Approved Location" --providers pdl,coresignal,brightdata
```

Use the cache path printed by the CLI if database processing fails. `--local` skips Supabase and photo work but still contacts providers; `--offline` is the zero-request mode.

Inspect the receipt through the existing Supabase SQL Editor after actual approved collection:

```sql
select id, provider_name, name, linkedin_url,
       provenance->>'identity_status' as identity_status,
       provenance->'decision_receipt' as decision_receipt,
       provenance->'search_origin' as search_origin,
       review_status
from public.person_enrichments
order by retrieved_at desc;
```

Continue the [ten-profile physical review](PHYSICAL_TEST.md) with exact approved reference URLs, known employer/location context, similar names, concurrent roles and recent job changes. Record correct/wrong/ambiguous identity, missing/stale fields, false acceptances/reviews/rejections and actual usage. Compare exact and typo queries for the same approved person. Keep unsupported or uncertain facts blank.

A reviewer should first verify the person, then inspect field correctness and freshness. Provider agreement is corroborating evidence, not proof. A ten-person development sample can expose concrete failures and guide a policy revision; it is too small to claim a population-wide calibrated 0.75 correctness probability.

## Remaining deliberate limits

This is a CLI and a deterministic small-data pilot. It does not provide unrestricted natural-language search, ranked candidate lists, broad company/industry prospect discovery, nicknames/transliteration, fuzzy employment/education clustering, email/phone matching, documentary/KYC checks, tenant authorization, human adjudication locks or automatic scheduling.

The finite parser can classify an unknown place as a company; explicit context flags are the remedy. A one-character name resemblance can also be a different real person. An accepted score only permits bounded collection and still leaves human review required.

Provider retention, internal storage, reuse and picture rights remain a separate pre-rollout decision. None is settled by a deterministic confidence score or by storing a provider response internally.
