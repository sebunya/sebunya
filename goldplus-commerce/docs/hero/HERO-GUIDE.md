# Editing the homepage hero — a guide for the marketing team

You do not need to know any code to change the homepage. Everything here is done
at **Admin → Homepage hero** (`/admin/hero`). Changes go live the moment you
save. If a change would break the page, the editor refuses it and tells you why.

## What the hero is

Twelve campaigns live in the library. **Each visitor sees four of them**, chosen
automatically — a first-time visitor sees different slides from a regular
customer. You edit all twelve; the system decides who sees which.

## Change a headline

1. Find the campaign in the list (each has a name like `flash` or `welcome`).
2. Edit the **Headline** box.
3. Click **Save**.

Keep it short. The box shows a counter (e.g. `40/52`); if it turns red, the
headline is too long for the layout and the save will be refused.

## Make words green

Wrap the words you want in green with `<em>` and `</em>`:

```
Up to <em>40% off</em>, for the next few hours
```

Two or three words maximum — **the green is an accent, not a highlighter.**
Every `<em>` needs a matching `</em>`. You cannot use any other formatting; if
you type anything else it shows as plain text (this is on purpose — it keeps the
page safe).

## Turn a campaign on or off

Untick **“Shown in rotation”** and save. The campaign stays in the library so
you can bring it back later; it just stops appearing. If you turn *everything*
off, the page falls back to the “Verified original electronics” slide rather
than showing an empty box.

## Change a price, a code, or delivery fees

Open **Campaign data (advanced)** on the campaign and edit the values:

- **flash** — `saleEndsIso` (the sale end, keep the `+03:00` at the end),
  `originalPriceUgx`, `salePriceUgx`, `savePct`
- **welcome** — `promoCode`
- **sameday** — `cutoffHour` (17 = 5pm)
- **fees** — the three delivery prices
- **scratch** — the prize table
- **loyalty** — `points`, `goalLabel`

If a flash sale's end date has passed, the editor flags it and the countdown
stops showing — update the date or turn the campaign off.

## Prepare and upload an image

Two kinds of slide need two kinds of image:

**Stage slides (a product on its own):**
- Product on a **plain white** background (standard product-page photos work).
- **Square**, 1200×1200 or larger.
- A photo on a coloured, grey or busy background will look like an ugly
  rectangle — **plain white only.**

**Bleed slides (a full lifestyle photo):**
- Landscape, **2000px wide or more.**
- Keep the **left third and bottom half simple** — the words sit there.

**For both:** export as **JPEG at quality 80–85**, resize before uploading
(1400px for stage, 2000px for bleed), and **never upload a PNG photo or a
straight-from-the-phone file** — it makes the page slow on mobile data. Always
fill in the **alt text** (a short description of the photo).

Use the image field to paste a `/media/…` URL from the media library, a
`/hero/…` path, or a `/products/….webp` product image.

## Preview everything before it goes out

Click **“Preview all 12 slides →”**. This shows the whole library in order with
each campaign named — the only way to see all twelve, because a real visitor
only ever sees four. You can also preview as a specific visitor by adding to the
homepage address:

- `/?gp=new` — a first-time visitor
- `/?gp=returning` — someone who has been before
- `/?gp=regular` — a frequent customer
- `/?mode=day` or `/?mode=night` — the daytime or night-time look

## Rotation settings

At the top: how many slides show per visit (default 4), how long each stays
(default 6 seconds), and whether it auto-advances. These are global.

## When it looks wrong

- **A campaign isn't showing** — check it's ticked “Shown in rotation”, and
  remember each visitor only sees four.
- **The green ran across the whole line** — a missing `</em>`. Fix and save.
- **An image looks like a grey rectangle** — a stage slide with a
  non-white-background photo. Replace it with a plain-white product shot.
- **Anything else** — tell the development team; the change you tried to save
  and the message the editor showed are what they need.
