# Slice 6-F0M Measurement build blocker

## Reproduction

`pnpm build` reached the web server-entrypoint phase and failed because:

```text
apps/web/src/pages/admin/measurement/control-tower/controlled-activation/live-review/index.astro
Could not resolve ../../../../../../utils/api-fetch
```

The sibling `[id].astro` page imports the same missing utility. Both callers expect `apiFetch(path, init)` to return the ordinary `Response` contract and then inspect `response.ok` and call `response.json()`.

## Discovery and choice

No `api-fetch` utility exists in the requested baseline. The established web API base is exported from `apps/web/src/lib/api.ts`. The least invasive repair is Option C: add one generic utility at the already-imported `apps/web/src/utils/api-fetch.ts` path. It resolves root-relative API paths against the existing API base and delegates to native `fetch`.

The utility adds no Measurement logic, credentials, auth headers, provider destinations, queue behavior, consent handling, logging, response-body inspection, API contract or import-time network call.

## Subsequent baseline blocker

After adding the compatibility utility, the build resolved `utils/api-fetch` and advanced to the sibling `[id].astro` module. Rollup then failed to resolve its separate `date-fns` dependency. This is a different baseline import/dependency problem and is not covered by the narrow `utils/api-fetch` authorization.

No dependency was added and no Measurement formatting or feature code was changed.
