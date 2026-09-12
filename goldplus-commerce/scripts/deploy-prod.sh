#!/usr/bin/env bash
# Production roll. Runs ON the production host. Halts the moment any step
# fails — in particular, a fetch/merge that silently leaves HEAD where it was.
# A rollback tag that equals the previous deploy's SHA means the merge did not
# happen; this script refuses to build in that case.
#   ./scripts/deploy-prod.sh <expected-sha> [services...]
set -euo pipefail
EXPECTED="${1:?expected short sha}"; shift; SERVICES="${*:-api web}"
cd /opt/goldplus/app/goldplus-commerce
# ONE deploy at a time. On 2026-09-12 two invocations started seven seconds
# apart and ran two full `docker compose build api` on the 2-vCPU host: load
# reached 77, swap filled, and the public site timed out for over a minute.
# A second invocation must fail immediately, not queue and not race.
exec 9>/tmp/goldplus-deploy.lock
flock -n 9 || { echo "STOP: another deploy-prod.sh is already running (lock /tmp/goldplus-deploy.lock)"; exit 1; }
PREV="$(git rev-parse HEAD)"
# Preserve the images that are RUNNING RIGHT NOW under an unambiguous name,
# before anything is fetched or built. The rollback-<sha> tag written at the
# end of a roll names the image just built (its own sha), so the previous
# runtime was only reachable through the previous roll having done the same.
# This makes the pre-mutation runtime recoverable even if that chain is broken.
for s in $SERVICES; do
  IMG="$(docker inspect -f '{{.Image}}' "goldplus-commerce-$s-1" 2>/dev/null || true)"
  [ -n "$IMG" ] && docker tag "$IMG" "goldplus-commerce-$s:rollback-pre-$(git rev-parse --short "$PREV")"
done
git fetch origin deploy/price-floor-145k -q
git merge --ff-only FETCH_HEAD -q
HEAD="$(git rev-parse --short HEAD)"
[ "$HEAD" = "$EXPECTED" ] || { echo "STOP: HEAD is $HEAD, expected $EXPECTED — merge did not land"; exit 1; }
# The Caddyfile is a SINGLE-FILE bind mount: git replaces it by rename, so the
# running container keeps the old inode and `caddy reload` re-reads stale text.
# Only a recreate picks the new file up (seconds of edge downtime; certs persist).
if git diff --name-only "$PREV" HEAD | grep -qx Caddyfile; then
  docker compose --env-file .env.production -f docker-compose.production.yml up -d --force-recreate --no-deps caddy 2>&1 | tail -1
  sleep 5
  docker compose --env-file .env.production -f docker-compose.production.yml exec -T caddy caddy validate --config /etc/caddy/Caddyfile 2>&1 | grep -q 'Valid configuration' || { echo "STOP: Caddyfile invalid after recreate"; exit 1; }
  echo "Caddy recreated for the new Caddyfile"
fi
docker compose --env-file .env.production -f docker-compose.production.yml build $SERVICES 2>&1 | tail -1
docker compose --env-file .env.production -f docker-compose.production.yml up -d $SERVICES 2>&1 | tail -1
N=$(echo $SERVICES | wc -w); WANT=$((N*2))
# Bounded wait. This loop had no timeout: a replica that never reports
# healthy (or a service with no healthcheck at all — caddy has none) would
# hang the deploy forever with the old containers already replaced.
DEADLINE=$(( $(date +%s) + ${HEALTH_TIMEOUT_SECONDS:-600} ))
until [ "$(docker compose --env-file .env.production -f docker-compose.production.yml ps --format '{{.Name}} {{.Status}}' | grep -cE "($(echo $SERVICES | tr ' ' '|'))-[12] .*healthy")" -ge "$WANT" ]; do
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "STOP: $WANT healthy replicas of [$SERVICES] not reached within ${HEALTH_TIMEOUT_SECONDS:-600}s. Inspect with: docker compose ps; roll back with the rollback-$(git rev-parse --short "$PREV") image if needed."
    docker compose --env-file .env.production -f docker-compose.production.yml ps --format '{{.Name}} {{.Status}}' | grep -E "($(echo $SERVICES | tr ' ' '|'))"
    exit 1
  fi
  sleep 5
done
for s in $SERVICES; do docker tag "goldplus-commerce-$s:latest" "goldplus-commerce-$s:rollback-$HEAD"; done
echo "DEPLOYED $HEAD, $WANT/$WANT healthy, tagged rollback-$HEAD"
