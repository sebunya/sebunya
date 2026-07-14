# Slice 6-F1 elite recommendations intelligence

Implemented at the existing web rendering boundary:

- pure candidate normalization and explicit eligibility reasons;
- stable ID-or-slug identity with safe PDP slug/name requirements;
- dedupe by product ID and slug;
- current-product exclusion by ID and slug;
- deterministic bounded selection with source order as the tie-breaker;
- `same_subcategory`, `same_category`, explicit `complementary_category`, data-backed `same_brand_or_family`, `catalogue_fallback`, `eligible_candidates` and honest `empty` outcomes;
- reviewed complementary subcategory pairs only;
- category dominance cap and deterministic sparse-catalogue fill with reason;
- truthful price, availability, image, alt and link fallbacks;
- supported per-item explanations and reason codes only;
- approved public labels and honest browse/empty states;
- a read-only operator preview with before/after counts, exclusion/dedupe results, fallback/empty outcomes and explicit unreported states;
- 34 focused tests covering the full selection and rendering contract.

No recommendation service, endpoint, persistence, catalogue ingestion, personalisation, customer profile, checkout/payment, auth/RBAC, provider, queue, Measurement behavior, Product Finder behavior, loyalty or customer communication was changed.
