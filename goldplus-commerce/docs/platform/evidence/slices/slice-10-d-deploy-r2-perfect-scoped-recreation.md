# Slice 10-D DEPLOY R2 PERFECT scoped recreation

After all gates passed, the only recreation command was `docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-deps api web`. It recreated two API replicas and two web replicas only.

New API container IDs are `2d37edb10aad` and `c106a2e04e0d`; both run image `sha256:cf71d3afae13` and became healthy. New web IDs are `12f8726e1ded` and `698e0b8c9330`; both run `sha256:d9cb7260446a` and became healthy. All four have zero restarts.

No Caddy, PostgreSQL, Redis, database, migration, or other Compose service command ran.
