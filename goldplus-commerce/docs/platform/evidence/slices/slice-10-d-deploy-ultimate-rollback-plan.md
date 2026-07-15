# Slice 10-D DEPLOY ULTIMATE rollback plan

No runtime rollback is currently required because no new API/web image was produced and no service was recreated. Existing containers continue to use the pre-attempt images.

For a later successful build followed by failed health, retag `goldplus-commerce-api:rollback-slice-10-d-20260715T151813Z` to `goldplus-commerce-api` and `goldplus-commerce-web:rollback-slice-10-d-20260715T151813Z` to `goldplus-commerce-web`, then recreate API/web only with `--no-deps`. Do not restart Caddy, PostgreSQL, or Redis.

If source rollback is independently required, the preserved `bfa6de6` source archive and an emergency detached checkout of `bfa6de64228d6cca602c35e8d217d74cad4696c9` remain available. No source rollback was performed in this run.
