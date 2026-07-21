# Catalogue-parity repair release review gate

Decision: `PASS_TO_NEW_MANIFEST_FREEZE`

Verified Git root: `/Users/robertsebunya/Documents/GitHub_Projects/goldplus-commerce-next-phase-c1925dbd`

Verified application root: `/Users/robertsebunya/Documents/GitHub_Projects/goldplus-commerce-next-phase-c1925dbd/goldplus-commerce`

Verified branch: `phase-2-measurement-control-tower-completion`

Verified repair executable and origin head before release-document work: `13633d86c808bd6fde49c47248f234b861a411bb`

## Incident boundary

- Failed release: `goldplus-programme-682384b2-m0048-b79a4de7`; it is rejected for reuse.
- Production rollback source: clean `c9ce093e73913d47eed6255e33fe240c7753de2d`.
- Production rollback images: API `sha256:4057585542b53b35265d7ab702ecd233048ee47ec3dcaa75a5dd204e011d8638`; web `sha256:2caef4d600a6974c471b95ceb670bd662c066f1c4c1a45c40bf81c27ec4f8ea9`.
- Failed images: API `sha256:784647e9f178a9fd5d34093aae99a9aa590701b82bb791ccd2c19977995e69b7`; web `sha256:331c9432d5b94e00c97b7abf494b6cdebf30a4ad2dba27a34a0f86ce023f67af`.
- Production rollback health, source cleanliness, container identities, migration ledger, commerce counts and no-send counters were verified read-only.
- Forensic artefacts were preserved outside the repository before repair work, including the production database backup, failed/rollback image archives, logs and deployment-attempt evidence.

## Classification and first divergence

- Classification: `A_SYNTHETIC_MONITOR_REQUEST_OR_PARSER_DEFECT`.
- Independent SQL, compiled repository, use case/DTO and `GET /products?limit=5` all returned the same five products from the restored production database.
- The API contract is `ApiResponse<ProductPublicDto[]>`, with the collection at response path `data`.
- The failed monitor extracted `catalogData?.data?.items || []`; it therefore converted a valid populated response into an empty set.
- The first divergent boundary was API response → synthetic monitor parser. There was no catalogue repository, DTO, API, database, migration, cache or product-data defect.
- The failed release crossed the rollback threshold because the scheduled monitor reported `Catalog returned zero products`; the public API remained populated and HTTP 200.

## Smallest repair

- Repair executable: `13633d86c808bd6fde49c47248f234b861a411bb`.
- The repair changes only the catalogue parity monitor, its read-only proof, focused unit tests and incident evidence.
- The monitor now compares an independent SQL truth set with the actual API contract and emits deterministic reason codes, database/schema fingerprint checks, identifier hashes, canonical-price hashes and first-divergence evidence.
- The mandatory storefront gate separately proved that `getCleanCatalog` injected all 21 local seeds into a successful eight-product API response. The repair now keeps live API data authoritative and uses local seeds only as the existing unavailable/empty fallback.
- Focused storefront tests prove populated-API authority and empty-API fallback; the exact compiled web must match restored API identifiers and prices before freeze.
- No migration, repository, catalogue use case, DTO, route, storefront, business-state, provider, checkout, payment, order, Inventory or fulfilment implementation changed.

## Exact executable verification

- Detached clean worktree fixed at `13633d86c808bd6fde49c47248f234b861a411bb`.
- Git tree: `68b0ac4adc830d8be52b3f341f07032a8d84e361`.
- Deterministic source archive SHA-256: `4ba57acb9f0d455e4ea0c6abe26292b2c64a12de88b01fa82ac833567228ecd2`.
- Application tree: `7cbe8220d2675c7f914391bd4a887a77eecb1e5e`.
- Application archive SHA-256: `4d3566fc2464fb4d1140066b9e1b9015a8d13436ff94667018d2d3de873b4428`.
- Focused parity tests: 12/12 pass.
- Full suite: 217 files / 4,144 tests pass.
- Architecture: 10/10 pass.
- Typecheck, API/web builds and secret scan (1,237 files): pass.
- Changed-path lint: zero errors; existing warnings only.
- Repository lint remains the pre-existing unrelated `apps/api/src/application/ports/ICustomerDnaRepository.ts:6` baseline.
- Fresh migration replay: 49 journal rows through `0048`, zero business rows.
- Restored-production proof: 55 ledger rows, eight approved products, 13 orders totalling UGX 1,545,000, zero outbox rows and zero notification attempts.

## New release boundary

- Release ID: `goldplus-programme-13633d86-m0048-5c6f9d25`.
- Release token: `13633d86-m0048-5c6f9d25`.
- Canonical scope SHA-256: `5c6f9d255295431821af86d9d134466361987eead46a295ce8a7c92aa970ad60`.
- Canonicalization recursively sorts object keys, preserves array order and serializes without whitespace. The scope excludes its own hash, approval token/path and mutable timestamps.
- Migration ceiling remains `0048`; production already has all 55 historical ledger rows, so no live migration is expected for this repair.
- Exact linux/amd64 release images were built from the isolated executable boundary and are recorded in the manifest and freeze evidence.
- Production access during incident review and freeze remained read-only. No lock, backup, rollback tag, source fast-forward, live migration, service recreation, provider action or customer communication occurred.

## Approval boundary

- The failed release approval marker is consumed and cannot authorize this release.
- Codex must not create, modify, replace or remove any approval marker.
- The consumed marker `/root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_682384b2-m0048-b79a4de7` must be absent before the new operator approval handoff can be issued.
- The new marker, when independently created by the operator, is `/root/APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_13633d86-m0048-5c6f9d25` with exact one-line content `APPROVE_GOLDPLUS_PROGRAMME_DEPLOY_13633d86-m0048-5c6f9d25` and the controller-required root-only metadata.
