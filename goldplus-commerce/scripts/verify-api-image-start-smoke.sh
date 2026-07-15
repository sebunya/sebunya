#!/bin/sh
set -eu

IMAGE="${1:-goldplus-commerce-api}"
NAME="goldplus-api-image-smoke-$$"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker image inspect "$IMAGE" >/dev/null
docker run --rm --entrypoint sh "$IMAGE" -c '
  test -f /app/apps/api/dist/config/env.js
  test -f /app/packages/shared/dist/index.js
  test "$(node -p "require(\"/app/packages/shared/package.json\").main")" = "dist/index.js"
'

docker run -d \
  --name "$NAME" \
  --network none \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  -e NODE_ENV=test \
  -e PORT=3000 \
  "$IMAGE" >/dev/null

attempt=1
while [ "$attempt" -le 30 ]; do
  if [ "$(docker inspect "$NAME" --format '{{.State.Running}}')" != "true" ]; then
    docker logs "$NAME" 2>&1
    echo "API image exited before smoke health succeeded" >&2
    exit 1
  fi

  if docker exec "$NAME" node -e '
    fetch("http://127.0.0.1:3000/health/live")
      .then(response => {
        if (response.status !== 200) process.exit(1);
      })
      .catch(() => process.exit(1));
  ' >/dev/null 2>&1; then
    echo "API_IMAGE_START_SMOKE_PASS image=$IMAGE network=none"
    exit 0
  fi

  attempt=$((attempt + 1))
  sleep 1
done

docker logs "$NAME" 2>&1
echo "API image did not become healthy before timeout" >&2
exit 1
