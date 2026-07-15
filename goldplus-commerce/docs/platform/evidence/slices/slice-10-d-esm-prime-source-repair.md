# Slice 10-D ESM PRIME source repair

Source repair commit: `ec300f6f16e16ab50bd1a116a13a4c2b1ad6ca48`.

`apps/api/tsconfig.json` now emits CommonJS with Node module resolution. `Dockerfile.api` compiles `packages/shared`, retains the normal API build, and rewrites only the copied image package metadata so `@goldplus/shared` resolves `dist/index.js` under plain Node. The repository package metadata remains unchanged for local TypeScript tooling.

`scripts/verify-api-image-start-smoke.sh` and `tests/unit/Slice10DESMPrimeApiRuntimePackaging.test.ts` provide the runtime packaging guard. The compiled server contains a resolvable CommonJS load of `../../config/env`, and `dist/config/env.js` remains present.
