# Slice 6-A support and order baseline

Date: 2026-07-14 EAT

- Existing public routes: `/support`, `/support/issue`, `/support/fake`, and `/track-order`.
- Existing footer links already expose `/support` and `/track-order`; no shared layout change is required.
- Existing support contact source: `whatsappSupportNumber` from `apps/web/src/lib/api.ts`, already used by public web pages. Slice 6 uses it only to construct outbound `wa.me` anchors.
- The prior `/track-order` page posted to a commerce lookup endpoint and rendered a delivery progress timeline plus order/payment status copy. That shape was removed from the public route for this support-first P0.
- Existing legal footer destinations `/terms` and `/privacy` returned HTTP 404. Slice 6 uses functional anchored support guidance for returns, warranty, terms and privacy instead of creating or implying unapproved legal documents.
- Runtime files selected: `apps/web/src/pages/support/index.astro` and `apps/web/src/pages/track-order.astro` only.
- Explicit exclusions: checkout, cart, orders API, payments/PesaPal, auth/RBAC, ZeptoMail, WhatsApp API/sending, SMS, Template Studio, External Delivery, Measurement, queues/outbox, recommendations, Product Finder, compatibility, loyalty, migrations, environment, backups and secret-like files.
