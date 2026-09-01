#!/usr/bin/env bash
# Production roll. Runs ON the production host. Halts the moment any step
# fails — in particular, a fetch/merge that silently leaves HEAD where it was.
# A rollback tag that equals the previous deploy's SHA means the merge did not
# happen; this script refuses to build in that case.
#   ./scripts/deploy-prod.sh <expected-sha> [services...]
set -euo pipefail
EXPECTED="${1:?expected short sha}"; shift; SERVICES="${*:-api web}"
cd /opt/goldplus/app/goldplus-commerce
PREV="$(git rev-parse HEAD)"
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
until [ "$(docker compose --env-file .env.production -f docker-compose.production.yml ps --format '{{.Name}} {{.Status}}' | grep -cE "($(echo $SERVICES | tr ' ' '|'))-[12] .*healthy")" -ge "$WANT" ]; do sleep 5; done
for s in $SERVICES; do docker tag "goldplus-commerce-$s:latest" "goldplus-commerce-$s:rollback-$HEAD"; done
echo "DEPLOYED $HEAD, $WANT/$WANT healthy, tagged rollback-$HEAD"
