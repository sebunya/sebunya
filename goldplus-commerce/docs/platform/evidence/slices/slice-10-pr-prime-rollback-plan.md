# Slice 10-PR PRIME rollback plan

No live source switch or runtime action occurred, so no service, database, provider, customer-state, or runtime rollback is required.

Prepared-only rollback, if requested under separate authorization:

1. Confirm no operator is using `/opt/goldplus/app/goldplus-commerce.clean-d2ec8d88-20260715T131252Z`.
2. Remove only that side-by-side candidate and its copied `.env.production` without printing the file.
3. Leave `/opt/goldplus/app/goldplus-commerce` unchanged.
4. Retain `/opt/goldplus/backups/slice-10-pr-prime-source-preservation-20260715T131129Z` until the later alignment is completed and accepted.
5. Revert the evidence-only commit if the local documentation must be withdrawn.

For the future planned alignment, preserve the current source again, explicitly approve the required restart/maintenance scope, account for the Caddyfile bind mount, and map the validated remote’s nested app path to the operational Compose path before switching.
