# Root cause register — 2026-08-03 platform-wide recovery

## RC-1 (SHARED, CRITICAL) — SSR_RELATIVE_URL / BUILD_TIME_ENV_INCORRECT
**Evidence:** `/admin/analytics` renders `Failed to parse URL from /admin/analytics/overview`;
`/admin`, `/admin/platform-modules`, `/admin/inventory`, `/admin/audit`,
`/admin/compatibility` render "service unavailable". The built web SSR bundle has
`apiBase` = "" (empty): the web image was built without `PUBLIC_API_BASE_URL`
passed to the build arg, and `apis.ts` used `?? 'http://localhost:3000'` which does
NOT catch an empty string, so `apiBase` stayed "". Every `${apiBase}${path}` fetch
became a RELATIVE URL, which Node's SSR `fetch` rejects ("Failed to parse URL").

**Affected:** all ~78 web files that build requests via `apiBase` (admin data plane,
platform modules, analytics, inventory, audit, compatibility, notifications, …).

**Canonical fix (§10.2):**
1. `apps/web/src/lib/api.ts`: treat empty as unset (`||` not `??`); in SSR use an
   absolute INTERNAL origin read at runtime (`process.env.INTERNAL_API_ORIGIN` =
   `http://api:3000`, the api container on the compose network — verified reachable
   from web), never the public hairpin; browser keeps the public origin.
2. `docker-compose.production.yml`: add `INTERNAL_API_ORIGIN=http://api:3000` to the
   web service environment.
3. Rebuild the web image WITH the build args (`--env-file .env.production`) so the
   browser bundle's public origin is correct too.

**Regression test:** architecture test forbidding empty-base relative SSR fetch;
Playwright asserting no "Failed to parse URL"/"service unavailable" banner on the
admin data-plane routes; container test web→`http://api:3000/health` = 200.

**Release impact:** web image rebuild only (no schema change). Reversible by
redeploying the prior web image.

## RC-2 (to verify) — browser client-side `/api/*` same-origin fetches
5 files fetch `/api/admin/measurement/*` client-side (browser) with same-origin;
requires a Caddy `/api/*` → API route. Verify Caddy has it; if not, those
client-side calls fail in the browser. Investigate after RC-1.
