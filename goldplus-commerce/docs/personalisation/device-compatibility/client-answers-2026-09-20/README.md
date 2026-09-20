# Client answers absorbed (2026-09-20)

`client-answers-verbatim.md` keeps exactly what the client said. `client-answers-rows.csv` is that answer as explicit battery→phone rows. `compatibility-for-admin-import-v3.csv` is the file to upload: the printed-list rows for batteries the client did not revisit + the client rows. **190 rows on 77 of the 80 batteries; all 190 stage as drafts, 0 held** — the seven contradictions are resolved in `resolutions-of-held-matches.md` (4 rejected, 2 kept with an exact model, 1 is an alias). Nothing is staged, reviewed or published yet.

## What "dry run" really does (mutation contract)
Upload + mapping + dry run **persist** one import session, its rows (source, normalised value, proposed action, errors) and audit events. They write **nothing** to brands, devices, claims, aliases, products or stock — verified on a production copy (devices 0 → 0, claims 0 → 0). "Dry run" therefore means "no catalogue writes", not "no database writes".

## Where the client's answer was NOT taken at face value (held by the importer, both sides kept)
| Battery | Client said | Held because |
|---|---|---|
| A11/BLP727 | Realme 6i | global 6i (RMX2040) uses BLP771; India RMX2002 another pack |
| A11/BLP727 | Realme C25 | C25 (RMX3191/3193) uses the 6000 mAh BLP793 |
| VIVO B-B1 | Y55s | the name is also a 2021+ 5G phone with a different pack — needs the exact legacy model |
| VIVO B-D2 | X20 | ordinary X20/X20A uses B-D1; B-D2 is the X20 Plus family |
| 4UL | Asha 500 (also listed under 4U) | one phone takes one pack; staged under 4U with the 501/503 |
| BL-38BT | (no answer) | earlier research "Pop 2 Go" is superseded by the printed list's Pop 5 Go (BD1) |
A GoldPlus packaging photo or a technician's fit check overrides any of these.

## Staged with a caution in the note (not held)
- Realme 5 / 5s / 5i / C3 / C11 / C20 / C20A / C21: the client sells them on the A11/BLP727 pack; the phones' own pack is **BLP729**. Kept as SKU↔phone claims — BLP727 and BLP729 are NOT merged as codes.
- Realme C21Y: client-listed; pack family not confirmed by us.
- Nokia 4UL names (3310, 225, 5310, 6310) span generations — generation to confirm; 6310 may be BL-4WL.
- TECNO "301/312/313/349/401/101" under BL-5C: "T" prefix assumed.
- Nokia C1: staged as **C1 (2019, TA-1165)** because the client's own list pairs plain "C1" with S5420AP and has separate packs for C1 2nd Edition and C1 Plus. Storefront name stays "Nokia C1".

## Identity decisions for staff to record in the admin (not importable)
- Aliases to add: `BP-4L` and `BL-4L` → 4L; `BL-4U` → 4U; `BL-4UL` → 4UL; `BL-5C` → 5C; `BL-15DT` and `BL-15DI/DT` → BL-15DI; `BLP681`, `BLP683`, `BL-P683` → BL-681; `EB-BA426ABY` → A32/5G; `SCUD-WT-N6` → A10S/A20S. **Never** alias `BL-28ATLONG` → BL-28AT (client: different packs; regression-tested) and never alias BLP729 → A11/BLP727.
- Negatives (record as REJECTED claims so they cannot be re-proposed): Galaxy A10 on A10S / A10S/A20S; Galaxy A32 4G (SM-A325) on A32/5G; Vivo X20 on B-D2.
- `A10S` and `A10S/A20S` now carry the same two phones (client: same pack). They are two stock lines today; whether to keep both listings is an owner decision.
- WiFi: client wants to keep only the 4G pack. We do not know whether that is "WIFI BAT BIG" or "WIFI BATTERY SMALL" — **one question**. The other is retired through the product lifecycle (hidden, history kept); the kept one still needs its code and router models. Routers are not phones: needs a device type before any match.

## Still no phone: 3 of 80
`BENCO 23011` (client: skip for now), `WIFI BAT BIG`, `WIFI BATTERY SMALL`.

## Native importer, production copy (commit `4edd1ee3`, Steward-admitted, lane released)
`ready to apply: 189 · held for review: 5 · with errors: 0`; the five held rows are exactly the five listed above; `devices` 0 → 0 and `product_device_compatibility` 0 → 0.

## Self-review fixes (same day)
- The printed-list rows for `A10S/A20S` had no model numbers while the client rows for `A10S` had `SM-A107`/`SM-A207`: the importer keys a phone on brand + name + model number, so it would have created **two "Galaxy A10s" and two "Galaxy A20s" records**. All four rows now carry the same identity.
- The client listed the **Asha 500 under both BL-4U and BL-4UL**. Staged under 4U, held under 4UL.
- Client's "Asha 220 / 225 / 230" are sold as Nokia 220 / 225 / 230 (not Asha-branded) — recorded that way, and the 225 only once.
- Guards added: no phone may appear with two different model-number cells; a phone may be staged on two batteries only where the client declared the packs identical.
- This revision (193 rows) was validated with the importer's rules locally; the previous revision (194) is the one that ran through the native importer on a production copy. The rules are the same function.
- Follow-up questions for the client: `~/Downloads/GoldPlus_Battery_Follow-up_Questions_for_Client_2026-09-20.txt` (11 short points).

## Second client message (2026-09-20): BL-38BT and the Pop 2 Go
Client: *"BL-38BT is for … Techno POP 5 Go and Techno POP 6 Go whereas for the phone Pop 2 Go it uses BL-24ET which it shares with other phones."*

Checked against public parts listings:
- **Pop 5 Go (BD1) → BL-38BT, 4000 mAh** — consistent across many independent sellers. Staged.
- **Pop 6 Go (BE6)** — the client's own printed list puts it on **BL-38CT**, and a parts listing sells "Pop 6 Go BL-38CT 3850 mAh"; the client now also puts it on BL-38BT. Both packs are the same ~4000 mAh class. Recorded on BOTH batteries as drafts with that note; a fit check decides whether the packs are interchangeable in this phone.
- **BL-24ET** — listings agree with the printed list: Pop 1 (F3), Pop 2 (B1), Pop 2F (B1F), 2400–2500 mAh. Those three now carry their model numbers.
- **"Pop 2 Go"** — TECNO's range has Pop 2, Pop 2F, Pop 2 Plus and Pop 2 Power but no phone officially called "Pop 2 Go". Held on BL-24ET as an *identity* question (get the model number off the phone) so it does not become a duplicate of the Pop 2/2F. The old research row "Pop 2 Go on BL-38BT" is held as **rejected by the client**.

Sources: sunsky-online.com and mobspares.com (Pop 5 GO BL-38BT 4000mAh); aliexpress.com item 1005009736929075 (Pop 6 Go BL-38CT 3850mAh); alibaba.com BL-24ET listing (F3/B1/Pop 2/B1F); daraz.pk (BL-24ET for Pop 2, Pop 2F). Seller listings are leads, not proof.

## Final file through the native importer (commit `9321cc2d`, production copy)
`ready to apply: 188 · held for review: 7 · with errors: 0`; `devices` 0 → 0, `product_device_compatibility` 0 → 0. Client-facing status workbook: `~/Downloads/GoldPlus_Battery_Phone_Compatibility_v3_After_Client_Answers_2026-09-20.xlsx` (supersedes v1 and v2).

## Final file, native importer, production copy (commit `4f158c38`)
`ready to apply: 190 · held for review: 0 · with errors: 0`; devices 0 → 0, claims 0 → 0.
