# Slice 10-PR2D ULTIMATE candidate confirmation

The candidate is `/opt/goldplus/app/goldplus-commerce.clean-10pr2-20260715T132508Z`, a direct operational-root symlink resolving to `/opt/goldplus/app/goldplus-commerce.clean-10pr2-20260715T132508Z.repo/goldplus-commerce`. Its backing Git root is the expected sibling `.repo` directory. The repository was clean and its exact HEAD was `bfa6de64228d6cca602c35e8d217d74cad4696c9`.

Symlink safety and direct-root layout passed. `.env.production`, `docker-compose.production.yml`, `Caddyfile`, `apps/`, `packages/`, `pnpm-lock.yaml`, `package.json`, and the Caddy fallback asset resolved at the operational root, with no nested app-layout mismatch. The environment file remained mode 600 and was not printed.

The candidate Caddyfile SHA-256 was `ca560fa5678c336a6cb802bb96b8e9c38d91539b0dfe1f18eaf9d9d99b9f68ba`. It validated in a temporary network-isolated, port-free container using the exact production image ID `sha256:86deaf5e3d3408a6ccec08fbb79989783dd26e206ae10bcf78a801dc8c9ab794` and Caddy `v2.11.3`. Compose validation passed and rendered SHA-256 `b7824dccfb5f07b650781c4d75ff5cc62fbf41e9f504218b5dc5783131b3d1cd`.

No materialized copy was selected because approval failed before the switching phase. The already validated, clean, stable backing clone plus direct-root symlink is the prepared source candidate for a later approved rerun.
