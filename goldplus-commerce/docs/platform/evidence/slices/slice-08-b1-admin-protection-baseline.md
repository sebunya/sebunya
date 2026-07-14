# Slice 8-B1 — Admin protection baseline

Captured: 2026-07-14 (Africa/Kampala)

## Source and reproduced blocker

- Branch: `phase-2-measurement-control-tower-completion`
- Local and origin baseline: `53d578f15ef229b1b54f60ba94cecde88ee81f87`
- Ahead/behind: `0/0`
- Index and worktree: clean before Slice 8-B1
- Public admin allowlist: `/admin/login` only

All five known operational routes returned `200` while logged out and rendered their admin interfaces. Marker counts from the live response bodies were 44 for dry-run, 49 for controlled activation, 51 for live canary, 54 for Measurement handover, and 43 for release readiness.

Root cause: these five static Astro pages imported and rendered `AdminLayout` and operational shell components without calling the existing server-side `readSessionToken(Astro.request)` guard. The remaining operational admin pages already used that guard.

## Complete admin Astro route inventory

Classification is deny-by-default. `public allowlisted` is limited to login; every other row is `protected operational`. “Markers” records the source-level protected shell or operational content; “action” records the baseline decision.

| Source file | Route | Classification | Guard present before repair | Protected markers | Action taken |
| --- | --- | --- | --- | --- | --- |
| `admin/audit/index.astro` | `/admin/audit` | protected operational | yes | admin layout/audit | preserve |
| `admin/campaigns/index.astro` | `/admin/campaigns` | protected operational | yes | admin layout/campaigns | preserve |
| `admin/carts/index.astro` | `/admin/carts` | protected operational | yes | admin layout/carts | preserve |
| `admin/categories/index.astro` | `/admin/categories` | protected operational | yes | admin layout/categories | preserve |
| `admin/controlled-activation-dry-run.astro` | `/admin/controlled-activation-dry-run` | protected operational | no | dry-run/activation/admin shell | add route guard |
| `admin/controlled-activation.astro` | `/admin/controlled-activation` | protected operational | no | activation governance/admin shell | add route guard |
| `admin/controlled-live-canary.astro` | `/admin/controlled-live-canary` | protected operational | no | live canary/admin shell | add route guard |
| `admin/dealers/index.astro` | `/admin/dealers` | protected operational | yes | admin layout/dealers | preserve |
| `admin/feeds/index.astro` | `/admin/feeds` | protected operational | yes | admin layout/feeds | preserve |
| `admin/governance/index.astro` | `/admin/governance` | protected operational | yes | admin layout/governance | preserve |
| `admin/index.astro` | `/admin` | protected operational | yes | trust centre/admin modules | preserve |
| `admin/inventory/index.astro` | `/admin/inventory` | protected operational | yes | admin layout/inventory | preserve |
| `admin/login.astro` | `/admin/login` | public allowlisted | no | login only | preserve public |
| `admin/loyalty.astro` | `/admin/loyalty` | protected operational | yes | operator preview | preserve |
| `admin/measurement-control-tower.astro` | `/admin/measurement-control-tower` | protected operational | yes | Control Tower | preserve |
| `admin/measurement-handover.astro` | `/admin/measurement-handover` | protected operational | no | handover/runbooks/admin shell | add route guard |
| `admin/measurement/attribution.astro` | `/admin/measurement/attribution` | protected operational | yes | attribution/Measurement | preserve 8-B0A |
| `admin/measurement/consent.astro` | `/admin/measurement/consent` | protected operational | yes | consent/Measurement | preserve 8-B0A |
| `admin/measurement/control-tower/controlled-activation/live-review/[id].astro` | `/admin/measurement/control-tower/controlled-activation/live-review/[id]` | protected operational, dynamic | yes | live-review/API | preserve 8-B0A; sample required |
| `admin/measurement/control-tower/controlled-activation/live-review/index.astro` | `/admin/measurement/control-tower/controlled-activation/live-review` | protected operational | yes | live-review/API | preserve 8-B0A |
| `admin/measurement/dlq.astro` | `/admin/measurement/dlq` | protected operational | yes | DLQ/Measurement | preserve 8-B0A |
| `admin/measurement/index.astro` | `/admin/measurement` | protected operational | yes | Measurement Control Tower | preserve 8-B0A |
| `admin/merchandising/index.astro` | `/admin/merchandising` | protected operational | yes | admin layout/merchandising | preserve |
| `admin/notifications/index.astro` | `/admin/notifications` | protected operational | yes | admin notifications | preserve |
| `admin/orders/[id].astro` | `/admin/orders/[id]` | protected operational, dynamic | yes | order operations | preserve; source guard verified |
| `admin/orders/index.astro` | `/admin/orders` | protected operational | yes | order operations | preserve |
| `admin/payments/index.astro` | `/admin/payments` | protected operational | yes | payment operations | preserve |
| `admin/pricing/index.astro` | `/admin/pricing` | protected operational | yes | pricing operations | preserve |
| `admin/products/[id].astro` | `/admin/products/[id]` | protected operational, dynamic | yes | product operations | preserve; source guard verified |
| `admin/products/[id]/edit-properties.astro` | `/admin/products/[id]/edit-properties` | protected operational, dynamic | yes | product editor | preserve; source guard verified |
| `admin/products/[id]/edit.astro` | `/admin/products/[id]/edit` | protected operational, dynamic | yes | product editor | preserve; source guard verified |
| `admin/products/index.astro` | `/admin/products` | protected operational | yes | product operations | preserve |
| `admin/products/new.astro` | `/admin/products/new` | protected operational | yes | product editor | preserve |
| `admin/quotes/index.astro` | `/admin/quotes` | protected operational | yes | quote operations | preserve |
| `admin/recommendations/analytics.astro` | `/admin/recommendations/analytics` | protected operational | yes | recommendation analytics | preserve |
| `admin/recommendations/index.astro` | `/admin/recommendations` | protected operational | yes | recommendation operations | preserve |
| `admin/recommendations/preview.astro` | `/admin/recommendations/preview` | protected operational | yes | recommendation preview | preserve |
| `admin/recommendations/rules/[id].astro` | `/admin/recommendations/rules/[id]` | protected operational, dynamic | yes | recommendation rules | preserve; source guard verified |
| `admin/recommendations/rules/index.astro` | `/admin/recommendations/rules` | protected operational | yes | recommendation rules | preserve |
| `admin/recommendations/rules/new.astro` | `/admin/recommendations/rules/new` | protected operational | yes | recommendation rule editor | preserve |
| `admin/release-readiness.astro` | `/admin/release-readiness` | protected operational | no | release readiness/Control Tower | add route guard |
| `admin/reports/index.astro` | `/admin/reports` | protected operational | yes | admin reports | preserve |
| `admin/roles/index.astro` | `/admin/roles` | protected operational | yes | role administration | preserve |
| `admin/settings/index.astro` | `/admin/settings` | protected operational | yes | admin settings | preserve |
| `admin/support/index.astro` | `/admin/support` | protected operational | yes | support operations | preserve |
| `admin/system/index.astro` | `/admin/system` | protected operational | yes | system operations | preserve |
| `admin/users/index.astro` | `/admin/users` | protected operational | yes | user administration | preserve |
| `admin/utm-builder/index.astro` | `/admin/utm-builder` | protected operational | yes | operator UTM tools | preserve |
| `admin/verification/index.astro` | `/admin/verification` | protected operational | yes | verification operations | preserve |

Inventory result: 49 Astro pages, one explicitly public route, 48 protected operational routes, six dynamic routes, and exactly five missing guards. The same existing route-level guard applies safely, so no shared helper, middleware, auth rewrite, or RBAC change is required.
