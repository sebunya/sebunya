# Slice 8-A loyalty baseline

Date: 2026-07-14 (Africa/Kampala)

## Discovery

- No public `/loyalty` or `/rewards` route existed.
- No loyalty ledger, points balance, redemption, coupon, badge, quest, Memory Lane, mystery reveal, or utilisation-aware offer implementation existed.
- The Admin Trust Centre already listed loyalty as `Coming soon`, disabled it, and stated that no points, balance, cashback, discount or reward was active.
- Existing public support, terms and privacy routes provide the truthful contact and policy destinations required by a future-programme preview.
- Existing protected admin routes use `readSessionToken` and redirect logged-out requests to `/admin/login`.
- The public footer and sitemap are safe navigation opportunities for a clearly labelled foundation page.

## Implementation decision

Use a web-only, pure static foundation:

- one immutable loyalty config/helper;
- one public preview page;
- one protected read-only operator preview;
- a safe preview link from the existing disabled loyalty module;
- one footer link and one static sitemap entry;
- focused tests and release evidence.

Explicitly excluded: API and database code, migrations, identity matching, cookies/local storage, orders, inventory reads, checkout/payment, live prices or offers, reward liability, provider activation, queues, sends, environment, backups and secrets.
