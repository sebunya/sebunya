# GoldPlus PWA policy (2026-09-13)

## Classification: INSTALLABLE_PWA (foundation)
Live state: a hand-written manifest (name, short_name, start_url `/`, scope
`/`, display standalone, theme/background colours, 192/512 PNG + 512 maskable +
SVG icons) and a hand-written service worker (`goldplus-v4`, eight precache
entries, network-first navigations with an `/offline` fallback, cache-first
for the precached assets only, no runtime cache writes, `skipWaiting` +
`clients.claim`). Sensitive routes bypass the worker entirely: `/admin`,
`/checkout`, `/cart`, `/payment`, `/api`, `/dealers/dashboard`, `/account`,
`/orders`, `/track-order`. No push, notifications, background sync, periodic
sync, share target, badging, shortcuts, install-prompt UX or standalone
adaptation. That is deliberate.

## Order of importance
**Commerce first, PWA second.** A browser in Tier A/B that lacks any optional
PWA capability must still shop. A capability is added only when it has a
customer or commercial case, never for a checklist.

## Non-negotiables
1. **Transactional truth is never cached.** Price, stock, promotion, delivery
   cost and payment state come from the server on the request that matters.
   The sensitive-route bypass list is the guard; it must stay in step with the
   routes that carry money or identity.
2. **No massive precache.** The precache stays a handful of shell entries; no
   catalogue, no product images, no route chunks. PWA install/update traffic
   is measured in the compatibility run and must not rise unexplained.
3. **Update safety.** `skipWaiting` + `clients.claim` are acceptable today only
   because nothing transactional is served by the worker and nothing is
   runtime-cached. Before any runtime caching is introduced, the worker must
   gain a versioned cache strategy, a waiting-worker path and a stale-version
   test (old HTML + new JS, new HTML + old JS, old SW + new deploy).
4. **Offline is honest.** "Connection required" is acceptable; a blank screen,
   an infinite spinner, a false success or a stale cart presented as current
   is not.
5. **Background sync never replays payment, order placement or refunds.**

## What the audit checks every run
Manifest fields, MIME and icons; worker registration, scope, precache, strategy,
takeover and the sensitive bypass as delivered; offline navigations and cache
eviction recovery; per-engine capability rows. Installation, standalone launch
and iOS Home Screen behaviour are AWAITING_REAL_DEVICE until a provider exists.

## Known findings carried
- Precache lists the SVG icons while the manifest points at the PNG icons
  (P3, harmless; both resolve).
- Manifest has no `id` (P3; identity is start_url).
- The offline fallback when `/offline` is not cached is a bare `503 Offline`
  text response (P3; only after cache eviction).
