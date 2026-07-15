# Slice 9-ZH PRIME rollback plan

Backups completed before the additional overlay and audit writes:

- Source: `/opt/goldplus/backups/slice-09-zh-prime-20260715T095502Z/source-before.tar.gz`, SHA-256 `7a3dc54c9cdc2da75ad8fa573a051a4f78a01329c14877975104618ba98bbb8b`.
- PostgreSQL: `/opt/goldplus/backups/slice-09-zh-prime-20260715T095502Z/database-before.dump`, SHA-256 `7f26d830753b3d2e13d8080af87f26e83d8c445962f135d3b0e9241da9bde794`.

To roll back, restore the source backup or remove only the runner integrity and canonical entrypoint files, rebuild/recreate API with the existing no-send override, and verify API health, admin protection, runner preflight, and all disabled gates. Preserve the immutable synthetic attempt/result/withdrawal events.
