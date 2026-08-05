# GoldPlus Agentic Instructions

Welcome, future AI agent. When working in this repository, you MUST follow these absolute rules:

## Architecture
- Phase 1 only. Do not invent Phase 2/3 features or dummy modules.
- Modular monolith first.
- Clean Architecture / Hexagonal Architecture / DDD.
- Hono routes must be thin.
- Domain logic must NOT import Hono, Drizzle, or external adapters.
- All mutations must go through Application Use Cases.
- Use Cases must rely on Repository Interfaces and Ports.
- Infrastructure implements repositories and ports.
- Transactional outbox for critical events.

## Data & Safety
- Payment webhook idempotency is MANDATORY.
- PWA cache must EXCLUDE sensitive routes (checkout, admin, dealer).
- NO invented product facts, fake reviews, fake ratings, or fake scarcity.
- NO fake integrations. Disabled integrations must return "Not configured".
- Dealer pricing and supplier costs must NEVER appear in public APIs.
- Tests and architecture checks are mandatory. Do not bypass them.

## UX & UI
- Mobile-first, accessible, and simplified.
- Ethical behavioural economics only. Do not use dark patterns or fake urgency.
- Global benchmark websites are for inspiration only, do NOT copy them.

## Location Module
- The location/address module build is governed by `docs/location-module-brief.md` (verified Ministry of ICT 2019 postcode dataset, PARTs A–P). Read it before touching location, address, or delivery-zone code. Decisions and assumptions live in `docs/location-module-decisions.md`.
- The loyalty/gamification completion build is governed by `docs/loyalty-completion-brief.md` (PARTs A–V). Read it before touching loyalty, points, quests, badges, tiers, or the loyalty page. Decisions live in `docs/loyalty-decisions.md`.

## Delivery Estimation
- **`docs/delivery/CONTRACT.md` is the contract for delivery quoting — read it before touching any delivery fee, delivery window, or quoting code, and hold it in context for the whole run.** Ten guarantees, one page. The two that catch people out: there is exactly ONE quoting service, and the fee and the window come from the SAME expected-minutes number.
- The model and calibration are in `docs/delivery/MODEL.md`. Operations, the Control Centre, phases, guardrails and the definition of done are in `docs/delivery/OPERATIONS.md`.
- `goldplus_locations_seed.sql` is RETIRED. It creates a conflicting `ug_area` shape and must never run; the CSVs are the only import path.
