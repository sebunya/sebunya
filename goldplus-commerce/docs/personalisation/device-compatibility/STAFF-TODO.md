# Things only staff can do in the admin (the import file cannot)

## 1. After the deploy — upload and approve
Admin → Batteries → Imports → upload `compatibility-for-admin-import-v3.csv`, type **Compatibility** → check the mapping → **Dry run** (expect 208 ready, 0 held, 0 errors) → a **second person** approves → **Apply**. Result: 208 draft matches, invisible to customers.

## 2. Alternative battery codes (Admin → Batteries → Catalogue → the battery → Aliases)
| Battery | Add these alternative codes |
|---|---|
| 4L | `BP-4L`, `BL-4L` |
| 4U | `BL-4U` |
| 4UL | `BL-4UL` |
| 5C | `BL-5C` |
| BL-15DI | `BL-15DT`, `BL-15DI/DT` |
| BL-681 | `BLP681`, `BLP683`, `BL-P683` |
| A32/5G | `EB-BA426ABY` |
| A10S and A10S/A20S | `SCUD-WT-N6` (on ONE of them only — an alias cannot point at two batteries) |
| A02S/A03S | `HQ-50S` · A03 CORE: `SLC-50` · A12/A21S: `EB-BA217ABY` · A20/A30/A50: `EB-BA505ABU` · A11/BLP727: `BLP727` |
**Never add:** `BL-28ATLONG` to BL-28AT (client: different packs) · `BLP729` to A11/BLP727.

## 3. Phone alternative name (Admin → Batteries → Phones)
TECNO Pop 2 (B1): add **"Pop 2 Go"**.

## 4. "Does not fit" records (create the match, then **Reject** it with the reason — so nobody proposes it again)
- Galaxy **A10** on A10S and on A10S/A20S — client: "A10S is not the same as A10".
- Galaxy **A32 4G** (SM-A325) on A32/5G — client: the 5G battery only.
- TECNO **Pop 2** on BL-38BT — client: Pop 2 Go uses BL-24ET.

## 5. WiFi batteries
When the client says which listing is the 4G one: set its category to MiFi router, add its phones/routers; retire the other (Archive — history kept).

## 6. Per battery, from the physical pack (this is what lets a battery be switched on)
Photo (front) · printed code → confirm the code · capacity (mAh) and voltage **as printed on the GoldPlus pack** · mark "verified against the pack". `battery-enrichment-catalogue.csv` has a reference value beside an empty column for each.

## 7. Verify and publish matches, one at a time
Start with matches that have no checker's note. For the noted ones (Realme C25, other Realme phones on A11/BLP727, plain Vivo X20, Asha 500 on BL-4UL, Nokia C1) do a fit check first.
