# Slice 9-Z APEX rollback plan

## Current containment

No immediate gate action is required: broad notification live sends, consent live sends, public persistence and public Preference Centre saves are already disabled. The process-only canary gate no longer exists in any running API process. Keep the Slice 9-Y no-send override in every API recreation command.

## Code rollback

The two new files have no route and are dormant unless invoked by an internal process with a valid one-shot authorization. If rollback is required:

1. Verify `/opt/goldplus/backups/slice-09-z-apex-20260715T081539Z/source-before.tar.gz` against SHA-256 `e3358dab62fd0aa2e55b427edcbb13e87b6c33be2a84b72a92265dcb27c82b21`.
2. Restore the pre-run production source or remove only the two scoped guard/transport files.
3. Rebuild/recreate API only with the Slice 9-Y no-send override.
4. Verify two healthy API replicas, public health, admin protection and no-send readiness.

## UAT data stance

Do not delete or rewrite the six immutable audit events. The synthetic projection is already withdrawn and optional eligibility fails closed. Exclude the `uat_synthetic_slice_09_z_` prefix from ordinary customer reporting if necessary. No provider suppression or unsubscribe record was created.

The pre-write custom PostgreSQL backup is `/opt/goldplus/backups/slice-09-z-apex-20260715T081539Z/database-before.dump`, SHA-256 `ef23de9fbc7f6af0842d534e750eb8570a5d13d0ff5d34c9da463b422df8f6fe`. Full database restore is not warranted for a withdrawn synthetic record and requires separate outage authorization.

## Provider recovery

Do not retry the failed email canary in this slice. Diagnose the provider response under provider-configuration completion, preserve the one-attempt audit, and require a new run/correlation/backup before any later attempt. SMS and WhatsApp remain blocked until their missing gates are resolved securely.
