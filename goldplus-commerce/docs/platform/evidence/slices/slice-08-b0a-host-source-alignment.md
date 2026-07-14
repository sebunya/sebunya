# Slice 8-B0A — Host Source Alignment

Date: 2026-07-14 (Africa/Kampala)

## Approved source of truth

- Branch: `phase-2-measurement-control-tower-completion`
- Local HEAD before commit: `073f6dbdd9ac9c068c1ceebf88dd700fd82b33b1`
- Origin before commit: `073f6dbdd9ac9c068c1ceebf88dd700fd82b33b1`
- Preserved local changes match the expected Slice 8-B0 artifact exactly.

Both authorized alignment files are tracked and unchanged in HEAD:

| File | Local SHA-256 before alignment | Host state before alignment |
| --- | --- | --- |
| `apps/web/src/utils/api-fetch.ts` | `346224d76ddbba0663f8f7ca87879e5ef0dd4376b20d39c461ce40727b593892` | absent |
| `apps/web/src/utils/date-format.ts` | `10d0ad9866046c66de5fa528b6b3daeaa1f2ac27db3b7a9c04f6d1167273fbaa` | absent |

Production host Git metadata reported `f69aa6e038fb1bd0964a1cf0cdb6e6ee0208a751`, which is not used as release truth. No pull, reset, merge, checkout or broad source synchronization is authorized or performed.

## Alignment contract

Only the two exact tracked utility files above may be copied to the host. They are followed by only the six already-tested guarded routes under `apps/web/src/pages/admin/measurement/**`. Every host file must match its local SHA-256 value before the production web build starts.

No dependency, lockfile, auth/RBAC contract, API, Measurement transport/destination/provider behavior, checkout/payment, recommendation, loyalty, queue or customer communication is changed.

## Results

- Backup: `/opt/goldplus/backups/slice-08-b0a-20260714T160333Z`.
- The backup records both utilities as absent and preserves all six prior route files plus restricted production configuration copies.
- Host `api-fetch.ts` checksum after alignment: `346224d76ddbba0663f8f7ca87879e5ef0dd4376b20d39c461ce40727b593892`.
- Host `date-format.ts` checksum after alignment: `10d0ad9866046c66de5fa528b6b3daeaa1f2ac27db3b7a9c04f6d1167273fbaa`.
- All six guarded route checksums matched local source before the build.
- The host web image built successfully; no additional missing or drifting dependency appeared.
- Local focused suites passed 193/193 tests; secret scan, typecheck, warning-only lint, build and full suite passed.
- Full suite: 138 files and 879 tests passed.
- Only `goldplus-commerce-web-1` and `goldplus-commerce-web-2` were recreated; both became healthy.
- Both API replicas retained their prior creation timestamps and healthy state.
- All six logged-out Measurement URLs returned `303`, including the dynamic live-review detail route, and every response contained zero protected markers.
- Public journey and checkout smoke passed; two real PDP recommendation rails retained uniqueness, current-product exclusion and honest labels.

Decision: exact host source alignment and the narrow admin protection deployment succeeded without broad synchronization or behavior changes.
