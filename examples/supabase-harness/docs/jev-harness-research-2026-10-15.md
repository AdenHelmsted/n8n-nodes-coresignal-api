# Jev harness research and implementation decision

Research date: October 15, 2026. Scope: public open-source harnesses that could inform the requested deterministic person-search policy. No provider requests, private profile uploads, runtime changes, dependency installation, or upstream code execution were part of this research.

## Decision

Implement a small native JavaScript decision contract rather than add a Jev framework dependency. The references below genuinely wrap TypeSafe's Jev decision model. This project's requested v1 remains a deterministic parser, evidence scorer, policy gate, and provenance receipt. It does not call Jev or any generative model.

Use the general separation of evidence, policy, outcome, and recorded reasons. Do not vendor unrelated coding-agent validators, model transports, experiment runners, or interfaces. No upstream implementation source was copied during this research. The links record design references, not a claim that their code or model powers this harness.

The requested interval is a **heuristic evidence uncertainty band**. It is not a statistically calibrated confidence interval, a measured error bound, or a probability that the selected person is correct. Synthetic fixtures can verify the formula and action boundaries; they cannot establish real-world identity accuracy.

## Repositories inspected

Revisions below are public `main` heads observed during research. They pin the inspected sources; they are not promises about later upstream changes.

| Repository | Inspected revision | Confirmed license | Fit for this project |
| --- | --- | --- | --- |
| [TypeSafeAI/jev-harness](https://github.com/TypeSafeAI/jev-harness) | [`5b88e656155b27fe09a179991b8b4f798b6861b8`](https://github.com/TypeSafeAI/jev-harness/tree/5b88e656155b27fe09a179991b8b4f798b6861b8) | [MIT](https://github.com/TypeSafeAI/jev-harness/blob/5b88e656155b27fe09a179991b8b4f798b6861b8/LICENSE) | Strongest reference for validated decision inputs, abstention, and audit boundaries. Its proposal-review domain differs from person matching. |
| [AntonioCoppe/jev-harness](https://github.com/AntonioCoppe/jev-harness) | [`1a3dd4ae86de72f0df7d6e70b25feffc41ca3255`](https://github.com/AntonioCoppe/jev-harness/tree/1a3dd4ae86de72f0df7d6e70b25feffc41ca3255) | [MIT](https://github.com/AntonioCoppe/jev-harness/blob/1a3dd4ae86de72f0df7d6e70b25feffc41ca3255/LICENSE) | Useful policy/action separation. Its Jev SDK and backend calls are unnecessary for deterministic matching. |
| [cyanheads/jev-harness](https://github.com/cyanheads/jev-harness) | [`24eca7901c9353e9388c09cf267abdfd0ae236d4`](https://github.com/cyanheads/jev-harness/tree/24eca7901c9353e9388c09cf267abdfd0ae236d4) | [Apache-2.0](https://github.com/cyanheads/jev-harness/blob/24eca7901c9353e9388c09cf267abdfd0ae236d4/LICENSE) | Useful future evaluation reference: compare scores with human labels and measure threshold tradeoffs. Too much runtime/tooling for v1. |
| [Txy02/jev-harness](https://github.com/Txy02/jev-harness) | [`d8fe665402e15927839c3fdb417986b480e307d4`](https://github.com/Txy02/jev-harness/tree/d8fe665402e15927839c3fdb417986b480e307d4) | [MIT](https://github.com/Txy02/jev-harness/blob/d8fe665402e15927839c3fdb417986b480e307d4/LICENSE) | Clear three-way gate reference, but Python and actual model inference are outside the existing Node CLI. |

The similarly named repositories are separate community projects. In particular, TypeSafeAI/jev-harness explicitly describes its community organization as independent of the official TypeSafe AI team. Its name does not establish official SDK status or product endorsement. [Pinned README](https://github.com/TypeSafeAI/jev-harness/blob/5b88e656155b27fe09a179991b8b4f798b6861b8/README.md).

No popularity or production-readiness ranking was used. This is a source-level fit assessment for a small internal pilot, not a benchmark of these projects.

## What the actual sources support

### TypeSafeAI: validated evidence and explicit audit limits

The inspected decision table rejects invalid configuration, checks finite and bounded response values, and distinguishes missing review evidence from favorable evidence. Its favorable verdict remains evidence for a host rather than authorization to execute. These are useful patterns for a person-search gate; its four coding-proposal questions are not person-matching criteria. [Decision source](https://github.com/TypeSafeAI/jev-harness/blob/5b88e656155b27fe09a179991b8b4f798b6861b8/src/contract/decide.ts).

The optional receipt adapter records a policy revision, threshold, exact request, and evidence binding, then supports offline replay checks. It uses SHA-256 and deliberately does not persist, authenticate, or authorize the receipt. Our compact provenance receipt can preserve an explainable policy decision without importing the workspace snapshot machinery. A digest alone would not prove the facts true or identify the writer. [Receipt source](https://github.com/TypeSafeAI/jev-harness/blob/5b88e656155b27fe09a179991b8b4f798b6861b8/src/audit/receipt.ts).

### AntonioCoppe: policy separation with caveats

The policy resolver retains an intended action and the action allowed by its confidence policy. Its configurable low-confidence behavior includes proceeding, and the resolver itself does not reject non-finite confidence. Those behaviors should not be copied into this project's conservative identity gate. [Policy source](https://github.com/AntonioCoppe/jev-harness/blob/1a3dd4ae86de72f0df7d6e70b25feffc41ca3255/src/policy.ts).

Its confidence aggregation averages answer confidence values. A mean must not override our hard name-mismatch rule. Its shadow mode invokes the backend before replacing the returned action, so shadow mode is not a zero-request guarantee. [Confidence source](https://github.com/AntonioCoppe/jev-harness/blob/1a3dd4ae86de72f0df7d6e70b25feffc41ca3255/src/confidence.ts), [harness source](https://github.com/AntonioCoppe/jev-harness/blob/1a3dd4ae86de72f0df7d6e70b25feffc41ca3255/src/harness.ts).

The package depends on `@typesafe-ai/sdk`; adding it would violate the mission's sole-dependency constraint. [Package manifest](https://github.com/AntonioCoppe/jev-harness/blob/1a3dd4ae86de72f0df7d6e70b25feffc41ca3255/package.json).

### Cyanheads: evaluation needs ground truth

The calibration module compares predictions with known answers, reports unsuitable labels, and calculates coverage and precision at different thresholds. These are useful ideas for a later labeled profile sample. They do not calibrate a new string-matching formula merely because that formula also produces values between zero and one. [Calibration source](https://github.com/cyanheads/jev-harness/blob/24eca7901c9353e9388c09cf267abdfd0ae236d4/src/analysis/calibration.ts).

The project is a TypeScript/Bun harness with an OpenRouter-oriented model workflow, and its manifest declares Bun 1.3+, Node 24+, and `zod`. Our Node 22 CLI does not need that runtime change or dependency for this mission. [Pinned README](https://github.com/cyanheads/jev-harness/blob/24eca7901c9353e9388c09cf267abdfd0ae236d4/README.md), [package manifest](https://github.com/cyanheads/jev-harness/blob/24eca7901c9353e9388c09cf267abdfd0ae236d4/package.json).

### Txy02: a small three-way gate

The Python gate separates ACT, REVIEW, and REJECT with bounded, ordered thresholds and optional per-question overrides. This supports the choice of explicit three-way policy outcomes, but it is not a JavaScript identity matcher and supplies no suitable person-match formula. Its package uses Python and `httpx`. [Gate source](https://github.com/Txy02/jev-harness/blob/d8fe665402e15927839c3fdb417986b480e307d4/src/jev_harness/gate.py), [package manifest](https://github.com/Txy02/jev-harness/blob/d8fe665402e15927839c3fdb417986b480e307d4/pyproject.toml).

## How this informs the native v1 contract

The official TypeSafe documentation describes confidence-gated routing as separating a proposed answer from whether to act on it. That is the architectural analogy being used here. Our signals come from deterministic comparisons with provider responses, not the TypeSafe model. [Official routing pattern](https://docs.typesafe.ai/patterns/confidence-routing).

The mission supplies the following local contract:

- Parse an operator query into an explicit personal LinkedIn URL or name plus company/location context.
- Compare the candidate's provider-returned name, context, and optional PDL likelihood with the parsed input.
- Bound all scores and the uncertainty band to zero through one; never let missing values or `NaN` become favorable evidence.
- Keep a hard wrong-name veto: a zero name score must produce a zero lower bound.
- Allow a URL waterfall only at the stated lower-bound threshold and with a valid returned personal LinkedIn URL.
- Preserve review and rejection as different outcomes with a stored reason and evidence receipt.
- Keep automatically discovered URL matches unverified. Agreement with a URL selected by PDL is not independent confirmation of the operator's intended identity.
- Protect an existing verified person from being overwritten by an automated search candidate.

The exact scoring formula, uncertainty adjustments, and implementation behavior belong in the implementation documentation and tests. They must be documented as local policy choices, not attributed to an upstream Jev harness. Include a version in the receipt so future policy changes can be distinguished from changes in the provider facts.

## Validation and attribution boundaries

The implementation should be verified with mocked HTTP transports and local fixtures only, preserving existing CLI modes and the sole-runtime-dependency contract. The original physical line ceiling was superseded by the user during implementation so the safety rules could be written readably. Assert on the selected action, actual provider-call sequence, canonical identity state, and saved receipt. An accepted synthetic fixture is not evidence that a real candidate is correct.

The ten-profile human evaluation remains necessary to measure correct and incorrect identities, missing/stale fields, review coverage, and actual provider usage. A reviewed development sample is useful pilot evidence, but does not establish population-wide error rates or calibrated probability bounds.

This research adds no model dependency, copied upstream implementation, new provider integration, schema migration, or hosted deployment requirement. If upstream code is copied in a later change, preserve the applicable license and attribution notices for the exact source revision instead of treating these reference links as a substitute.
