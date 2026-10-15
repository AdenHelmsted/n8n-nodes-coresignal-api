# People enrichment: research and pilot design

Research date: October 14, 2026. Prepared from the October 13 Chris/Aden sync and current primary vendor/GitHub sources. This project is separate from the legislation integration.

This is the original research and proposed pilot design. Implementation has since progressed: see [October 15 live evidence](validation-2026-10-15.md) and the [operations guide](OPERATIONS.md) for the actual three-table schema, commands and remaining setup. Statements below about unbuilt or untested work describe the initial research stage.

Recommendation: compare Coresignal, People Data Labs (PDL), and Bright Data on the same ten approved LinkedIn URLs. Coresignal is the strongest all-fields database candidate; PDL is a useful matching benchmark; Bright Data establishes a cheap collection baseline. These are pilot candidates, not providers cleared for client rollout. Enrich Layer is a low-commitment backup. Build a small importer and review log using provider SDKs or HTTP clients.

This is research, not a completed enrichment benchmark. No accounts were created, paid requests made, profiles collected, or Supabase tables deployed. Actual accuracy, request usage, and storage permissions remain to be established.

## What Chris is asking for

The relevant discussion starts around 13:00: enrichment during advisor client onboarding, including professional background and a profile-picture reference. Chris asks for a common people schema in Supabase, experiments across providers, combined information, and manual checks. Prospect discovery and weekly updates are later phases.

The research suggests a narrow first implementation: approved URL -> provider response -> sourced claims -> reviewer decisions -> person record. Preserve all concurrent jobs and conflicts. An LLM is unnecessary for importing these structured responses.

## Provider shortlist

Prices are USD, before tax, checked October 14. Credit units differ between providers. Posted minimum purchases are different from the marginal cost of ten results.

| Provider | Legitimate trial / entry price | Ten-profile usage estimate | Why test it |
| --- | --- | --- | --- |
| Coresignal | 2,000 credits for seven days; once per company email domain. Mini: $49/month for 2,500 credits. | Ordinary Employee API: 200 credits for ten successful records. | Strong structured professional history and source timestamps. [Trial](https://docs.coresignal.com/self-service/account-management/free-trial), [pricing](https://coresignal.com/pricing/). |
| People Data Labs | Up to 100 free credits/month. Paid: from $98/month for 350 credits. | Ten successful enrichment matches: ten credits. | Useful independent database and identity benchmark. [Pricing](https://www.peopledatalabs.com/pricing/person), [billing reference](https://docs.peopledatalabs.com/docs/reference-person-enrichment-api). |
| Bright Data LinkedIn Profiles Scraper API | 5,000 shared free credits/month for eligible new accounts; no card required. PAYG: $1.50/1,000 successful records. | Ten delivered profiles: ten credits; nominal PAYG equivalent $0.015 before account funding conditions. | Cheapest main candidate by published marginal collection price. [Free tier](https://docs.brightdata.com/general/account/billing-and-pricing/free-tier), [LinkedIn product/pricing](https://brightdata.com/products/web-scraper/linkedin). |

Coresignal's current API pricing bills successful collect/enrich responses; ordinary search/filter requests are free, while Search Preview and Agentic Search have separate charges. Real-time Employee API costs 12 credits per success and needs activation during the trial. Paid real-time access starts at Growth, currently $1,000/month; the $49 database plan does not include it. Use the current pricing docs over old quickstarts quoting one or two credits. [API pricing](https://docs.coresignal.com/pricing).

Expected cash spend for the thirty-profile comparison is $0 if the accounts qualify, required features are enabled, and the applicable trial licenses permit the experiment. Record actual credit deltas. Without free eligibility, posted PDL and Coresignal database entry subscriptions alone total $147; Bright Data wallet conditions are separate. Do not buy subscriptions before confirming scope and rights.

## Fields, inputs, and freshness

| Provider | Matching input | Minimal model fit | Freshness caveat |
| --- | --- | --- | --- |
| Coresignal database | Approved professional-network URL or provider employee ID. | Core includes name, URL, headline, location, `experience[]`, `education[]`, `picture_url`. | Distinguish `updated_at`, `checked_at`, and `processed_at`; processing time is not necessarily source observation time. [Core fields](https://docs.coresignal.com/employee-data/bundles/core), [collect](https://docs.coresignal.com/employee-data/api/collect). |
| PDL | `profile=<LinkedIn URL>`; other supported identifiers include email and name plus contextual attributes. | Base includes professional identity, work and education; headline belongs to Premium Resume. No photo field found in documented full person schema. | Database refreshes and field verification dates can predate retrieval. Free access does not establish all-field coverage. [Inputs](https://docs.peopledatalabs.com/docs/input-parameters-person-enrichment-api), [bundles](https://docs.peopledatalabs.com/docs/person-data-field-bundles), [schema](https://docs.peopledatalabs.com/docs/fields), [updates](https://docs.peopledatalabs.com/docs/data-updates). |
| Bright Data | Known LinkedIn profile URL. | Profile scraper schema includes name, location, `position`, experience, education, `avatar`, URL and identifiers. | Treat `position` as a candidate headline mapping to inspect, not proof of equivalent semantics. Public visibility can limit returned fields. [Official scraper schemas](https://docs.brightdata.com/scrapers/linkedin.com.json). |

PDL's `include_if_matched=true` reports which submitted attributes matched; its likelihood score is useful evidence, not identity proof. Keep returned URL/ID and input match metadata. Coresignal real-time requests separately expose a maximum source age; compare them separately from its database endpoint if activated. [PDL parameters](https://docs.peopledatalabs.com/docs/input-parameters-person-enrichment-api), [Coresignal real-time](https://docs.coresignal.com/employee-data/real-time-employee-api/post-request).

## Lower-cost alternatives and exclusions

- **Apify / HarvestAPI:** marketplace listing shows approximately 80,000 total users, 13,000 monthly users, and $4/1,000 detailed profiles without LinkedIn cookies. Its documented output includes work and education history; inspect photo/headline coverage in the actual sample. Ten profiles have a nominal actor result charge of $0.04. Apify provides $5/month free platform credit; confirm the actor's complete event pricing and applicable terms. This is a commercial hosted actor, not an open source people dataset. [Actor](https://apify.com/harvestapi/linkedin-profile-scraper), [platform pricing](https://apify.com/pricing).
- **Enrich Layer:** 100 personal-email or 200 work-email trial credits expire after 30 days; PAYG begins at $10/100 credits. Its dictionary includes headline, histories and `profile_pic_url`. Pricing says one to three credits/person, while endpoint/cache guides differ; budget ten to thirty credits and log actual usage. Pin API version and freshness options. [Trial](https://enrichlayer.com/docs/knowledge-base/getting-started/whats-included-in-the-free-trial), [pricing](https://enrichlayer.com/pricing), [dictionary](https://enrichlayer.com/docs/api/v2/data-dictionary), [billing](https://enrichlayer.com/docs/knowledge-base/billing/understanding-credits).
- **Scrapin / Reverse Contact:** current site announces the combination; pricing now lists a $30 paid seven-day trial and PAYG from $500. It is not a cheap default for this pilot. [Pricing](https://www.scrapin.io/pricing).
- **Apollo:** reasonable extra benchmark if Chris already pays for it; API schema has work history, headline and photo, but education completeness needs checking. **Hunter:** documented enrichment does not supply the required complete work/education histories. [Apollo schema](https://docs.apollo.io/reference/bulk-people-enrichment), [Hunter API](https://hunter.io/api-documentation).
- **Proxycurl:** older tutorials are obsolete; its founder confirms the API has shut down. [Founder statement](https://nubela.co/blog/what-is-proxycurl-api-now-in-2026-im-the-founder/).

## Open source code worth reviewing

Popularity is approximate GitHub stars checked October 14, 2026. These repositories were inspected, not installed or tested against live profiles. Software licenses do not establish rights to collected data.

| Repository | Popularity / license | Reusable part | Assessment |
| --- | --- | --- | --- |
| [PDL JavaScript SDK](https://github.com/peopledatalabs/peopledatalabs-js) | 26 stars; MIT; latest default-branch commit Sep 16, 2026. | API calls, types, enrichment/search examples. Requires provider key. | Best starting point for a TypeScript importer; official SDK rather than an independent data source. |
| [PDL Python SDK](https://github.com/peopledatalabs/peopledatalabs-python) | 40 stars; MIT; latest commit Apr 21, 2026. | Equivalent Python integration. | Choose one language for the experiment. |
| [joeyism/linkedin_scraper](https://github.com/joeyism/linkedin_scraper) | About 4.6k stars; latest commit Apr 10, 2026. | Async Playwright/Pydantic profile extraction. Requires authenticated LinkedIn session. | Reference only: README says Apache 2.0 but actual LICENSE says GPL-3.0. Current Person model lacks headline/photo fields. |
| [dedupeio/dedupe](https://github.com/dedupeio/dedupe) | About 4.5k stars; MIT; latest commit Jul 29, 2025. | Local entity resolution with human labels. | Useful later for incomplete CRM records; excessive for ten verified URLs. |
| [Splink](https://github.com/moj-analytical-services/splink) | About 2.5k stars; MIT; latest commit Oct 12, 2026. | Probabilistic record linkage with multiple identifying columns. | Later option; does not supply profile data. |
| [Apify Crawlee](https://github.com/apify/crawlee) | About 26.1k stars; Apache-2.0; latest commit Oct 14, 2026. | Crawling queues, retries and browser/HTTP infrastructure. | General framework for permitted web sources; not a complete LinkedIn enrichment system. |
| [OpenProspector](https://github.com/clawnify/OpenProspector) | 15 stars; MIT. | Provider adapters, attribution and usage-ledger patterns in an enrichment app. | Closest application reference found, but small adoption. Its email/phone prospecting workflow is broader than Chris's pilot; inspect patterns rather than deploy wholesale. |

Specific scraper concerns: joeyism's [LICENSE](https://github.com/joeyism/linkedin_scraper/blob/master/LICENSE) conflicts with its README; the [Person model](https://raw.githubusercontent.com/joeyism/linkedin_scraper/master/linkedin_scraper/models/person.py) derives convenient company/job-title properties from the first experience, which can hide concurrent jobs. Preserve the full arrays.

The original [tomquirk/linkedin-api](https://github.com/tomquirk/linkedin-api) returned 404 from both GitHub and its [repository API](https://api.github.com/repos/tomquirk/linkedin-api) during research. Do not choose it based on historical tutorials or star counts.

## Storage, reuse, and vendor retention

Three separate questions need answers: how long we can retain results; whether multiple advisors/clients may see them; and what the vendor retains from requests, outputs and logs. Supabase caching does not answer the latter two.

| Provider | Finding | Consequence for this pilot/product |
| --- | --- | --- |
| PDL | Official indexed SSA effective July 1, 2026 permits certain database/product uses, but §1.3 limits cache duration and display to one End User. §§6.1–6.4 revoke rights at nonrenewal/termination and require deletion and a signed deletion agreement within 30 days. [SSA](https://privacy.peopledatalabs.com/policies?name=services-subscription-agreement). | Clarify shared advisor use, trial expiry, audit evidence and derived records. The policy app did not render directly; these clauses were verified through official search-indexed text and need current contractual confirmation. |
| Coresignal | Public website terms expressly defer purchased-data rights to a separate legal agreement. Privacy retention is not a customer storage license. [Terms](https://coresignal.com/terms-and-conditions/), [privacy](https://coresignal.com/privacy-policy/). | Obtain applicable trial/API agreement covering storage, combining sources, advisor display and post-subscription retention. |
| Bright Data | October 12 MSA §3.9(I) restricts competing data products; §§10.1(IV)/10.2(IV) allow retention/use of collected or delivered data for the specified services. Dataset-specific terms can apply. [MSA](https://brightdata.com/license). | Confirm which terms govern the LinkedIn Scraper API, vendor reuse/log retention, and product-display rights. No zero-retention assurance established. |
| Enrich Layer | Public terms are abbreviated and point to full terms; a DPA can be requested. Privacy policy supplies no fixed API-query retention limit. [Terms](https://enrichlayer.com/terms-of-use), [privacy](https://enrichlayer.com/privacy-policy). | Promising low-cost technical backup, with storage/client-use rights unresolved. |

Snapshot download expiry is not a promise to erase all vendor copies. Keep an explicit retention deadline and deletion path for raw responses, claims and derived views. Use one legitimate trial per provider under its terms; do not rotate identities to multiply allowances.

Official LinkedIn OpenID Connect provides basic information about the consenting signed-in member; it does not provide arbitrary people's full career histories. LinkedIn also restricts unauthorized scraping/automation. A third-party API or a repository license is not evidence of LinkedIn authorization. [OIDC](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2), [LinkedIn policy](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software?lang=en).

## Minimal Supabase design

Proposed design, not a deployed migration:

| Table / view | Essential contents |
| --- | --- |
| `people` | UUID; approved canonical LinkedIn URL; manually verified name; approval/match status. Add an organization boundary before integrating RIA users. |
| `enrichment_runs` | Person, provider, endpoint/version, input identifier, retrieval UTC time, provider record ID, returned identifier, HTTP/outcome, source update time, credit delta, latency, contract reference, retention deadline; raw JSON only where permitted. |
| `person_claims` | Person, field/item identifier, JSON value, source run, provider field path/source URL, observed time if known, review status. Store competing claims separately. |
| `claim_reviews` | Claim/run, reviewer, checked time, evidence URL or approved reference, verdict and explanation. |
| `person_current` view | Selected name, LinkedIn URL, headline, location, employment history, education, profile-picture reference, plus the claim IDs supporting each selection. |

Person-facing data has seven fields: `name`, `linkedin_url`, `headline`, `location`, `employment_history[]`, `education[]`, `profile_picture_ref`. Each job retains employer, title, location, original date values/precision and current-status claim; multiple current jobs are allowed. Each education item retains school, degree/subject and original dates. The picture reference retains source URL/provider/retrieval time; do not automatically copy image bytes before rights are clear.

Normalize LinkedIn hosts, strip query/fragment tracking and consistent trailing slashes, and preserve original inputs. A normalized URL is a strong starting identifier, not an eternal ID. URL changes or returned identifiers that disagree go to review. Use provider/numeric IDs as additional evidence when available. Never merge on name alone or pick the first same-name search result.

For conflicts, keep provider A and B visible and choose an accepted claim only through an explicit rule/review. Missing fields do not erase previous facts. Dates fetched today do not make employment current. Provider agreement can reflect a shared upstream source, so it is not independent verification. Do not invent missing dates, expand year-only dates into precise days, or flatten jobs to the first employer.

Keep provider credentials server-side. Restrict research tables to the internal team; add tenant-aware access policies before product access. Supabase secret/service-role keys bypass row-level security and must remain server-side. [Supabase security](https://supabase.com/docs/guides/database/secure-data).

## Ten-profile experiment and evidence

Use approved volunteers or other explicitly approved test subjects. Suggested ten-person composition: two straightforward profiles, two people with confusingly similar names, two people with concurrent jobs, one recent job change, one retired professional, one sparse profile, and one changed/atypical profile URL. These are selection criteria; no people have been selected or approved yet.

Before requests, a reviewer records the expected identity and visible professional facts with a checked-at time. For recent employment, prefer subject confirmation or a current official biography where available. Provider output and LinkedIn both contain claims; neither is automatically ground truth.

Run every shortlisted provider against the same ten subjects before introducing a fallback waterfall; otherwise easy successes can hide differences. Cap paid profile lookups, log polling/search/retries separately, and record credits before/after. With three providers, the baseline is thirty profile lookups; asynchronous polling can make actual HTTP request count higher.

For each provider/profile, record:

| Evidence dimension | Required result |
| --- | --- |
| Identity | Correct / wrong / ambiguous / not found, with supporting returned URL/ID. |
| Field coverage | Present, missing, unavailable on plan or not applicable for each requested field. |
| Fact accuracy | Correct / incorrect / stale / unverified per claim, with reviewer evidence. |
| Temporal accuracy | Current and past employers distinguished; concurrent jobs preserved; source-age evidence. |
| Usage | Attempted HTTP calls, successes, retries/polls, credits charged and cash commitment. |
| Combined result | Accepted facts, unresolved conflicts, and whether another provider adds verified information. |

Report identity precision as correct matches divided by returned matches, listing ambiguous cases separately; report coverage as correct matches out of ten. Report field correctness and missingness separately so a sparse provider cannot look accurate merely by returning little. Calculate cost per correctly matched, usable profile, plus entry-plan cost. Ten subjects provide a case study, not a production accuracy guarantee.

Proposed pilot acceptance: zero wrong identities among accepted records; every imported fact traceable to a provider/run; all observed conflicts retained; all ten subjects reviewed; actual request/credit ledger complete; storage rights and deletion deadlines documented. Missing fields are findings, not reasons to manufacture data.

## Questions to resolve with providers before client rollout

Can we store approved profiles in Supabase, combine them with other providers' claims, display the same person to multiple RIA users, keep evidence after cancellation, and send selected facts to an LLM for summaries? Separately obtain the exact input/output/log retention periods, reuse/training restrictions, DPA and subprocessors, deletion/suppression mechanism, and photo-reference/display rights. Confirm what happens to cached and derived records when the trial ends.

The next implementation deliverables are a Supabase migration, three small provider adapters, the ten-person approved manifest, and a completed review/usage report. Start refresh scheduling and prospect discovery after this evidence supports them.
