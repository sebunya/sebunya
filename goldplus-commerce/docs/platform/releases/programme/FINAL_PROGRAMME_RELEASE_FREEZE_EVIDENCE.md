# Catalogue-parity repair release freeze evidence

Decision: `NEW_MANIFEST_BOUND_CANDIDATE_FROZEN_NOT_DEPLOYED`

Release ID: `goldplus-programme-13633d86-m0048-5c6f9d25`

Executable commit: `13633d86c808bd6fde49c47248f234b861a411bb`

Repair evidence head: `13633d86c808bd6fde49c47248f234b861a411bb`

Canonical scope SHA-256: `5c6f9d255295431821af86d9d134466361987eead46a295ce8a7c92aa970ad60`

## Exact-source verification

- Isolated worktree: detached, clean and fixed at the executable commit.
- Executable tree: `68b0ac4adc830d8be52b3f341f07032a8d84e361`.
- Source archive SHA-256: `4ba57acb9f0d455e4ea0c6abe26292b2c64a12de88b01fa82ac833567228ecd2`.
- Application tree: `7cbe8220d2675c7f914391bd4a887a77eecb1e5e`.
- Application archive SHA-256: `4d3566fc2464fb4d1140066b9e1b9015a8d13436ff94667018d2d3de873b4428`.
- Secret scan: pass, 1,237 files.
- Typecheck and API/web source builds: pass.
- Focused catalogue parity suite: pass, 12/12.
- Full suite: pass, 217 files / 4,144 tests.
- Architecture suite: pass, 10/10.
- Changed-path lint: pass with zero errors and five existing warnings in later legacy monitor code.
- Repository lint: pre-existing unrelated `apps/api/src/application/ports/ICustomerDnaRepository.ts:6` baseline only.
- `git diff --check`: pass.

## Migration and restored-production verification

- Fresh replay: migrations `0000`–`0048`, 49 journal rows, zero business rows and dormant new engines.
- Exact failed migrator populated upgrade: restored production ledger advanced from 29 to 55 historical rows without data loss.
- Restored database proof baseline: eight products, eight approved products, 13 orders totalling UGX 1,545,000, zero outbox rows, zero notification attempts and 30 consent events.
- The repair adds no migration. Production is already at the 55-row ledger target; the new release has no missing migration.
- Post-proof protected counts exactly matched the pre-proof baseline. Isolated Redis database 2 returned to zero keys.

## Exact image verification

The API release image was built from the unchanged isolated executable source on the isolated x86_64 builder. The web bundle was compiled from the same detached clean executable with the production API build-time value, then materialized into the already validated linux/amd64 runtime dependency boundary after removing the prior bundle. Both use the tracked lockfile, pinned `node:20-alpine` digest and `pnpm@9.1.4` runtime dependencies.

| Service | Exact tag | Image ID and immutable local digest | Platform | Size |
| --- | --- | --- | --- | --- |
| API | `goldplus-commerce-api:goldplus-programme-13633d86-m0048-5c6f9d25` | `sha256:259440b3d30996ec286bc53ed810f2cd3a81c6d22371f44490e792932492677f` | `linux/amd64` | 115,840,396 bytes |
| Web | `goldplus-commerce-web:goldplus-programme-13633d86-m0048-5c6f9d25` | `sha256:d339956595e6bee1c3ee1f6647633cb022ea6a42bebea93976a5e4a10b0487ee` | `linux/amd64` | 151,715,894 bytes |

Verified labels on both images:

- `org.opencontainers.image.revision=13633d86c808bd6fde49c47248f234b861a411bb`
- `org.opencontainers.image.version=goldplus-programme-13633d86-m0048-5c6f9d25`
- `com.goldplus.evidence-head=13633d86c808bd6fde49c47248f234b861a411bb`
- `com.goldplus.migration-ceiling=0048`
- `com.goldplus.service=api|web` as applicable.

The exact API plain-Node import passed with network disabled and a read-only root filesystem. The exact web image served HTTP 200 with network disabled and a read-only root filesystem. Both images exited without restart.

## Restored-data catalogue parity

- Exact compiled API connected safely through the production Drizzle/postgres-js path to the restored production database.
- Independent SQL, compiled repository, use case/DTO and API each returned five products for the exact incident request.
- Identifier SHA-256: `14c57483a91eb7b563f4f0e9ccbadf2f14b4a107bbe4565911b1fa50655b220b`.
- Identifier plus canonical-price SHA-256: `5e34628a127e93cb6d9ee432ca63e2ce64fcd2f22349edd52929dd0c1d65d4e2`.
- Cache matrix passed: cold, miss, stale empty, expired, recovered and warm.
- Eight fault injections passed, covering legitimate empty SQL, DB-positive/API-empty, missing/malformed collection, malformed response, identifier divergence, price divergence, wrong database and wrong schema.
- Two independent containers from the exact API image returned the same count and set hashes with zero restarts.
- Deterministic verdict: `CATALOGUE_PARITY_PROOF_PASS`.
- Provider call counter: zero. Protected mutation delta: zero. Redis residue: zero.

## OLD / FAILED / REPAIRED differential

| Boundary | OLD rollback image | FAILED image | REPAIRED exact image |
| --- | --- | --- | --- |
| Independent SQL | 5 products | 5 products | 5 products |
| Repository/use case/DTO | matches SQL | matches SQL | matches SQL |
| API `data` collection | 5 products | 5 products | 5 products |
| Monitor collection extraction | stale `data.items`; scheduling suppressed by production-local rollback guard | stale `data.items`; reports zero | actual `data`; matches independent truth |
| Original incident class | latent | reproduced | detected without false positive |
| Provider calls / protected writes | 0 / 0 | 0 / 0 | 0 / 0 |

The earliest mismatch was API response → monitor parser. The repair did not alter the data plane it proved.

## Storefront and replica evidence

- The exact executable web was built in production mode against the exact restored-data API and rendered the API-backed catalogue rather than its offline seed fallback.
- Rendered `data-product-id` and `data-product-price` attributes were compared with the API collection: API count 8, rendered count 8, and both identifier-plus-price hashes `b2079948219dbeb043cab5488461eb20d79e915f006041ec687141c4e39205f7`.
- Empty-state decision was false and the temporary-unavailable catalogue notice was absent.
- A separately built exact release web image retained the production API URL and passed the isolated start/HTTP smoke.
- The release gate first detected and blocked both local-seed injection and the legacy-slug denylist override; the final executable contains neither override on a populated API response.
- The two API replica observations used the same exact compiled API boundary, independent container IDs, the restored database and isolated Redis; response sets matched.

## Production and approval boundary

Production work during incident reconstruction, repair and freeze was read-only. No production lock, source preservation, backup, rollback tag, source fast-forward, migration, service recreation, temporary container, provider action or customer communication occurred.

The failed release marker is consumed. It does not authorize this new release and Codex did not create, modify or remove it. The new release requires the operator-created release-bound marker defined in the manifest and runbook, but that handoff is prohibited until the consumed prior marker is absent.
