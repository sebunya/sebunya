# Slice 10-PR2 APEX rollback plan

No live source switch or restart occurred, so no runtime, service, database, provider, consent, or customer-state rollback is required.

Prepared-artifact cleanup, only under separate authorization:

1. Confirm no operator is using `/opt/goldplus/app/goldplus-commerce.clean-10pr2-20260715T132508Z` or its `.repo` target.
2. Remove only the candidate symlink.
3. Remove only the new clean clone, including its copied mode-600 `.env.production`, without printing the file.
4. Leave `/opt/goldplus/app/goldplus-commerce` unchanged.
5. Retain `/opt/goldplus/backups/slice-10-pr2-source-preservation-20260715T132406Z` until a later successful switch is accepted.

Before another switch attempt, repair the candidate Caddy syntax on the clean branch, revalidate Caddy and Compose, create another fresh source preservation pack, and obtain the required root-only approval phrase.
