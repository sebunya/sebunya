# Gift cards bought online

How the card looks, what a buyer can put on it, and what the shop keeps. Code: `apps/web/src/lib/giftCardThemes.ts`,
`apps/web/src/components/GiftCardFace.astro`, `apps/web/src/lib/giftCardShare.ts`, and
`apps/api/src/application/use-cases/credit/GiftCardPurchaseUseCases.ts`. Migrations: 0199 (purchases), 0200 (occasions),
0201 (photos).

## The look (from the rebrand book)

- **Colours:** GoldPlus green `#96CC06`, black and white, with two light greys for paper folds in the illustrations. A unit
  test fails if an illustration uses any other colour, or if it contains text or a linked picture.
- **Type:** Montserrat, self-hosted (`apps/web/public/fonts/montserrat-*-var.woff2`, all weights in one variable file
  per subset). The share images load it before drawing; the browser check is recorded in the evidence run.
- **Logo:** the original wordmark, never redrawn. Black on light, white or green on black. Never white text on green.
- **One structure for all 14 occasions:**
  - a brand area (the logo);
  - the greeting;
  - "To", the name and the note, grouped;
  - the occasion's illustration in its own area;
  - an information band carrying From and the amount.
- **Two looks:**
  - **Black-led:** the art sits on black and the band is green with black text.
  - **White-led:** the art sits on a green field and the band is black, with the amount in green.

  `variant` in `giftCardThemes.ts` says which look each occasion uses.
- **Sizes:** the card is a landscape rectangle that grows for a long note. Its corners are clipped with `clip-path`, not
  `overflow: hidden`, which would fix the height and push a long note under the band. Every size is given in px first
  and then in container units, for older Android WebViews.
- **Illustrations:** `apps/web/public/gift-cards/art/<occasion>.svg`, each 200 × 200, drawn for its card's look.
  To add an occasion:
  1. Add it to `GiftCardOccasions.ts` (API) and to `giftCardThemes.ts` (storefront).
  2. Draw its SVG in the same style.
  3. Add the theme to the database check, in a migration.

## The note

Up to 160 characters, the same in the form, the API (`GIFT_CARD_MESSAGE_MAX`) and the column (`varchar(160)`). A longer
note is refused, never cut. Line breaks and repeated spaces become one space, and the preview shows exactly that. The
note is on the card only: the recipient's text says "with a note for you on the card". The text's length therefore
never depends on the note, and nothing from the buyer can forge a line in a message sent from the shop's sender.

## The photo (0201)

1. The buyer chooses a photo and places it in a square: drag, pinch, slider, wheel, or the arrow and +/- keys.
2. The phone uploads that square once, as a JPEG, through the shop's own address (`/gift-card/photo`).
3. The API re-encodes it with sharp: a square of at most 1080 px, every piece of metadata (location, camera) removed,
   and quality stepped down if needed to fit the 1.5 MB column.
4. It is stored in `gift_card_photos` and claimed by exactly one purchase, in the purchase's own transaction.

**Who sees it:** the person the card is for (through the card's private link), the buyer (through their reference),
and staff. It is never on a public page and never indexed. In the share image it appears only if the recipient
ticks it.

**How long it is kept:**
- An upload can be put on a card for 2 days. Its link stops working when that window closes, so a saved draft notices.
- An upload nothing claimed is deleted after 3 days.
- The photo of a purchase that ended unpaid or refunded is deleted 30 days after it ended.
- A privacy erasure deletes the photos of that person's purchases.
- Staff can remove a photo in Admin › Gift cards › Bought online. The removal is audited.

**Limits:**
- 10 uploads a minute per visitor (the `issue-report` family).
- 400 photos a day across the whole shop. Above that the card still sells, without a photo.

**sharp is a native module.** It loads on the first photo, not when the API starts, so a missing binary would only
turn photos off. The CI job `api-image` builds the production image and runs a photo through it.

## Sharing (the recipient)

The share panel builds the picture from an explicit list of permitted fields: occasion, names, note, original amount
and photo. Each is off until the recipient chooses it. The code, balance, private link, phone numbers and references
never reach the renderer. Square images are 1080 × 1080; Story / Status images are 1080 × 1920, with the top 250 px
and bottom 280 px kept clear of words.
