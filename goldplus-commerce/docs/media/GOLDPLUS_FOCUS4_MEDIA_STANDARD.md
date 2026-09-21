# GoldPlus product image standard (Focus 4)

For marketing, photography and operations staff. This is what a good product gallery is, how to name files, and what the site will refuse.

## 1. One cover, up to three supporting frames

Every product needs **one cover** (slot 1). It is what shoppers see on product cards, search results, the cart and WhatsApp/Facebook previews. Up to **three more** images answer the questions the cover cannot:

| Slot | Call it | The shopper's question | Good | Not good |
|---|---|---|---|---|
| 1 | Cover / Main | What exactly am I buying? | the product alone, whole, on a plain light background, the right model and colour | a poster with spec text, a tiny product in a big frame, the box only |
| 2 | Alternate | What can't I see from the cover? | back, side, open case, cable ends, connector orientation | the cover again, slightly cropped |
| 3 | Detail | Will this fit or work for me? | the port, plug type, label, printed battery code, a real control | anything implying a feature the product does not have |
| 4 | Context / Contents | How big is it, what's in the box? | the actual box contents laid out; the product in an honest hand or on a desk | props that suggest accessories that are not included |

One image is fine for selling. Four is "media-complete"; it is not a quality score. Four bad crops of one photo are worse than one good cover.

## 2. Taking the photo

- Masters of about **2000 × 2000 px**, JPG, PNG or WebP, under 15 MB. A smaller valid file is accepted; it just will not look as sharp.
- Subject fills roughly **70–85 %** of the frame where the shape allows. Cables, long products and packaging are exceptions: keep the whole thing visible; never clip an edge.
- Plain white or very light background, even light, true colours. No text, badges or price overlays on the photo (the site adds price and sale information itself, truthfully).
- One photo per file. Do not paste four views into one image.
- Do not cut small views out of an existing composite and count them as four images.

## 3. Naming files for the bulk import

```
GP-C08__01-main.jpg
GP-C08__02-alt.jpg
GP-C08__03-detail.jpg
GP-C08__04-context.jpg
```

- Before the double underscore: the **SKU or model number exactly as the price list has it** (spaces and dashes are forgiven: `GP-C08`, `GP C08` and `gp-c08` all work).
- After it: the **slot number** (01–04). The word after the dash is a note for people; the number is what counts.
- Unknown or ambiguous codes are never guessed; the plan shows them and you fix the name.
- Optional manifest (CSV or JSON) with columns `sku, slot, filename, role, alt_text` when you prefer a sheet to renaming files. A manifest row wins for its file; if the filename disagrees with the manifest, the plan flags it instead of choosing.

## 4. Alt text

Describe what the image truthfully shows in one short phrase: "GP-C08 charger, front, UK plug" or "Box contents: charger, cable, manual". Never a claim the photo does not show. Leave it empty rather than guess; the site then uses the asset's own description.

## 5. What the site refuses

- A fifth image in a gallery (replace or remove one first).
- The same photo in two slots of one product.
- Removing the cover without choosing its replacement.
- A file whose bytes are not a real image, over 15 MB, or of a type the library does not accept.
- Uploading by pasting a URL (superseded: upload the file so it gets its renditions).

## 6. Where things happen

- One product: **Admin → Listing quality → product → Gallery editor** (`/admin/products/<id>/media`).
- Many products: **Admin → Image imports** (`/admin/media/imports`): stage a folder → review the plan → a second person approves → apply.
- What still needs images: **Admin → Gallery queue** (`/admin/media/gallery-queue`).
