# Product gallery — admin guide (Focus 4)

Every step below is a real screen or a real command in this branch. Nothing here describes an endpoint that does not exist.

## 1. One product: the gallery editor

**Admin → Listing quality → open a product → "Gallery editor"**, or directly `/admin/products/<product id>/media`.

You see four slots. Slot 1 is **Cover / Main** and says where it is used (cards, search, cart, social previews). The header shows `Media n/4` and the gallery's **revision** number; every button sends that revision, and if a colleague changed the gallery in between you get a clear message and the slots reload — nothing is overwritten.

| Want to… | Do |
|---|---|
| Put an image into an empty slot | **Choose existing** on the slot (searches the media library by SKU/model/filename, thumbnails only) → **Use in slot n**. Or upload (below). |
| Make another image the cover | **Set as cover** on that slot. It swaps places with the current cover: `[A,B,C,D]` choosing C gives `[C,B,A,D]`. |
| Replace what is in a slot | **Replace** on the slot → choose a library image, or upload with "Allow replacing an occupied slot" ticked. The old image stays in the library. |
| Remove a supporting image | **Remove** on slots 2–4. Only that slot empties; the others do not move. |
| Remove the cover | Use **Swap** with a replacement from slots 2–4, or **Set as cover** on another image. The site never silently promotes an image. |
| Reorder | **Move to** on any slot: moving into an occupied slot swaps; moving into slot 1 is flagged "(becomes cover)". |
| Fix alt text | Edit the text under the slot → **Save**. |
| Add several images at once | **Add images**: pick up to four files, choose a slot per file (or "next empty"), **Upload and assign**. A fifth file is refused up front; a rejected file stops the batch before anything is assigned, and the valid files stay in the library for **Choose existing**. |
| Undo | **Recent changes** → **Restore the state before this**. It is a new, revision-checked change (audited), not a blind overwrite. |

"Not ready" on a slot means the asset is archived, missing on disk or has no rendition; it will not show on the site until repaired in the media library. "Not in the gallery" lists legacy images that have not been placed in a slot.

## 2. Which products need work: the gallery queue

**Admin → Gallery queue** (`/admin/media/gallery-queue`). Filters: 0/4 … 4/4, fewer than 4, missing cover, unready asset, legacy rows. Search by SKU, model or name. **Edit gallery** opens the editor. **Reconciliation CSV** downloads one row per product: cover and slot filenames, unready/legacy counts, matching unassigned library images (by product code in the filename), blockers, and an inventory footer (products, unassigned assets, ambiguous and unmatched candidates). The CSV is formula-safe.

## 3. Many products: reviewed bulk import

**Admin → Image imports** (`/admin/media/imports`).

1. **Stage and plan**: choose the files (named `SKU__01-main.jpg` …, see the media standard) and optionally a manifest. Staging stores the files in the media library and writes a plan. No product changes yet.
2. **Review** the plan: each file shows the product it resolved to, the slot, and a status — `NEW`, `WOULD REPLACE` (slot already holds a different image), `EXACT DUPLICATE` (same bytes already in that gallery), `UNCHANGED`, or a blocker (`UNMATCHED PRODUCT`, `AMBIGUOUS`, `DUPLICATE SLOT`, `INVALID SLOT`, `INVALID FILE`, `MANIFEST CONFLICT`). Blockers say which file and why. Fix the files or the manifest and stage again.
3. **Approve**: a **different person** from the one who staged presses Approve (or Reject with a reason). Approval is refused while any blocker remains.
4. **Apply**: one change per product, each checked again against the gallery's current revision. The page then shows per product `APPLIED`, `SKIPPED` (already done), `STALE` (someone edited that gallery meanwhile: re-plan it) or `FAILED`. On an unexpected failure the batch stops and the rest shows `NOT ATTEMPTED`.
5. **Resume** finishes the not-attempted products after review. Applying an already-applied session is refused.
6. **Results CSV** lists every row with its plan and apply status.

Undo an applied import per product from that product's gallery editor (Recent changes).

## 4. Command-line operations (host, inside the API builder image)

Backfill existing single images into slot 1 (dry run by default; nothing is invented for slots 2–4):

```
docker run --rm --network goldplus-commerce_default --env-file /opt/goldplus/app/goldplus-commerce/.env.production \
  -e DRY_RUN=1 -e ACTOR_USER_ID=<admin uuid> -w /app/apps/api goldplus-migrator:<tag> \
  npx tsx src/scripts/backfill-product-media-slots.ts
```

Read the report (`backfill-product-media-slots.report.json`: WOULD_ASSIGN_COVER / CONFLICT with reasons), then rerun with `DRY_RUN=0`. Rerunning is safe: products already edited through the gallery are skipped.

Photos named by code, unreviewed (superseded for batches, still works for a handful of files): **Admin → Product photos**, or `attach-images-by-code.ts` with the media volume mounted. Each photo goes to the product's next free slot; a full gallery is reported.

## 5. Conflicts and recovery, in one place

| Message | Meaning | What to do |
|---|---|---|
| "Someone changed this gallery after you opened it" | your revision is stale | look at the reloaded slots, repeat the change if still wanted |
| "The cover cannot be removed without a replacement" | slot 1 protection | choose the replacement in the same action |
| "Only a ready, validated library image can be placed" | asset archived / no rendition / not in the library | repair or re-upload in the media library |
| "This gallery already holds four images" | 4/4 | replace or remove one first |
| `STALE` on an import row | that product's gallery moved since the plan | stage that product's files again |
| `NOT ATTEMPTED` on import rows | the batch stopped after a failure | read the failed row's error, then Resume |
