# Proxy topology and client identity

Every per-client abuse control — the login lockout, the HTTP rate limiter, the
bot-detection velocity check — depends on one question: **who is this caller?**

If the answer comes from a header the caller can set, the control counts nothing.
The attacker varies the header and every request lands in a fresh bucket.

The topology is therefore **stated**, not inferred. `PROXY_TOPOLOGY_MODE` is
mandatory in production and the API refuses to start without it, because guessing
is unsafe in both directions: guess too low and a forged header is believed;
guess too high and every client behind the edge is counted as one, which is a
denial of service against legitimate traffic.

## MODE A — `CADDY_EDGE` (the tracked deployment)

Caddy is the only public edge (ports 80/443) and reverse-proxies to `api:3000` on
an internal Docker network. `TRUSTED_PROXY_HOPS=1`.

Caddy must do two things, and the tracked `Caddyfile` does both:

1. **Overwrite** `X-Forwarded-For` and `X-Real-IP` with `{remote_host}`, so a
   caller-supplied value is discarded before the API sees it.
2. **Strip** every other client-identity header. `reverse_proxy` forwards
   unlisted headers untouched, so without this a caller simply picks a different
   header:

       header_up -CF-Connecting-IP
       header_up -True-Client-IP
       header_up -Fastly-Client-IP
       header_up -X-Client-IP
       header_up -X-Cluster-Client-IP
       header_up -Forwarded

   The Cloudflare score headers are stripped for the same reason. Without
   Cloudflare in front, `Cf-Bot-Management-Score` is a value the caller chose —
   and bot detection *rejects* on a low score, so a caller could get anyone
   rejected, or send a high one and wave itself through.

In this mode the API does not read any Cloudflare header. `botDetection` skips
the score check entirely rather than reading a header that cannot mean anything.

## MODE B — `CLOUDFLARE_EDGE`

Cloudflare fronts Caddy. `TRUSTED_PROXY_HOPS=2`.

**Do not simply set the hop count to 2 while Caddy still replaces
`X-Forwarded-For` with a single `{remote_host}`.** At that point the original
customer address has already been discarded and there is no second entry to
count back to — the resolver falls through to the transport peer, which is
Cloudflare. Every customer behind one Cloudflare edge becomes one identity.

Mode B requires all of:

1. **Origin access restricted to Cloudflare.** The origin must not be reachable
   directly, via firewall/security-group rules limited to Cloudflare's published
   ranges, or Cloudflare Tunnel, or authenticated origin pulls. Without this,
   anyone who learns the origin address bypasses the edge and impersonates it.
2. **Caddy configured with an explicit trusted-proxy policy**, so it only honours
   forwarded headers from Cloudflare peers:

       trusted_proxies static <cloudflare ranges>

3. **Preserve the chain rather than replacing it.** Append, do not set:

       header_up +X-Forwarded-For {remote_host}

   so the API sees `<client>, <cloudflare>` and `TRUSTED_PROXY_HOPS=2` counts
   back to the real client.
4. **Score headers passed through only on the trusted path**, and still
   overwritten by Caddy so the API's copy cannot have come from a caller:

       header_up X-CF-Bot-Score {http.request.header.Cf-Bot-Management-Score}

   guarded by the trusted-proxy policy in (2).

## MODE C — `DIRECT`

No proxy. `TRUSTED_PROXY_HOPS=0`. Forwarded headers are ignored entirely and the
transport peer is the client. The configuration check rejects `DIRECT` with a
non-zero hop count: a directly exposed service that trusts a forwarded header
believes whatever the caller sends.

## Confidence, and why there is no single unknown bucket

Resolution returns a confidence alongside the address:

| Confidence | Meaning | Bucket |
|---|---|---|
| `TRUSTED` | supplied by a proxy we operate | `t:<ip>` |
| `UNVERIFIED` | transport peer; chain not as configured | `u:<ip>` |
| `UNKNOWN` | no usable address | `x:unattributed` |

Trusted and unverified claims of the *same* address use different buckets, so an
unverifiable request can neither consume nor reset a real client's budget.

`UNKNOWN` deliberately does not carry the ordinary per-client allowance. A single
shared identity holding the normal budget is an accidental denial-of-service
mechanism: one caller suppressing its own identity exhausts the bucket for every
other unresolvable client. The shared bucket gets its own, larger **global**
ceiling — generous enough that legitimate degraded traffic is not cut off at a
per-client number, bounded enough that it is not free capacity.

The address is never invented. Two call sites previously fell back to a literal
`127.0.0.1`, writing a fabricated address into audit records.

## Readiness

`GET /health/ready` reports `proxy_topology` (mode and hop count only — no
hostnames, addresses or network detail) and `abuse_controls`. An invalid topology
makes the service **unready**, because a service that cannot say how it is
exposed cannot say who its callers are.
