# Caddy Runtime Validation Runbook

This runbook closes the remaining Pass 2 validation gap without deploying, restarting production, running migrations, or changing application code.

Pass 2 remains blocked until the production Caddy image validates the current `Caddyfile`.

## Current Blocker

- Docker client is installed locally.
- Active Docker context observed during Pass 2C: `default`.
- Docker socket attempted during Pass 2C: `unix:///var/run/docker.sock`.
- Docker daemon was not reachable: `failed to connect to the docker API at unix:///var/run/docker.sock: connect: no such file or directory`.
- Colima is installed at `/opt/homebrew/bin/colima`.
- Colima was not running.
- `colima start` failed because `qemu-img` was missing.

Local unblock command:

```bash
brew install qemu
colima start
docker info
```

## Safety Rules

Do not run these commands during validation:

```bash
docker compose up
docker compose down
```

Do not deploy, restart production containers, run migrations, edit environment files, install dependencies, or change application code during this validation.

## Expected Production Caddy Configuration

Validate against the Caddy image configured in `docker-compose.production.yml`.

Current expected values:

| Item | Expected value |
| --- | --- |
| Caddy image | `caddy:2-alpine` |
| Caddyfile mount | `./Caddyfile:/etc/caddy/Caddyfile:ro` |
| Fallback mount | `./ops/caddy-fallback:/srv/caddy-fallback:ro` |
| Certificate data volume | `caddy_data:/data` |
| Certificate config volume | `caddy_config:/config` |

If the compose file changes, use the actual image and mount paths from the compose file.

## Path A - Local Mac Validation

First unblock local Docker if needed:

```bash
brew install qemu
colima start
docker info
```

Then run the non-destructive validation sequence from the repository root:

```bash
docker version
docker context ls
docker info

docker run --rm \
  -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$PWD/ops/caddy-fallback:/srv/caddy-fallback:ro" \
  caddy:2-alpine \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

test -f ops/caddy-fallback/maintenance.html
test -r ops/caddy-fallback/maintenance.html

docker compose -f docker-compose.production.yml config
```

After successful Caddy validation, run the non-destructive quality gates:

```bash
pnpm run typecheck
pnpm test:architecture
pnpm test
pnpm run build
pnpm test:unit
```

## Path B - Hetzner Server Validation

Use this path only when SSH or console access to the Hetzner server is available.

This is a validation flow, not a deployment flow. It must not restart production containers.

```bash
cd /opt/goldplus/goldplus-commerce
# or the actual production repo path

docker version
docker info

docker run --rm \
  -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$PWD/ops/caddy-fallback:/srv/caddy-fallback:ro" \
  caddy:2-alpine \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

test -f ops/caddy-fallback/maintenance.html
test -r ops/caddy-fallback/maintenance.html

docker compose -f docker-compose.production.yml config
```

Optional read-only live checks after validation:

```bash
curl -I https://shopgoldplus.com
curl -I https://www.shopgoldplus.com
curl -I https://api.shopgoldplus.com/health/live
curl -I https://api.shopgoldplus.com/health/ready
curl -I https://metrics.shopgoldplus.com/healthy
curl -Iv https://shopgoldplus.com
```

These are live checks only. They are not deployment commands and do not restart services.

## What Passing Validation Proves

If `caddy validate` passes, we can claim:

- The Caddyfile syntax is valid under `caddy:2-alpine`.
- The fallback mount path used for validation matches the expected Compose path.
- The fallback file exists and is readable.
- Compose topology remains statically valid when `docker compose -f docker-compose.production.yml config` passes.

## What Passing Validation Does Not Prove

Do not claim these unless they are separately smoke-tested:

- Caddy fallback works during an actual web container outage.
- API JSON fallback works during an actual API container outage.
- Production SSL renewal has succeeded.
- Production is fully recovered.

## Pass/Fail Decision Table

| Condition | Decision | Next action |
| --- | --- | --- |
| Docker unavailable | Pass 2 remains blocked. | Fix Docker/Colima locally or run validation on Hetzner. |
| Caddy validation fails | Do not deploy. | Fix only `Caddyfile` or fallback path, then rerun validation. |
| Caddy validation passes but compose config fails | Do not deploy. | Fix compose syntax/topology, then rerun validation. |
| Caddy validation and compose config pass | Pass 2C can close. | Pass 3 can be considered for approval. |
| Live checks fail on Hetzner | Treat as infrastructure incident. | Inspect Docker stack and Caddy logs before any code change. |

## Final Report Checklist

Record:

- Docker runtime status.
- Docker context.
- Caddy image validated.
- Exact Caddy validation command.
- Validation result.
- Fallback path result.
- Compose topology result.
- Final port exposure table.
- What was proven.
- What was not proven.
- Remaining risks.
- Whether Pass 2 remains blocked or Pass 2C can close.
- Whether Pass 3 can be considered for approval.
