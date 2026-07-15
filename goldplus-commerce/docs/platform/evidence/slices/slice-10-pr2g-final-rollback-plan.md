# Slice 10-PR2G FINAL rollback plan

The original dirty source is retained at `/opt/goldplus/app/goldplus-commerce.dirty-pre-10pr2g-20260715T142952Z`, and the complete pre-switch archive is retained at `/opt/goldplus/backups/slice-10-pr2g-source-preservation-20260715T142930Z`.

If a later source-switch-related health failure is confirmed, move the clean candidate aside, atomically restore the retained dirty source to `/opt/goldplus/app/goldplus-commerce`, restart Caddy only, and repeat source, container, endpoint, Preference Centre, and `READ ONLY` database checks. Neither the clean candidate, dirty source, nor preservation pack should be deleted before operational sign-off.

Rollback was not needed during PR2G because all health and invariants passed.
