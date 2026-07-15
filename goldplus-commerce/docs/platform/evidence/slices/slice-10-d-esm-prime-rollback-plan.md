# Slice 10-D ESM PRIME rollback plan

No runtime rollback is required because no production service was recreated or restarted. Running API/web replicas remain on the previously restored healthy images.

If the source-only repair must be reverted before a future deployment, revert `ec300f6f16e16ab50bd1a116a13a4c2b1ad6ca48` in a new reviewed commit; do not rewrite branch history. If a later approved deployment fails, use that deployment window's fresh API/web rollback tags and recreate API/web only, leaving Caddy, PostgreSQL, and Redis untouched.

The next deployment must repeat exact-source Compose validation, API/web builds, the isolated API image-start smoke, fresh rollback tagging, scoped API/web recreation, health checks, logged-out route protection, and read-only consent/no-send verification.
