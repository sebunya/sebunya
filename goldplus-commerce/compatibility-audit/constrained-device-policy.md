# GoldPlus constrained-device policy (2026-09-13)

Low-end Android is a **primary acceptance environment**, not an edge case.

## Device classes (device-matrix.json)
Small low-end Android (360×640, 4× CPU slowdown, 3G-like), mainstream Android
(412×915), large Android, small/mainstream/large iPhone, iPad-class and Android
tablets, 1366 laptop, 1440 desktop, 1920 display. Minimum supported viewport
width: **320 px**.

## Evidence classes
- EMULATED_CONSTRAINED_DEVICE: Chromium with CDP CPU throttling and network
  conditions on the Linux runner. Comparable run-to-run, not a phone.
- REAL_LOW_END_ANDROID: only from a real-device provider session on an
  entry-level phone (target: Samsung Galaxy A10-class, Android 10). Until a
  credential exists, every such cell is AWAITING_REAL_DEVICE.

## What must hold on the low-end class
- Home, category, search, product, cart and checkout entry complete under
  slow_mobile, high_latency and severe_constrained profiles.
- The primary CTA is reachable on short (560 px) and keyboard-open (~420 px)
  heights; landscape does not overflow.
- No commerce dependency on optional APIs; storage loss (localStorage, Cache
  Storage, service worker) does not break shopping.
- Text scaling to 200 % (emulated) keeps the header, price and CTA usable;
  user zoom is never disabled.
- Touch targets for navigation, search, quantity, Add to Cart and checkout are
  measured; undersized ones are P3 findings decided one by one.

## Memory pressure and process death
Tested indirectly: cart and checkout are server-side (cart cookie + server
state; checkout draft in localStorage). A tab discard or relaunch returns to
the server's cart. Not tested on a real device until a provider exists.

## Manual assistive-technology checklists (MANUAL_AT_VALIDATION_REQUIRED)
**VoiceOver (iPhone)**: open menu, navigate categories, search, read a product
(name, price, availability), add to cart, adjust quantity, reach checkout
fields in order with labels announced, error messages announced.
**TalkBack (Android)**: same journey; confirm the burger announces state,
sort control is operable, quantity buttons announce the product.
**NVDA (Windows, Firefox/Chrome)**: same journey by keyboard; landmarks, focus
order, form field labels, error association.
Record executor, date, device/browser, and per-step outcome in
`real-device/manual-at-results.md` when performed.
