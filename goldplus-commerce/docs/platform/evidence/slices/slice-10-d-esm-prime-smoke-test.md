# Slice 10-D ESM PRIME smoke test

The image-start smoke first verifies `/app/apps/api/dist/config/env.js`, `/app/packages/shared/dist/index.js`, and the image-local shared package `main`. It then starts the built API image as a new ephemeral container with `NODE_ENV=test`, a read-only root filesystem, temporary `/tmp`, and `--network none`.

The smoke polls `/health/live` from inside that isolated container and requires HTTP `200`. Early exit, import failure, or timeout fails the script and prints the container log. A trap removes the ephemeral container; verification found zero remaining smoke containers.

Production result: `API_IMAGE_START_SMOKE_PASS image=goldplus-commerce-api:latest network=none`. No production env file, credential, database network, provider network, Compose service, or production port was attached.
