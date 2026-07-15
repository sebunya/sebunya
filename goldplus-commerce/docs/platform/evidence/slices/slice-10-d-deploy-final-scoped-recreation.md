# Slice 10-D DEPLOY FINAL scoped recreation

Only API and web were recreated with `docker compose ... up -d --no-deps api web`. Caddy, PostgreSQL, and Redis were outside the command.

Both new web replicas became healthy. Both new API replicas repeatedly exited with code 1. Their startup logs reported Node `ERR_MODULE_NOT_FOUND` for `/app/apps/api/dist/config/env`, imported by `/app/apps/api/dist/interfaces/http/server.js`.

The health hard gate triggered immediate rollback. Fresh rollback tags were retagged to the Compose image names and API/web alone were recreated again. The restored API and web replicas all became healthy on the exact pre-deploy images.
