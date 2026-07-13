# Slice 6-D legal route baseline

Date: 2026-07-14 EAT

- `BaseLayout.astro` already contained footer links to `/terms` and `/privacy`; the destinations were missing.
- The deployed Slice 6 support and order-help pages already contained qualified returns, warranty, terms, privacy and order-confidence guidance.
- The PDP already directed customers to support to confirm the policy applicable before purchase.
- No existing `terms.astro` or `privacy.astro` route file existed, and all proposed Slice 6-D paths were free of unrelated dirty work.
- Selected runtime scope: create `apps/web/src/pages/terms.astro` and `apps/web/src/pages/privacy.astro` only. No footer or support edit was necessary.
- Hard exclusions: checkout, cart, orders, payments/PesaPal, auth/RBAC, providers, ZeptoMail, WhatsApp API/sending, SMS, Template Studio, External Delivery, Measurement, queues/outbox, Product Finder, recommendations, compatibility, migrations, environment, backups, secret-like files and logs.
