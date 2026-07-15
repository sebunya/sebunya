# Slice 10-PR2D ULTIMATE rollback plan

Rollback was not invoked because no switch or restart occurred; the original production source and all service processes remain active.

For an approved rerun, first preserve and retain the old source as a timestamped `goldplus-commerce.dirty-pre-10pr2d-ultimate-*` path. If any post-switch health check fails, move the failed candidate aside, atomically restore that preserved directory to `/opt/goldplus/app/goldplus-commerce`, restart Caddy only, and repeat storefront, API, admin-protection, Preference Centre, container-identity, and read-only database checks. Neither the old nor failed source is to be deleted.

The current rollback position is immediate: no action is needed because production never left the original dirty source.
