# Slice 10-PR2C PRIME Caddy compatibility repair

The production reverse proxy runs `caddy:2-alpine`, image ID `sha256:86deaf5e3d3408a6ccec08fbb79989783dd26e206ae10bcf78a801dc8c9ab794`, Caddy `v2.11.3`.

The candidate failed because its API error response used `content_type` as a nested `respond` subdirective. Caddy `v2.11.3` rejects that syntax.

The tracked repair is limited to `Caddyfile`:

```text
remove: nested content_type application/json block
add:    header Content-Type "application/json"
keep:   unchanged JSON response and HTTP 503 status
```

Domains, TLS settings, routes, matchers, upstreams, headers other than the explicit response content type, response body, and status remain unchanged. The repaired SHA-256 is `ca560fa5678c336a6cb802bb96b8e9c38d91539b0dfe1f18eaf9d9d99b9f68ba`, exactly matching the currently valid live Caddyfile.
