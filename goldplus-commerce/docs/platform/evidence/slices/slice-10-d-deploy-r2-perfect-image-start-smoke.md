# Slice 10-D DEPLOY R2 PERFECT image-start smoke

Before any service recreation, `scripts/verify-api-image-start-smoke.sh` ran against the newly built `goldplus-commerce-api` image and returned `API_IMAGE_START_SMOKE_PASS`.

The ephemeral smoke used `NODE_ENV=test`, a read-only root filesystem, temporary `/tmp`, and `--network none`. It verified the compiled env and shared-package artifacts, started the plain-Node API entrypoint, and required internal `/health/live` HTTP `200`. Cleanup succeeded with zero smoke containers remaining. It had no production database, Redis, provider, customer, secret, or public-port access.
