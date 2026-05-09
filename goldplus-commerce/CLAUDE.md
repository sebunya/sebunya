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
