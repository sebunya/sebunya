# Anti-Hallucination & Traceability Matrix

## Rule Enforcement
Any claims, assets, or features introduced to the GoldPlus UI must map directly back to a validated internal source or safely fallback to an "Under Review" state.

| UI Element | Source Requirement | Fallback State | Status |
|------------|--------------------|----------------|--------|
| Product Specs | `product_catalog.xlsx` | `"Missing. Requires admin review."` | Enforced in `scripts/seed.ts` & Domain Entity |
| Product Images | Internal Asset Library | "No Image Available" structural block | Enforced in UI components |
| Reviews / Ratings | Real Database Entries | Hidden/Disabled (No fake stars) | Enforced in UI |
| Integrations (WhatsApp) | Environment Variables | `"NotConfigured"` | Enforced in Backend |
| Copywriting | Original Brand Voice | Neutral, factual descriptions | Enforced across Web App |
