# Adapted open source code

The standalone `harness.mjs` and shared request/adapter functions in `src/providers/` include adaptations of the following MIT-licensed helpers. Both full notices are retained in `licenses/`.

- **OpenProspector**, Copyright (c) 2026 Clawnify. Upstream: <https://github.com/clawnify/OpenProspector>. Fork: <https://github.com/AdenHelmsted/OpenProspector>. Revision: `b93109ba8512af999bfa0431b36ed7aa6dad34d7`. Adapted `vendorFetch` and the `linkedinSlug` extraction pattern from `src/server/providers/vendor.ts`. Changes: strict LinkedIn host/path validation, timeout, redirect rejection, raw non-JSON response preservation and credit-header capture. License: [`licenses/OpenProspector-MIT.txt`](licenses/OpenProspector-MIT.txt).
- **n8n-nodes-coresignal-api**, Copyright (c) 2026 Coresignal. Upstream: <https://github.com/Coresignal-com/n8n-nodes-coresignal-api>. Fork: <https://github.com/AdenHelmsted/n8n-nodes-coresignal-api>. Revision: `e76d6c5292bfe0232981012e850ca093651557a6`. Adapted Employee `get_by_slug` request construction from `nodes/Coresignal/Coresignal.node.ts` and the `apikey` auth header from `credentials/CoresignalApi.credentials.ts`. Added the documented core bundle selection. License: [`licenses/Coresignal-MIT.txt`](licenses/Coresignal-MIT.txt).

Supabase access uses the published `@supabase/supabase-js` package; dependencies retain their own licenses. The upstream `.upstream/` checkouts are local references and are ignored by the harness repository.
