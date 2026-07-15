# Slice 10-PR2E EXEC rollback plan

Rollback was not invoked because production source was not switched and Caddy was not restarted. The original live source and all production services remained in place.

For an approved rerun, preserve the live source, retain it under a timestamped `goldplus-commerce.dirty-pre-10pr2e-*` path, and identify that path before restarting Caddy. If health fails, move the failed candidate aside, restore the preserved source atomically, restart Caddy only, and repeat source, container, endpoint, and `READ ONLY` database checks.

Neither preserved nor failed source may be deleted.
