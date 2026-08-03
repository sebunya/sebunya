# U2 — Device catalogue seed manifest & source policy

## Data-sourcing policy (honoured)

Per the U2 spec, **no device specification is invented**. This session has no
authoritative, verifiable source for Ugandan device specifications (connector
type, charging wattage, screen dimensions, popularity rank), so the delivered
state is:

- **Schema** — `devices` + `product_device_compatibility` (migration `0070`).
- **Validated import CLI** — `apps/api/src/scripts/import-device-compatibility.ts`.
- **Source-manifest format** — this document.
- **Seed state** — **EMPTY** in production. No rows are seeded with fabricated or
  unverifiable specifications. Devices and compatibility are loaded by the
  business through the CLI once a real source is available.

Any field that cannot be sourced is stored as `NULL`; any compatibility that is
not evidence-backed is stored with `confidence = 'declared'` (or `'inferred'`),
**never `'verified'`**. The schema enforces that a `verified` row carries an
actor, an evidence source and a timestamp.

## Seed source manifest format

When the business seeds devices, record provenance in a companion manifest so the
catalogue is auditable:

```
device_slug,field,value,source_url_or_document,sourced_by,sourced_at,confidence
tecno-spark-20,charging_wattage_max,18,https://manufacturer.example/spec,ops@goldplus,2026-08-03,verified
tecno-spark-20,connector_type,usb_c,retail-box-photo-2026-08,ops@goldplus,2026-08-03,verified
```

- `confidence` must be `verified` only when `source_url_or_document` is an
  authoritative manufacturer/retail source. Otherwise `declared`/`inferred`.
- Prioritised seed set (models common in Uganda) to source first: Tecno,
  Infinix, itel, Samsung A/M series, Xiaomi Redmi, Oppo A series, Nokia, Huawei,
  and current iPhone models — **specifications to be filled from real sources by
  the business, not by this build.**

## Compatibility import CSV format

Header: `productRef,deviceRef,fitType,confidence,evidenceSource,notes`

- `productRef` — product SKU or product id.
- `deviceRef` — device slug (e.g. `tecno-spark-20`).
- `fitType` — `exact | universal | adapter_required`.
- `confidence` — `verified | inferred | declared` (`verified` requires `evidenceSource`).

The importer validates the **entire file** and resolves **every** reference
before committing any row; on any error it prints per-row diagnostics and commits
nothing (bounds: ≤5000 rows, ≤300 chars/cell, ≤2 MB).
