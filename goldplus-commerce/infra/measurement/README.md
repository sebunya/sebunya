# Server-Side GTM Deployment

This directory contains the production-ready Server-Side GTM (sGTM) deployment configuration for GoldPlus Commerce OS. It runs a split architecture (production + preview) secured by Caddy.

## Architecture
- **caddy-measurement-proxy**: Handles Let's Encrypt TLS automatically, enforces path whitelisting (only allows `/g/collect`, `/gtm/*`, etc.), and blocks all other traffic. It routes traffic with the `X-Gtm-Server-Preview` header to the preview server.
- **sgtm-production**: Standard Google Tag Manager server container.
- **sgtm-preview**: Standard Google Tag Manager server container running in preview mode (`RUN_AS_PREVIEW_SERVER=true`).

## Deployment Steps (Hetzner / Linux VM)

1. Ensure Docker and Docker Compose are installed.
2. Point your DNS A record (e.g., `measurement.goldplus.com`) to the server IP.
3. If using Cloudflare, set encryption to **Full (strict)** and avoid proxying (`DNS Only`), OR use Cloudflare Origin Certificates.
4. Copy `.env.sgtm.example` to `.env`.
5. Fill in the `.env` file with your `GTM_SERVER_CONTAINER_CONFIG` strings and domain.
6. Run the deployment script:
   ```bash
   ./deploy-sgtm.sh
   ```

## Local Dry-Run Testing

1. Add `127.0.0.1 measurement.local` to your `/etc/hosts` file.
2. Create an `.env` file and set `MEASUREMENT_PUBLIC_ORIGIN=measurement.local`.
3. Run `docker-compose -f docker-compose.sgtm.yml up -d`.
4. Test using the smoke test script: `./sgtm-smoke-test.sh http://measurement.local`

## Rollback

To gracefully shut down and rollback, run:
```bash
./rollback-sgtm.sh
```

## Security & Privacy
- **Path Whitelisting**: Caddy prevents the domain from being used as an open proxy or exposing unintended internal ports.
- **Headers**: Strict Transport Security and Content Security Policies are enforced at the edge.
- **No Secrets in Source**: Ensure `.env` is never committed.
