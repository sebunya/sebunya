# Slice 5 — Declared product compatibility

Date: 2026-07-15 · Branch: `phase-2-measurement-control-tower-completion`

## Boundary decision (no competing engine)

`CompatibilityRuleService` remains the recommendation-ranking heuristic, untouched.
The missing capability was admin-DECLARED compatibility (catalogue truth) with PDP
guidance. The pure domain `domain/products/Compatibility.ts` unifies both via
`resolveCompatibility`: declared always wins (an admin 'incompatible' beats a
heuristic HIGH); heuristics only soften (HIGH→compatible, MEDIUM→conditional);
absence is 'unknown'. **Unknown is not compatible** and is labelled
"Compatibility not verified".

## Layers

- Domain: verdicts `exact/compatible/conditional/incompatible` (declared may never be
  'unknown'); `validateCompatibilityMapping` (no self-mapping, conditional requires a
  note ≤300 chars); customer-facing `verdictLabel`.
- Schema: `product_compatibility_mappings` (migration `0025`, additive; unique pair
  index; FK cascade).
- Port/Repo: `ICompatibilityMappingRepository` + Drizzle impl (pair upsert).
- Use cases: admin upsert (both products must be publicly visible), list, delete;
  `GetProductCompatibilityUseCase` for PDPs — declared+enabled only, unpublished/
  dealer-only targets never leak.
- Routes: public `GET /products/:slug/compatibility`; admin `/admin/compatibility`
  (GET `products.read`, PUT/DELETE `products.write`, mutations audited
  `COMPATIBILITY_MAPPING_UPSERTED/DELETED`).
- Web: PDP "Verified compatibility" section (only renders when declarations exist;
  badges per verdict; conditional notes shown); protected `admin/compatibility.astro`
  CRUD page (sweep inventory 53→54).
- Tests: `Slice05DeclaredCompatibility.test.ts` (10) — unknown rejection, self-mapping,
  conditional-note rule, declared-beats-heuristic, softening ladder, truthful labels,
  non-public product refusal, PDP leak prevention, disabled exclusion, unknown slug.

## Deployment

Source-only; migration `0025` production execution approval-gated.
