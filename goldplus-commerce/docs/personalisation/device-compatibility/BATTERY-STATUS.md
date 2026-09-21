# GoldPlus batteries — current status (2026-09-20)

**One line:** 79 batteries on the website · 77 have phones recorded (208 matches) · 2 have none · 0 matches are visible to customers yet · nothing is deployed.

## The numbers
| | |
|---|---|
| Batteries on the website | **79** (Benco 23011 is retired by migration 0147) |
| With phones recorded | **77** — 208 battery→phone matches, all pass the shop's own importer on a production copy (208 ready · 0 held · 0 errors) |
| Without phones | **2** — `WIFI BAT BIG`, `WIFI BATTERY SMALL` (MiFi router batteries; the client keeps "the 4G one" but has not said which listing that is) |
| Matches with a model number | 83 of 208 |
| Matches carrying a checker's note | Realme C25 and the other Realme phones on A11/BLP727 · plain Vivo X20 on B-D2 · Asha 500 on BL-4UL · Nokia C1 generation |
| Matches with packaging / fit evidence | **0** — every match is a declaration (client, their printed list, or supplier research) |
| Batteries ready to switch on | **0** — none has a photo, the pack's own capacity + voltage, a confirmed code, or a check against the physical pack |

## Where each match came from
- GoldPlus printed "Compatible Phone list" (291 lines transcribed; `poster-2026-09-20/`)
- The client's written answers, recorded as stated (`client-answers-2026-09-20/client-answers-verbatim.md`)
- August supplier research — only where two independent lists agree (18 extra phones), labelled as research

## Files
| File | Purpose |
|---|---|
| `client-answers-2026-09-20/compatibility-for-admin-import-v3.csv` | **the file to upload** (Admin → Batteries → Imports → Compatibility) |
| `client-answers-2026-09-20/battery-enrichment-catalogue.csv` | per SKU: original-pack code, reference capacity/voltage, phones, search keywords, SEO text |
| `client-answers-2026-09-20/resolutions-of-held-matches.md` | how the seven contradictions were settled, with sources |
| `STAFF-GUIDE.md` · `STAFF-TODO.md` | how to use the screens · the exact list of things only staff can do |
| `~/Downloads/…v3_After_Client_Answers…xlsx` · `…Enrichment_per_SKU…xlsx` · `…Follow-up_Questions…txt` | for the client (4 questions left) |

## What stands between today and customers seeing a match
1. Owner approves the deploy (migrations 0144–0147 + api + web).
2. Staff upload the import file; a **second person** approves and applies → 208 invisible drafts.
3. Staff work through `STAFF-TODO.md` (alternative codes, the "Pop 2 Go" name, three "does not fit" records).
4. **Pack photos.** One front + one back photo per battery gives the photo, printed code, capacity, voltage and usually the phone list — everything the system needs to switch a battery on and to mark its matches "Verified fit".
5. A second person verifies and publishes matches one at a time.

## Known weak points (honest list)
- Realme C25 on A11/BLP727 and plain Vivo X20 on B-D2: parts catalogues disagree with the client. Asha 500 on BL-4UL: Nokia specifies BL-4U.
- Nokia C1: sellers disagree on whether the S5420AP pack is for the C1 (2019) or the C1 2nd Edition.
- BL-58BT: the printed cell was blurred; recorded from the research reading.
- Reference capacity/voltage is the ORIGINAL pack's rating (19 seen on independent parts listings, 23 from public specifications, 35 from the BL-code convention with no voltage) — never to be shown as the GoldPlus pack's own rating until read from the pack.
- (Resolved: 200 per battery is the real opening stock — owner, 2026-09-20.)
- ~230 batteries on the client's printed list are not on the website; the Nokia block, half the Samsung block and the Redmi/Pixel rows of that list were read at normal size only.

## 2026-09-21 — import staged on production; publication still physically gated
- Compatibility import session `f29e931c-9085-438a-a2b7-fac794162d29` is on production: 208 ready / 0 held / 0 errors, awaiting approval by a second admin account and then Apply (drafts only).
- **Going public is not a switch anyone can flip today.** Read from production: all 79 live batteries have **no image, no capacity/voltage, verification UNVERIFIED, code PROVISIONAL (51) or DEVICE_NAMED (28)**. The publication rule (`BatteryReadiness`) refuses each of those, and every one is a fact that only the physical pack can supply: photograph the pack (front + label), read capacity and voltage off it, confirm the printed code, mark verified, and verify at least one fit (package / fit test / exact). The reference ratings in `battery-enrichment-catalogue.csv` describe the ORIGINAL manufacturer's pack, not GoldPlus's aftermarket pack — they must not be entered as the pack's specs.
- Until then the finder stays honest: "We have not matched a battery to this phone yet".
