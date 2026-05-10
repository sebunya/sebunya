# Source Grounding Notes

This document tracks the source files used to guide the autonomous implementation of Phase 1 functional depth.

## Core Reference Files
- `package.json`: Monorepo structure, dependencies (Hono, Astro, Drizzle, Vitest).
- `pnpm-workspace.yaml`: Workspace definitions.
- `apps/api/src/domain/`: Reference for existing entities and business rules.
- `apps/api/src/application/use-cases/`: Reference for existing use cases and DTOs.
- `apps/api/src/infrastructure/db/schema/`: Database schema definitions.
- `apps/api/src/infrastructure/db/repositories/`: Current repository implementations.
- `apps/web/src/pages/`: Current UI pages and routing.
- `docs/phase-1-truth-audit.md`: Initial audit of gaps.
- `docs/verification-report.md`: Current verification status.

## Architectural Constraints
- Clean Architecture (Domain -> Application -> Infrastructure/Interfaces).
- Hexagonal Architecture (Ports/Adapters).
- Modular Monolith (Separation by bounded context).
- Domain Purity (No framework/db imports in domain).

## Domain Facts & Truth States
- Anti-hallucination rules as defined in the user request.
- Product Truth: "Missing. Requires admin review."
- Credential Truth: "Not configured."
- Integration Truth: "Owner review required."
