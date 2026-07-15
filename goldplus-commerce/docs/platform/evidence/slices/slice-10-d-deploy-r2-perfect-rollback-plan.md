# Slice 10-D DEPLOY R2 PERFECT rollback plan

The rollback plan was executed after the new API replicas exited during the late health window. The two fresh `slice-10-d-r2-perfect-20260715T171816Z` tags were restored to `goldplus-commerce-api` and `goldplus-commerce-web`, followed by the scoped `docker compose ... up -d --no-deps api web` command. Caddy, PostgreSQL, and Redis were not restarted and the database was not mutated.

The complete pre-deploy source is preserved at `/opt/goldplus/backups/slice-10-d-deploy-r2-perfect-source-preservation-20260715T171755Z`. Production source remains clean at the evidence head because its runtime delta is not bind-mounted into the rolled-back API/web containers. Any future source rollback or repair must preserve evidence and avoid force/reset history rewriting.
