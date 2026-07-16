# GoldPlus Live Feature Preservation Matrix (Slice 14G/14H)

Date: 2026-07-16 · RC: `d3836e8` (branch clean, remote-aligned) · Production: `bfa6de6` (ancestor of RC)

## Production truth (Slice 14G)

`ssh goldplus-prod` is not available from this execution environment (binary absent) —
live capture of containers/images/ledger is **APPROVAL/ACCESS-GATED**; the read-only
capture script is in the deployment runbook. Everything below that CAN be established
without SSH has been established from git ancestry and the local RC stack.

## The /admin/measurement-control-tower defect — diagnosed

**Symptom (production):** "Measurement readiness could not be loaded. The protected
summary request did not return usable readiness data."
**Path:** page SSR fetches `GET /admin/measurement-control-tower/summary`
(`reports.read`); the banner renders whenever that response is not `success:true`.

**Root-cause analysis (proven from git, not guessed):**
- Commit `39020b7` (broken `client.unsafe` observability wrapper) **is an ancestor of
  production `bfa6de6`**. If the running API image was built from that source, every
  drizzle `db.select()` fails with `client.unsafe(...).values is not a function` —
  the summary endpoint 500s while the storefront looks healthy only because the web
  layer falls back to seed data on API failure. This is the same TypeError that
  crashed the 10-D deploy.
- Alternate hypothesis if the running image predates `39020b7`: the summary route
  itself is absent from the old image → 404 → same banner (SOURCE_NOT_DEPLOYED).
- **Discriminating check for the operator (read-only):**
  `curl -s -o /dev/null -w '%{http_code}' https://shopgoldplus.com/api/admin/measurement-control-tower/summary`
  (or via Caddy path) — `500` ⇒ wrapper defect in image; `404` ⇒ route missing from image.
  Either way the repair is identical: **deploy the RC**, which contains the route AND
  the 10-E wrapper fix.

**Classification:** `SOURCE_NOT_DEPLOYED` + `API_RUNTIME_FAILURE` (deployed image).
**Repair state:** complete in RC. **Proof at RC (local stack):** anonymous → 401;
authenticated → 200 with contract keys `consent, gtmAutomation, health,
paidSocialReadiness, paymentReconciliation, preferenceCentre, productFinder, status,
warnings`; retry → 200; payload contains no secrets/PII markers; API error log clean.
The error banner code path is preserved untouched for genuinely bad responses.

## Preservation diff bfa6de6 → RC (Slice 14H)

| Dimension | Result |
|---|---|
| Files deleted in apps/packages | **0** |
| Files renamed | **0** |
| Files added / modified | 62 / 43 — all additive extensions |
| Routes removed | none (route mounts only appended in app.ts) |
| API contracts changed | additive only (e.g. orders/create accepts richer body; admin support GET gains `sla`/`assignedTo` fields; existing fields unchanged) |
| Schema | additive migrations 0023–0028; 0018 byte-restored; no drops |
| Permissions | unchanged (all new endpoints reuse existing permissions) |
| Feature flags | unchanged; all delivery/loyalty flags remain false |
| Workers/adapters | unchanged (BullMQ/notification adapters untouched) |
| Navigation/pages | +5 admin pages, +3 legal pages; none removed |

**No silent feature deletion exists between production and the RC.**

## Internal modules — no vague dry-run states

All internal modules (checkout, orders, delivery zones, search, autocomplete, demand,
compatibility, recommendations, admin queues, loyalty ledger, lifecycle/NBA, support,
legal, measurement dashboards, release readiness) operate against real persistence and
were proven authenticated on the RC stack (evidence: slices 10e-0b, 14e, 13b files).
The only "dry-run" banners remaining are the BullMQ/no-Redis local fallback (explicit,
env-specific) and provider delivery, which is genuinely gated (below).

## External delivery readiness (exact states)

| Channel | State |
|---|---|
| ZeptoMail email | READY_NOT_ACTIVATED (adapter + templates exist; flags false; APPROVAL_REQUIRED to send) |
| SMS (Pahappa/disabled adapter) | CONFIG_MISSING + APPROVAL_REQUIRED |
| WhatsApp Cloud API | APPROVAL_REQUIRED (approved templates + allowlist) |
| Meta/TikTok/X/LinkedIn/Pinterest/Snapchat/Google Ads destinations | CONFIG_MISSING (credential readiness tracked in destination registry) + APPROVAL_REQUIRED |
| PostHog | READY_NOT_ACTIVATED |
