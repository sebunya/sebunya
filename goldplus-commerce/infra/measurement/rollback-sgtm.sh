#!/usr/bin/env bash
set -e

echo "Rolling back/shutting down Server-Side GTM Infrastructure..."

docker-compose -f docker-compose.sgtm.yml down

echo "Rollback complete."
