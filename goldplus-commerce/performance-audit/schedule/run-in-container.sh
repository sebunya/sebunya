#!/usr/bin/env bash
# Runs the audit inside the Playwright image already present on the host
# (node + python3 + Chromium; no node on the host itself). Mounts:
#   the repository checkout (read-only code, writable node_modules volume),
#   the durable data dir, the docker socket (k6 canary runs as a sibling container).
# Called by the systemd service and by operators:  schedule/run-in-container.sh [args for run_safe_recurring.sh]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${PERF_AUDIT_IMAGE:-mcr.microsoft.com/playwright:v1.61.1-noble}"
DATA_DIR="${PERF_AUDIT_DATA_DIR:-/var/lib/goldplus-performance-audit}"
mkdir -p "$DATA_DIR"/{reports,state,logs,locks}
docker volume create goldplus-performance-audit-node-modules >/dev/null
docker volume create goldplus-performance-audit-npm-cache >/dev/null
exec docker run --rm --cpus=1.5 --memory=1800m --shm-size=512m \
  --network goldplus-commerce_default \
  -v "$HERE:/audit:ro" -v "$DATA_DIR:/data" \
  -v goldplus-performance-audit-node-modules:/work/node_modules \
  -v goldplus-performance-audit-npm-cache:/root/.npm \
  -v /var/run/docker.sock:/var/run/docker.sock -v "$(command -v docker)":/usr/local/bin/docker:ro \
  -e PERF_AUDIT_DATA_DIR=/data -e PERF_AUDIT_HOST_DATA_DIR="$DATA_DIR" -e PERF_AUDIT_CONTAINER=1 \
  -e PERF_AUDIT_REPO_SHA="$(git -C "$HERE" rev-parse --short HEAD 2>/dev/null || echo unknown)" \
  --entrypoint bash "$IMAGE" -c '
    set -e
    # Work from a writable copy of the code so config.resolved.json never touches the checkout.
    # node_modules is a named volume mounted at /work/node_modules (a symlink does not survive
    # npm install: arborist replaces it with a real directory and the cache was lost every run).
    mkdir -p /work && cp -r /audit/. /work/ && cd /work
    [ -f /audit/.env ] && cp /audit/.env /work/.env || true
    STAMP=/work/node_modules/.installed-$(sha256sum package.json | cut -c1-12)
    if [ ! -f "$STAMP" ] || [ ! -d /work/node_modules/js-yaml ]; then
      npm install --omit=dev --no-audit --no-fund >/tmp/npm.log 2>&1 || { tail -20 /tmp/npm.log; exit 1; }
      touch "$STAMP"
    fi
    bash run_safe_recurring.sh "$@"
  ' -- "$@"
