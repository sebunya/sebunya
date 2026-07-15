# Slice 10-D ESM PRIME no-deploy proof

No `docker compose up`, service recreation, restart, migration, or runtime deployment ran. Building the API/web tags did not replace the running containers.

API containers retained IDs `41b3819bbf87` and `1180aabe5dfa`, running image `sha256:4057585542b5`, start times `2026-07-15T15:57:03.796718137Z` and `2026-07-15T15:57:03.961263578Z`, and zero restarts. Web retained `06fe9539596c` and `c5e866a8a88c`, image `sha256:2caef4d600a6`, start times `2026-07-15T15:57:03.798468249Z` and `2026-07-15T15:57:03.969047633Z`, and zero restarts.

Caddy retained `6f6e517ee9d0` / `2026-07-15T14:30:06.898875595Z`; PostgreSQL retained `ebb57744324c` / `2026-07-12T20:33:46.62170169Z`; Redis retained `32c8a2475394` / `2026-07-13T03:34:44.34918138Z`. All retained zero restarts.

After the build and smoke, storefront, API live health, and Preference Centre returned `200`; logged-out admin returned `303`. The Consent Operations Control Room remains not deployed.
