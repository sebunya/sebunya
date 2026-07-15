# Slice 10-D DEPLOY R2 PERFECT rollback plan

If API/web health regresses, retag the two fresh `slice-10-d-r2-perfect-20260715T171816Z` rollback tags to `goldplus-commerce-api` and `goldplus-commerce-web`, then run the scoped `docker compose ... up -d --no-deps api web` command. Do not restart Caddy, PostgreSQL, or Redis and do not touch the database.

The complete pre-deploy source is preserved at `/opt/goldplus/backups/slice-10-d-deploy-r2-perfect-source-preservation-20260715T171755Z`. Source rollback is not currently required. Any future source rollback must preserve evidence and avoid force/reset history rewriting.
