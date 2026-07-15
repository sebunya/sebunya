# Slice 10-D PRIME rollback plan

No production rollback is required because Slice 10-D was not deployed and production source and services were not changed.

For a future scoped deployment, capture the prior API/web image IDs and container start times before recreation. If the new admin/API health, authentication boundary, or aggregate summary fails, restore only those prior API/web images using the approved Compose workflow. Do not restart Caddy, PostgreSQL, or Redis, and do not run a database rollback because this slice has no migration.

After rollback, verify storefront and API health, unauthenticated admin/API protection, unchanged container identities for Caddy/PostgreSQL/Redis, and the consent/no-send counters in a read-only transaction. Preserve failure evidence before cleanup.
