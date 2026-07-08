#!/usr/bin/env bash
set -e

echo "Deploying Server-Side GTM Infrastructure..."

if [ ! -f .env ]; then
  echo "Error: .env file not found. Please copy .env.sgtm.example to .env and configure it."
  exit 1
fi

docker-compose -f docker-compose.sgtm.yml pull
docker-compose -f docker-compose.sgtm.yml up -d --remove-orphans

echo "Waiting for services to start..."
sleep 10

./sgtm-healthcheck.sh

echo "Deployment successful."
