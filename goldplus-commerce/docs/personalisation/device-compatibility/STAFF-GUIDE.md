# Battery ↔ phone matches — staff guide

Everything is under **Admin → Batteries**. Nobody needs a spreadsheet or a developer for routine changes.
Two people are always involved: the person who proposes a match cannot be the one who checks it.

## Add phones to a battery
1. **Batteries → Catalogue →** open the battery → panel *Compatible phones* → **Add or review fits**.
2. Pick the battery (pre-selected), select one or more exact phones, choose the evidence level, say where the evidence comes from → **Create draft claims**.
3. On each draft press **Submit**. It now waits for a second person. Customers see nothing yet.

Phone not in the list? **Batteries → Phones** → add it (brand, model, exact model number). Recorded twice? Use *Merge* there — matches move across, nothing is deleted.

## Check a match (second person)
**Batteries → Compatibility** opens on the review queue. For each claim: look at the evidence, choose *Package verified / Fit tested / Verified exact* (or *Conditional* with the condition customers will read), give a reason → **Verify**. Or **Reject** with a reason. The system refuses if you created the claim yourself.

## Publish
A verified claim shows **Publish**. It goes live only if the battery itself is *Active* — if not, the claim says *"the battery is in review, so this fit is not public yet"*; activate the battery from its own page (separate check, separate button).

## Correct a wrong match
Open the battery (or the phone — see below), find the claim, edit it. Changing the phone, battery or evidence sends it back for review; the old approval does not carry over.

## Remove a wrong match from the website NOW
On the claim press **Unpublish** (it stops showing; stays on file) or **Archive** (withdrawn; history kept). Re-importing research will not bring an archived match back — only **Restore** does.

## See it from the phone side
**Batteries → Phones →** under any phone, **Matching batteries (n, n verified)**. Same records, every status — useful for spotting two batteries claimed for one phone.

## Import a research file
**Batteries → Imports →** upload (.xlsx / .csv), type *Compatibility* → confirm the column mapping → **Dry run** (writes nothing).
Section *Rows that need you*:
- **"Battery code is required" / "No battery for …"** → blue box **Which battery is this row about?** → choose the catalogue battery, say why → **Link battery** → run the dry run again. The original row is never changed, and this only says *which battery* — not that it fits.
- **Held (conflict / compound line)** → *Leave it out*, *Keep holding*, or *Include* once resolved, with a note.
Then a **second person approves**, and **Apply** creates drafts. Imports never publish.

Ready-made for the current research: `compatibility-map-for-admin-import.csv` (the file), `proposed-battery-links.md` (which battery to choose for each code-less row; 3 are flagged ambiguous — check the label before linking those).

## What customers see
| Situation | Customer sees |
|---|---|
| Verified + battery active | "Verified fit, in stock / out of stock" |
| Conditional + active | "Fits with a condition" + your condition text |
| Supplier-listed + active + setting ON | "Listed by the supplier, not yet checked by us" |
| Anything else (draft, in review, rejected, archived, battery not active) | Nothing. The finder says "We have not matched a battery to this phone yet" and offers to help |
