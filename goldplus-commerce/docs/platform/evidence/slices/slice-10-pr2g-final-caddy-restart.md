# Slice 10-PR2G FINAL Caddy restart

Only Compose service `caddy` was restarted after the source switch. The container retained ID `6f6e517ee9d02fa4021925866f8925ac1fd4d6c200905469ddfa4a11bf11f2a2`; its start time advanced from `2026-06-03T10:57:29.364155659Z` to `2026-07-15T14:30:06.898875595Z`. Restart count remained zero because this was an explicit Compose restart.

The mounted `/etc/caddy/Caddyfile` SHA-256 after restart was `ca560fa5678c336a6cb802bb96b8e9c38d91539b0dfe1f18eaf9d9d99b9f68ba`, matching the validated candidate. No API, web, PostgreSQL, or Redis restart occurred. No Compose `up`, `down`, `build`, or `pull` command ran.
