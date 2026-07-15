# Slice 10-D ESM PRIME failure review

The Slice 10-D DEPLOY FINAL API replicas exited with code 1. Node reported `ERR_MODULE_NOT_FOUND` for `/app/apps/api/dist/config/env`, imported from `/app/apps/api/dist/interfaces/http/server.js`. The built image did contain `/app/apps/api/dist/config/env.js`, so this was not an omitted-file or incomplete-copy failure.

The failed compiled server used an extensionless ESM import for `../../config/env`. The API compiler used `module: ESNext` with `moduleResolution: Bundler`, while the image started the output with plain Node. The healthy rollback image instead ran `npx tsx apps/api/src/interfaces/http/server.ts`, which explains why it did not exercise the broken compiled-runtime contract.

No secret or environment-file value was inspected or recorded.
