# Slice 10-PR2C PRIME rollback plan

No live switch or restart occurred, so no runtime, service, database, provider, consent, or customer-state rollback is required.

Candidate cleanup, only under separate authorization, may remove the direct-layout candidate symlink and its backing clean clone without printing the mode-600 environment file. The live dirty source and `/opt/goldplus/backups/slice-10-pr2-source-preservation-20260715T132406Z` must remain intact.

For the later approved switch, identify the current dirty source as the rollback directory before renaming it. If post-switch health fails, move the failed candidate aside, restore the dirty source to the operational path, restart only Caddy, and verify storefront, API, admin protection, Compose health, and the read-only consent/no-send ledger.
