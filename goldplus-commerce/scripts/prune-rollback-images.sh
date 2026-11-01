#!/usr/bin/env bash
# Keeps the newest N rollback images per service and removes the rest.
# Runs ON the production host; deploy-prod.sh calls it after a healthy roll.
#
#   ./scripts/prune-rollback-images.sh [keep=10]
#
# deploy-prod.sh tags rollback-<sha> (and rollback-pre-<sha>) for api and web
# on every deploy and never removed any: 286 had accumulated and the host
# reached 100% disk on 2026-09-18. Never removed: an image a container is
# using, or the image tagged :latest. Only rollback-* tags are touched;
# `docker rmi <repo:tag>` untags, and the layers go only when nothing else
# references them.
set -euo pipefail
KEEP="${1:-10}"
IN_USE=$(docker ps -a --format '{{.Image}}' | xargs -r docker inspect -f '{{.Id}}' 2>/dev/null | sort -u)
removed=0
for repo in goldplus-commerce-api goldplus-commerce-web; do
  LATEST=$(docker image inspect -f '{{.Id}}' "$repo:latest" 2>/dev/null || true)
  # newest first
  mapfile -t TAGS < <(docker images "$repo" --format '{{.CreatedAt}}|{{.Tag}}|{{.ID}}' | grep '|rollback-' | sort -r)
  i=0
  for row in "${TAGS[@]}"; do
    i=$((i+1))
    [ "$i" -le "$KEEP" ] && continue
    tag=$(echo "$row" | cut -d'|' -f2)
    id=$(docker image inspect -f '{{.Id}}' "$repo:$tag" 2>/dev/null || true)
    [ -z "$id" ] && continue
    if [ "$id" = "$LATEST" ] || echo "$IN_USE" | grep -qx "$id"; then continue; fi
    docker rmi "$repo:$tag" >/dev/null 2>&1 && removed=$((removed+1)) || true
  done
done
docker image prune -f >/dev/null 2>&1 || true
echo "rollback images pruned: $removed (kept newest $KEEP per service)"
