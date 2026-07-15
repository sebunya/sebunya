# Slice 9-ZG APEX rollback plan

## Backups

- Source: `/opt/goldplus/backups/slice-09-zg-apex-20260715T092402Z/source-before.tar.gz`, SHA-256 `cc42c69781aac7188bbe1c40daa11aa1bb46532d9c601e64b50790c8111d3903`.
- PostgreSQL: `/opt/goldplus/backups/slice-09-zg-apex-20260715T092402Z/database-before.dump`, SHA-256 `e5dbcf70e35040219cd343fb91ad4deeb37ab4ff131137c9fa8f1af3bd748981`.

## Code rollback

Restore the backed-up source or remove only the three scoped diagnostic files, rebuild/recreate API with the existing no-send override, and verify both API replicas, public health, admin redirects, protected APIs, and all disabled send/persistence gates.

Do not delete or rewrite the six synthetic diagnostic events. They provide the truthful pre-audit, classified post-audit and withdrawal record. No provider suppression or unsubscribe record was created.
