#!/usr/bin/env bash
# Production roll. Runs ON the production host. Halts the moment any step
# fails — in particular, a fetch/merge that silently leaves HEAD where it was.
# A rollback tag that equals the previous deploy's SHA means the merge did not
# happen; this script refuses to build in that case.
#   ./scripts/deploy-prod.sh <expected-sha> [services...]
set -euo pipefail
# bash reads a script as it runs. The ff-merge below replaces THIS file, so a
# deploy that changes deploy-prod.sh finishes on a mix of old and new lines
# (2026-10-06: the roll that shipped sequential audits still launched them
# the old way). Run from a private copy; the next deploy sees the new file.
if [ -z "${GOLDPLUS_DEPLOY_SELF:-}" ]; then
  SELF="$(mktemp /tmp/deploy-prod.XXXXXX.sh)"; cp "$0" "$SELF"; chmod +x "$SELF"
  GOLDPLUS_DEPLOY_SELF=1 exec bash "$SELF" "$@"
fi
trap 'rm -f "$0"' EXIT
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
# --relative: this checkout is a nested directory of the repository, so without
# it git prints "goldplus-commerce/Caddyfile" and the exact match below never
# fired (found 2026-09-13: a Caddyfile change rolled without recreating Caddy).
if git diff --name-only --relative "$PREV" HEAD | grep -qx Caddyfile; then
  docker compose --env-file .env.production -f docker-compose.production.yml up -d --force-recreate --no-deps caddy 2>&1 | tail -1
  sleep 5
  docker compose --env-file .env.production -f docker-compose.production.yml exec -T caddy caddy validate --config /etc/caddy/Caddyfile 2>&1 | grep -q 'Valid configuration' || { echo "STOP: Caddyfile invalid after recreate"; exit 1; }
  echo "Caddy recreated for the new Caddyfile"
fi
# A failed build used to print only its LAST line — blank — and the roll died
# silently (38ce4a3b, 2026-09-26: an Astro template error tsc cannot see).
BUILD_LOG=/var/log/goldplus/build-$HEAD.log; mkdir -p /var/log/goldplus
if ! docker compose --env-file .env.production -f docker-compose.production.yml build $SERVICES > "$BUILD_LOG" 2>&1; then
  echo "STOP: image build failed for [$SERVICES] at $HEAD — last 40 lines of $BUILD_LOG:"; tail -40 "$BUILD_LOG"; exit 1
fi
tail -1 "$BUILD_LOG"
docker compose --env-file .env.production -f docker-compose.production.yml up -d $SERVICES 2>&1 | tail -1
N=$(echo $SERVICES | wc -w); WANT=$((N*2))
# Bounded wait. This loop had no timeout: a replica that never reports
# healthy (or a service with no healthcheck at all — caddy has none) would
# hang the deploy forever with the old containers already replaced.
# "(healthy)" in brackets: a bare `.*healthy` also matched "(unhealthy)", so a
# release whose healthcheck failed was declared healthy and tagged as rollback.
DEADLINE=$(( $(date +%s) + ${HEALTH_TIMEOUT_SECONDS:-600} ))
until [ "$(docker compose --env-file .env.production -f docker-compose.production.yml ps --format '{{.Name}} {{.Status}}' | grep -cE "($(echo $SERVICES | tr ' ' '|'))-[12] Up .*\(healthy\)")" -ge "$WANT" ]; do
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "STOP: $WANT healthy replicas of [$SERVICES] not reached within ${HEALTH_TIMEOUT_SECONDS:-600}s. Inspect with: docker compose ps; roll back with the rollback-$(git rev-parse --short "$PREV") image if needed."
    docker compose --env-file .env.production -f docker-compose.production.yml ps --format '{{.Name}} {{.Status}}' | grep -E "($(echo $SERVICES | tr ' ' '|'))"
    exit 1
  fi
  sleep 5
done
for s in $SERVICES; do docker tag "goldplus-commerce-$s:latest" "goldplus-commerce-$s:rollback-$HEAD"; done
echo "DEPLOYED $HEAD, $WANT/$WANT healthy, tagged rollback-$HEAD"
# Rollback images accumulated without limit (286, disk full 2026-09-18).
# Keep the newest 10 per service; never fails the deploy.
[ -x scripts/prune-rollback-images.sh ] && { scripts/prune-rollback-images.sh 2 || true; }
# Build cache: every deploy left 2-8 GB behind; the disk reached 97% on
# 2026-09-20 after a day of deploys. Cache older than a day is dropped (the
# next build is slower, never wrong). Never fails the deploy.
docker builder prune -f --filter until=24h >/dev/null 2>&1 || true
# The age filter alone never bounds a busy day: every layer built today is
# younger than 24h, so six deploys on 2026-10-06 added 6.2 GB and the cache
# reached 21.3 GB (disk 68%) before the Steward's nightly trim. Cap it by size
# too, at the Steward's bound (policy.yaml docker.build_cache_max_gb), with the
# same flag detection: Docker 29 removed --keep-storage, and an unknown flag
# fails silently under `|| true`. Least-recently-used cache goes first, so the
# layers this deploy just used stay warm.
CACHE_CAP_GB="${BUILD_CACHE_MAX_GB:-2}"
CACHE_FLAG=""
# Read the help once into a variable. Piping it into `grep -q` is unsafe
# under `set -o pipefail`: grep can exit on the first match, docker then
# dies of SIGPIPE, the pipeline reports failure and the flag looks absent.
CACHE_HELP="$(docker builder prune --help 2>/dev/null || true)"
for f in --max-used-space --keep-storage; do
  case "$CACHE_HELP" in *"$f"*) CACHE_FLAG="$f"; break ;; esac
done
if [ -n "$CACHE_FLAG" ]; then
  # A plain byte count, exactly as the Steward passes it (proven on this host).
  if docker builder prune -f "$CACHE_FLAG" "$(( CACHE_CAP_GB * 1024 * 1024 * 1024 ))" >/dev/null 2>&1; then
    # A zero exit proves nothing about size (2026-10-06: a "successful" trim
    # left 6.7 GB against a 2 GB bound — cache still used by images stays).
    # Re-measure and say what is really there.
    echo "build cache after cap: $(docker system df --format '{{.Type}} {{.Size}}' 2>/dev/null | sed -n 's/^Build Cache //p') (bound ${CACHE_CAP_GB} GB, $CACHE_FLAG)"
  else
    echo "WARN: build cache cap ($CACHE_FLAG ${CACHE_CAP_GB} GB) failed; the Steward's nightly housekeep will retry"
  fi
else
  echo "WARN: this docker offers neither --max-used-space nor --keep-storage; build cache is bounded only by the Steward"
fi
# Post-roll measurement: the compatibility + performance smoke (control + local
# Lighthouse + the compatibility programme in smoke mode; ad-hoc label, never
# moves the ten-day clock), in the background.
# Lighthouse Watch is NOT started here any more (owner decision 2026-10-06): it
# runs weekly from a systemd timer on a fixed slot, and a deploy that started it reset its
# clock and moved the weekly run to the deploy's hour. The smoke above already
# runs Lighthouse after every roll. Manual watch: ./scripts/lighthouse-watch.sh manual
# Before that, the two started in the same second; each container may take
# 1.5 GB on a 3.7 GB host (2026-10-06: 3.5 GB asked, swap used).
# 9>&- : a background job must not inherit the deploy lock. It did, and the
# next deploy was refused for as long as the smoke ran (2026-09-18).
# Never blocks or fails the deploy.
(
  if [ -x performance-audit/schedule/run-in-container.sh ]; then
    PERF_AUDIT_ONLY="control lighthouse compatibility" COMPATIBILITY_AUDIT_MODE=smoke LIGHTHOUSE_RUNS=1 \
      performance-audit/schedule/run-in-container.sh --ad-hoc --label "post-deploy-smoke-$HEAD" \
      >> /var/log/goldplus/performance-audit-post-deploy.log 2>&1 </dev/null || true
  fi
) 9>&- &
disown 2>/dev/null || true
echo "post-deploy smoke started in the background (label post-deploy-smoke-$HEAD; results under /var/lib/goldplus-performance-audit and on /admin/seo/performance-audit); Lighthouse Watch runs weekly, Sunday 03:00 Kampala time (goldplus-lighthouse-watch.timer)"
