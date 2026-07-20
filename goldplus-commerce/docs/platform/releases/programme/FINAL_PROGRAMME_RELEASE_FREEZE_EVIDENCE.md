# Final programme release freeze evidence

Decision: `MANIFEST_BOUND_CANDIDATE_FROZEN_NOT_DEPLOYED`

Release ID: `goldplus-programme-682384b2-m0048-b79a4de7`

Executable commit: `682384b2a862e86ce3a14f4f5a875506f4a9d33f`

Evidence head: `06b1fee26eab1b0a208c28ce82a8d4934be9b3b1`

Canonical scope SHA-256: `b79a4de78f66ccc25cf58d5a319ddf8a99ec240148f32eb9dc854d5de15ee261`

## Exact-source verification

- Isolated worktree: detached, clean and fixed at the executable commit.
- Executable tree: `1d54cc2d840d7683ca6fa14db79f7138de0983fb`.
- Source archive SHA-256: `9f775e704b51a2de3a16f2606f049be09f350e0c381dab46bd1396fc61b106e2`.
- Application archive SHA-256: `d202a6ae6c7d6f208474646a1d8e78952c5fc02d971ad7fd5336d9f85b7bee38`.
- Secret scan: pass, 1,235 files.
- Typecheck and API/web source builds: pass.
- Full suite: pass, 216 files / 4,129 tests.
- Architecture suite: pass, 10/10.
- Changed-path lint: pass, zero errors.
- Repository lint: pre-existing unrelated `apps/api/src/application/ports/ICustomerDnaRepository.ts:6` baseline only.
- `git diff --check`: pass.

## Migration verification

- Fresh replay: migrations `0000`–`0048`, 49 journal rows, all expected additive objects, zero business rows and dormant new engines.
- Populated upgrade: representative catalogue, prices, orders, order lines, payments, consent, Customer DNA, Inventory, fulfilment, measurement and audit data preserved through `0048`.
- Post-upgrade checks: no orphan rows, malformed JSONB or duplicate idempotency keys; new module tables empty and dormant.
- Production remains at the read-only baseline of 29 journal rows. No live migration was run.

## Exact image verification

Both images were built from the unchanged isolated executable worktree with the tracked Dockerfiles, pinned `node:20-alpine` digest and `pnpm@9.1.4`. The API image completed in the isolated linux/amd64 BuildKit path. After a host user-mode emulator defect interrupted the web build, the web image completed in an isolated full-system x86_64 builder; the defect was therefore proven unrelated to source.

| Service | Exact tag | Image ID and immutable local digest | Platform | Size |
| --- | --- | --- | --- | --- |
| API | `goldplus-commerce-api:goldplus-programme-682384b2-m0048-b79a4de7` | `sha256:e5d00dcfa580435f849305408f013ca26dbe76a6a4b97d4265c8ce814be918e1` | `linux/amd64` | 115,836,215 bytes |
| Web | `goldplus-commerce-web:goldplus-programme-682384b2-m0048-b79a4de7` | `sha256:885687927458167b3b472d9f36dd9d8360480fee2fd0a3e74f9950daeee6fb5f` | `linux/amd64` | 145,707,987 bytes |

Verified labels on both images:

- `org.opencontainers.image.revision=682384b2a862e86ce3a14f4f5a875506f4a9d33f`
- `org.opencontainers.image.version=goldplus-programme-682384b2-m0048-b79a4de7`
- `com.goldplus.evidence-head=06b1fee26eab1b0a208c28ce82a8d4934be9b3b1`
- `com.goldplus.migration-ceiling=0048`
- `com.goldplus.service=api|web` as applicable.

The API plain-Node smoke and web start/health smoke each passed with network disabled, a read-only root filesystem and automatic cleanup. Residual smoke containers: zero.

Resolved Compose validation passed without interpolation. Validation output: 405 lines; SHA-256 `bc32cdf13fb1b83ea52f4c9ecf83f21608edddeb882defb94ff591309b6b2c98`.

## Production boundary

All production work during the review and freeze was read-only. No release approval marker was created or modified. No deployment lock, source preservation, backup, rollback tag, source fast-forward, live migration, service recreation, provider action or customer communication occurred.
