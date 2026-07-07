# Performance & Cross-Browser / Feature-Phone Support

GoldPlus targets everything from KaiOS/Opera-Mini feature phones on 2G to
modern smartphones. The strategy is **progressive enhancement**: the server
renders complete, usable HTML; JavaScript only ever adds nice-to-haves.

## Works without JavaScript

Every critical flow is a server-rendered Astro page with standard form POSTs —
they function fully with JS disabled or stripped (Opera Mini, proxy browsers):

- Browse shop & product detail, view cart, checkout.
- Sign in, register, change password, manage the account.

JavaScript is limited to two optional enhancements, both loaded after `load`
and both fail-safe:

- **First-party tracker** (`/js/gp-track.js`) — honours Do Not Track / GPC,
  falls back through `sendBeacon → fetch(keepalive)`, and swallows all errors so
  it can never break a page.
- **Service worker** — skipped entirely on browsers without SW support.

## Fast loading

- **Zero web fonts.** A pure system font stack (`system-ui, -apple-system,
  Segoe UI, Roboto, …`) — nothing to download, native rendering everywhere.
- **Zero framework JS.** Astro ships no client runtime; the only scripts are the
  tiny tracker and SW registration.
- **Small CSS.** Tailwind is content-purged (~7 KB gzipped).
- **Images**: product grid lazy-loads with intrinsic `width`/`height` (no layout
  shift); the product hero is `eager` + `fetchpriority="high"` for a fast LCP;
  all use `decoding="async"`.
- **`preconnect` + `dns-prefetch`** to the API origin when it's a separate host,
  warming the connection the tracker and social-login links use.
- **Service worker** (`goldplus-v3`): network-first navigations with an offline
  fallback, and **stale-while-revalidate** runtime caching of hashed build
  assets for near-instant repeat visits on slow networks.

## Cross-browser / feature-phone hardening (`global.css`)

- `text-size-adjust: 100%` — stops mobile browsers inflating body text.
- `color-scheme: light` — prevents forced-dark-mode palette inversion.
- `overflow-wrap: break-word` + responsive `img/svg/video` — no horizontal
  overflow on narrow screens.
- `-webkit-tap-highlight-color: transparent` and `touch-action: manipulation`
  for a native tap feel.
- `prefers-reduced-motion` disables animations/transitions.
- `viewport-fit=cover` for notched devices; zoom is left enabled
  (`maximum-scale=5`) for accessibility.

## Service worker safety (unchanged guarantees)

Never caches sensitive/personalised routes (`/admin`, `/checkout`, `/cart`,
`/payment`, `/api`, `/auth`, `/account`, `/dealers/dashboard`), and only ever
touches **same-origin GET** requests — form POSTs and cross-origin API calls
pass straight through untouched.

## Known limitation

Flexbox `gap` (used by Tailwind spacing utilities) isn't supported on very old
engines such as KaiOS 2.5 (Gecko 48); affected layouts render slightly tighter
but remain usable. A migration to margin-based spacing for the most critical
components is noted in `docs/ROADMAP.md`.
