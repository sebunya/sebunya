# Power bank facts queue, 2026-11-05 (brief A1)

Four live power banks publish no checked specification: GP-W2-PB, GP-W3-PB, GP-W5-PB, GP-X01-PB.
After this branch the PDP, /compare, llms-full.txt and MCP `get_product` say their capacity, input, output,
ports and cables are unknown. Nothing below is published by code: each value needs a staff reading of the
physical unit or the maker's panel, entered as a verified spec in `/admin/products/<id>` → Listing → Specifications.
Never copy a value from a sibling (W2/W3/W5 share a look and a 66W badge; that is not evidence they share ratings).

## Where each surface was checked (2026-11-05)

| Source | GP-W2-PB | GP-W3-PB | GP-W5-PB | GP-X01-PB |
|---|---|---|---|---|
| Admin record (`api.shopgoldplus.com/products/<slug>` `attributeValues`) | none | none | none | none |
| `apps/api/src/scripts/data/supplier-specs-2026-09.json` (maker panels) | absent | absent | absent | absent |
| `catalogue-copy-2026-09.json` | `specs: []`, template copy | same | same | same |
| `pd-aliases-2026-10-13.json` | name alias PD-W2 only, `specs: []` | PD-W3 | PD-W5 | n/a |
| PDP HTML spec table | SKU row only (now: "not checked yet" row) | same | same | same |
| llms-full.txt | price, stock, SKU, model only (now: "Specifications: … unknown") | same | same | same |
| MCP `get_product` | `specifications: {}` (now: `specifications_recorded: false` + unknown text) | same | same | same |

## Leads staff can check (NOT verified, NOT published)

| SKU | Lead | Where |
|---|---|---|
| GP-W2-PB | Label on the unit, large print: "20000 mAh POWER BANK", "66W", "PD", "Super charge"; fine print (input/output lines) unreadable at web size. A USB-A to USB-C cable is in the photo. | Shop photo `/uploads/assets/0c/0c6ec9563cde/pdp.webp` |
| GP-W3-PB | Back label shows "66W" and "PD"; two built-in cable ends visible (Lightning and USB-C); fine print unreadable. | Shop photo `/uploads/assets/e7/e75219944ae0/pdp.webp`; marketing render `PowerBanks/GoldPlus Built-In Cable Power Bank_GP_pd_w3.webp` (2 USB-A + 1 USB-C ports, display) |
| GP-W5-PB | Case print "FAST CHARGING"; a USB-A to USB-C cable is in the photo. No rating legible. | Shop photo `/uploads/assets/bb/bb2fdf3ecd37/pdp.webp` |
| GP-X01-PB | Photo not read for ratings. | `/uploads/assets/82/82efb185a4d9/pdp.webp` |

## Per-SKU queue (one row per fact; fill Source and Reviewer when entered)

| SKU | Fact | Spec name to use | Value | Source (panel / unit label photo) | Reviewer | Date |
|---|---|---|---|---|---|---|
| GP-W2-PB | Capacity | Capacity (mAh) | | | | |
| GP-W2-PB | Input | Input | | | | |
| GP-W2-PB | Output (per port, and total) | Output power (W) | | | | |
| GP-W2-PB | Ports | Ports | | | | |
| GP-W2-PB | Cables (built-in / in the box) | Built-in cables / In the box | | | | |
| GP-W3-PB | Capacity | Capacity (mAh) | | | | |
| GP-W3-PB | Input | Input | | | | |
| GP-W3-PB | Output (per port, and total) | Output power (W) | | | | |
| GP-W3-PB | Ports | Ports | | | | |
| GP-W3-PB | Cables (built-in / in the box) | Built-in cables / In the box | | | | |
| GP-W5-PB | Capacity | Capacity (mAh) | | | | |
| GP-W5-PB | Input | Input | | | | |
| GP-W5-PB | Output (per port, and total) | Output power (W) | | | | |
| GP-W5-PB | Ports | Ports | | | | |
| GP-W5-PB | Cables (built-in / in the box) | Built-in cables / In the box | | | | |
| GP-X01-PB | Capacity | Capacity (mAh) | | | | |
| GP-X01-PB | Input | Input | | | | |
| GP-X01-PB | Output (per port, and total) | Output power (W) | | | | |
| GP-X01-PB | Ports | Ports | | | | |
| GP-X01-PB | Cables (built-in / in the box) | Built-in cables / In the box | | | | |

Use the spec names the other power banks already use (`Capacity` mAh, `Output power` W, `Built-in cables`,
`Ports`) so the /shop filters and the charger finder read them. Once entered, the short and long
descriptions (still the template "power through outages and long days") can be rewritten from the checked values.

Verify after entry: the PDP spec table, `/compare?ids=<W2 id>,<W3 id>`, https://shopgoldplus.com/llms-full.txt and
MCP `get_product` for each slug show the same values, and the "not checked yet" line disappears.
