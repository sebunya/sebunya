# Roadmap — Remaining Scope from the First-Party Data & Engagement Brief

This pass shipped the **foundations**: server-side first-party event tracking,
the experimentation engine, the loyalty points ledger, and real ZeptoMail
transactional email. The brief is much larger; this file prioritises what's
left so each next pass has a clear, buildable slice. Ordering favours
(1) revenue impact, (2) dependence on already-shipped foundations, (3) effort.

## Near term (builds directly on this pass)

1. **Customer-facing transactional emails** — order confirmation and shipping
   updates to the *customer* (current router only alerts ops). Needs: order
   email templates, router targets for `ORDER_*` events, customer opt-out flag.
2. **Loyalty in the account UI** — render `GET /account/loyalty` on the web
   account page (balance, tier, history) and show points-to-be-earned at checkout.
3. **Admin experiments UI** — Astro admin page over `/admin/experiments`
   (list/create/status), mirroring the existing admin page patterns.
4. **Instrument remaining funnel events** — call `window.gpTrack` from product
   detail (PRODUCT_VIEW), shop search (SEARCH), cart (ADD_TO_CART /
   REMOVE_FROM_CART), checkout (CHECKOUT_STARTED / COMPLETED). PAGE_VIEW ships now.
5. **Abandoned-cart recovery** — a scheduled job that finds carts with
   `ADD_TO_CART` but no `CHECKOUT_COMPLETED` in N hours and enqueues a reminder
   email through the existing outbox (respecting opt-in).

## Mid term

6. **Welcome / onboarding email series (90-day nursery)** — milestone-triggered
   sequence (signup, first order, day 7/30/90) driven by outbox events plus a
   scheduled evaluator; per-customer sequence state table.
7. **Customer segmentation** — materialised segments (RFM buckets, tier,
   engagement recency) computed from `activity_events` + orders; admin report page.
8. **Product recommendations v1** — co-occurrence ("bought/viewed together")
   from first-party events; served on product pages. No ML infra needed yet.
9. **Reviews & ratings (social proof)** — verified-buyer reviews only (must link
   to a delivered order), moderation queue, aggregate ratings on product DTOs.
   Honest-by-design: no seeded or invented reviews.
10. **Spin-and-win, badges, leaderboards** — gamification layers on the loyalty
    ledger (`MANUAL_ADJUSTMENT` entries with game reasons); needs clear rules
    pages and ethical guardrails (no manufactured scarcity).

## Longer term

11. **Social login** (Google/Facebook OAuth) alongside password auth.
12. **CDP-style customer 360 view** — unified admin profile page joining
    identity, orders, loyalty, support tickets, and activity timeline.
13. **Churn prediction / LTV scoring** — only once segments + event volume
    justify it; start with heuristics, graduate to ML.
14. **Redemption mechanics** — spend points at checkout (ledger already
    supports `REDEMPTION` entries).
15. **Data governance formalisation** — retention windows for
    `activity_events`, anonymisation job, documented access policy; the data
    dictionary lives in `docs/first-party-data.md` and must stay current.

## Pass 2 shipped (admin / CMS / user management / social login)

Delivered: CMS (versioned pages, scheduling, SEO, `/p/<slug>`), customer signup
+ welcome email, self-service password change, admin user activate/deactivate +
role assignment with self-lockout guards, Google social login (OAuth 2.0 code
flow) with account linking, and the admin dashboard metrics endpoint.

### Follow-ups opened by pass 2

- **CMS**: WYSIWYG editor + media/asset library (image/video uploads); content
  taxonomy (categories/tags); admin Astro screens for the CMS API.
- **Auth**: forgot-password / reset email flow, email verification, and two-factor
  authentication (the register/login use cases are structured to accept these).
- **Social**: Facebook and Apple providers (implement `ISocialIdentityProvider`;
  the login use case needs no change). Profile field editing (name/preferences).
- **Admin**: dashboard UI page over `/admin/dashboard`; bulk product import/export;
  promotions/coupons module; order refund/exchange workflow.
- **Privacy**: data-subject export/erasure endpoints (GDPR/CCPA), retention job.

## Standing constraints (AGENTS.md)

Every item above must respect: hexagonal architecture (mutations via use
cases), transactional outbox for critical events, no fake integrations, no
invented product facts/reviews/scarcity, dealer pricing never public, ethical
behavioural economics only.
