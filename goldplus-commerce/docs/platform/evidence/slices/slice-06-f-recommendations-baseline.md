# Slice 6-F recommendations baseline

- Baseline commit: `c1925dbda09cdb174c23160cfa8efce06c3f88de`
- Existing shape: web rails consume the existing recommendations API and fall back to the existing public catalogue.
- Chosen shape: web-only rendering-boundary integrity helper and read-only operator preview.
- Excluded: service rewrite, schema work, ingestion, personalisation, provider activation and event/measurement changes.

Baseline review found ID-only dedupe, current-product exclusion by ID only, unsupported popularity wording, no category dominance cap, and broad catalogue fallbacks without an auditable selection summary.
