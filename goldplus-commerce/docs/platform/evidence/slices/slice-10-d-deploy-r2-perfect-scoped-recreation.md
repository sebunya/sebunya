# Slice 10-D DEPLOY R2 PERFECT scoped recreation

After all gates passed, the only recreation command was `docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-deps api web`. It recreated two API replicas and two web replicas only.

New API container IDs are `2d37edb10aad` and `c106a2e04e0d`; both run image `sha256:cf71d3afae13` and became healthy. New web IDs are `12f8726e1ded` and `698e0b8c9330`; both run `sha256:d9cb7260446a` and became healthy. All four have zero restarts.

No Caddy, PostgreSQL, Redis, database, migration, or other Compose service command ran.

The initial health window did not remain stable: both new API replicas later exited after an unhandled database-client runtime rejection. The fresh rollback tags were immediately restored through the same API/web-only recreation command. Rolled-back API IDs are `f1b7c7d33c52` and `c0d47bc28572` on `sha256:4057585542b5`; rolled-back web IDs are `a1ae06ddede9` and `a33c8df9cd26` on `sha256:2caef4d600a6`. All four rollback replicas are healthy with zero restarts.
