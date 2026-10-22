# Gift cards bought online

How the card looks, what a buyer can put on it, and what the shop keeps. Migrations: 0199 (purchases), 0200 (occasions),
0201 (photos).

## Where the code is

| Concern | Rules (pure) | Use case | Storage / adapters |
|---|---|---|---|
| Buying, paying, issuing | `domain/credit/GiftCardPurchase.ts` | `GiftCardPurchaseUseCases` | `DrizzleGiftCardPurchaseRepository` |
| The photo | `domain/credit/GiftCardPhoto.ts` (limits, retention, cut-offs); its sizes and id shape are shared with the cropper (`packages/shared/src/gift-cards/giftPhoto.ts`) | `GiftCardPhotoUseCases` | `DrizzleGiftCardPhotoRepository`, `SharpGiftCardPhotoProcessor` |
| The words (note, names) | `packages/shared/src/gift-cards/giftText.ts`, shared by the API and the buy page | | |

On the storefront: `lib/giftCardThemes.ts` (the 14 occasions), `components/GiftCardFace.astro` with
`lib/giftCardFaceText.ts` (the label and greeting, used by the server and by the buy page's preview),
`lib/photoCrop.ts` (the cropper's geometry), and `lib/giftCardShare.ts` (the share picture: `layoutShareImage` decides
where everything goes and whether it fits; painting only follows it).

## The look (from the rebrand book)

- **Colours:** GoldPlus green `#96CC06`, black and white, with two light greys for paper folds in the illustrations. A unit
  test fails if an illustration uses any other colour, or if it contains text or a linked picture.
- **Type:** Montserrat, self-hosted (`apps/web/public/fonts/montserrat-*-var.woff2`, all weights in one variable file
  per subset). Like every site font it arrives after first paint (faces.css); until then the card uses
  'Montserrat Fallback' in `global.css`, Arial sized to Montserrat's measured width and height per weight, so the swap
  does not move the card. The share images load Montserrat before drawing.
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

1. The buyer chooses a photo and places it in a square: drag, pinch, slider, wheel, or the arrow and +/- keys. The
   crop is kept in the photo's own pixels, so what the frame shows is exactly what is uploaded.
2. The phone uploads that square once, as a JPEG, through the shop's own address (`/gift-card/photo`).
3. The API re-encodes it with sharp: a square of at most 1080 px, every piece of metadata (location, camera) removed,
   and quality stepped down if needed to fit the 1.5 MB column. A picture declaring more than 2048 x 2048 pixels is
   refused from its header, before it is decoded: the API container has 512 MB and decoding happens outside the
   JavaScript heap. At most two photos are processed at a time per API process (a finished one hands its place straight to the next
   waiting, so a newcomer can never make it three), and libvips keeps no cache.
4. It is stored in `gift_card_photos` and claimed by one purchase, in the purchase's own transaction. A photo already
   on one of the same buyer's purchases (same phone) is copied for the new one, so trying again after a failed or
   cancelled payment keeps the photo; another buyer cannot use it.

**Who sees it:** the person the card is for (through the card's private link), the buyer (through their reference),
and staff. It is never on a public page and never indexed. In the share image it appears only if the recipient
ticks it.

**How long it is kept:**
- An upload can be put on a card for 2 days. Its link stops working when that window closes, so a saved draft notices.
- An upload nothing claimed is deleted after 3 days.
- The photo of a purchase that ended unpaid or refunded is deleted 30 days after it ended.
- The photo of a card that is used up, cancelled or expired is deleted 90 days after its last movement.
- A privacy erasure deletes the photos of that person's purchases.
- Database backups can still hold a copy; they are for restoring the shop and are never used to show a photo.

**Who can remove it:**
- The person the card is for, from their card (`/gift-card/open`): the card's code is the proof.
- The buyer, from their purchase page (`/gift-card/bought`): the purchase reference is the proof.
- Staff, in Admin › Gift cards › Bought online. Staff removals are audited.

Every removal has one confirming tap and works without JavaScript. The privacy policy (version 1.3, "Gift cards: notes and
photos") says all of this in customer words; change the two together.

**Limits:**
- 10 uploads a minute per visitor (the `issue-report` family).
- 20 photos a day per visitor, counted by a peppered hash of the rate-limit key (`gift_card_photos.uploader_key`),
  never by a stored address. Our own server calls count only against the shop-wide limit.
- 400 photos a day across the whole shop. Above either daily limit the card still sells, without a photo.
- Removing a photo by code or reference is a lookup by a secret, on the tight `order-lookup` budget.

**sharp is a native module.** It loads on the first photo, not when the API starts, so a missing binary would only
turn photos off. The CI job `api-image` builds the production image and runs a photo through it, including the
oversized-picture refusal.

**Refusals are values, not exceptions.** The processor returns a reason (`not_an_image`, `too_small`, `too_large`,
`too_detailed`, `unavailable`); the use case adds the daily limits; each reason has its own words for the buyer
(`GIFT_CARD_PHOTO_REFUSAL_WORDS`) and its own HTTP status (413 too large, 429 a daily limit, 503 unavailable, else 400).

## Sharing (the recipient)

The share panel builds the picture from an explicit list of permitted fields: occasion, names, note, original amount
and photo. Each is off until the recipient chooses it. The code, balance, private link, phone numbers and references
never reach the renderer. Square images are 1080 × 1080; Story / Status images are 1080 × 1920, with the top 250 px
and bottom 280 px kept clear of words.

The layout is computed before anything is painted and reports whether the chosen content fits: no two blocks of
words touch, no words touch the picture, and story words stay out of the apps' zones. When it does not fit, the panel
asks for a shorter message for the picture (`pictureNote`): the box starts as the whole note once, then is the
recipient's own (cleared to write afresh, it stays clear), and until it fits the picture carries no note. The note
itself is never cut or shrunk. A name too long for two lines is
set smaller rather than cut; the From line is cut only with an ellipsis, at a whole character.
`tests/unit/GiftCardShareLayout.test.ts` checks this for all 14 occasions, both sizes and long content.
