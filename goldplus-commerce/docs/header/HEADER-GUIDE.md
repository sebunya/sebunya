# Editing the header — a guide for the marketing team

You do not need to know any code to change the top of every page. Everything here
is done at **Admin → Header** (`/admin/nav`). Changes go live the moment you
save. If a change would break the header, the editor refuses it and tells you
exactly what to fix.

## What the header is

The header is the strip that sits at the top of **every** page: the category
bar, the search box, the phone/WhatsApp contact, the flash-sale card and the
featured product cards inside the menus. One save changes it everywhere at once,
on phones and on desktops.

You do **not** edit the logo, the deep menu contents (the long lists of tile
descriptions, the battery capacity table, the brand chips) here — those are set
in code so their layout can't be knocked out of shape. If you need one of those
changed, ask a developer. Everything a campaign normally touches is on this page.

## Rail categories

These are the words in the category bar (`Batteries`, `Sound`, and so on).

1. Edit the **Label**. A counter shows how much room is left (e.g. `9/14`); if it
   turns red the word is too long and the save will be refused.
2. **Link** must be a real page — it starts with `/` (for example `/c/power`).
   Empty, or a bare `#`, is refused.
3. **Tag** is the little badge (like `Live` on the flash category). Leave it
   blank for no badge.

The header must always have at least one category — you cannot delete them all.

## Featured cards

Each menu can show a product photo with a name and a line of copy. The rule the
editor enforces:

- **Name** ≤ 40 characters, **Line** ≤ 60 (the counters show this).
- **Alt text is required** whenever there is an image. Alt text is the sentence a
  blind customer's screen-reader says, and the words Google reads — describe what
  is in the photo (e.g. `Oraimo 20000mAh power bank in black`).
- **Link** must be a real page.

## Making a word stand out

In the search "no results" line you can wrap a word in `<b>` and `</b>` to make
it bold:

```
We couldn't find <b>{q}</b> — try a broader word.
```

`{q}` is replaced by whatever the customer typed. Every `<b>` needs a matching
`</b>`, and bold is the only formatting allowed — anything else shows as plain
text on purpose, which is what keeps the page safe.

## Flash sale

- **Left in stock / Of total / Bar width %** drive the "23 of 100 left" line and
  its progress bar. Set them to match reality — **do not invent scarcity.**
- **CTA label** is the button wording.
- The **countdown clock uses the homepage hero's sale deadline**, not a second
  date here, so the two can never disagree. Change the deadline on the hero
  editor and the header follows. If that deadline has already passed, the editor
  refuses the save and tells you — an expired sale never shows.

## Settings & offers

One number, used everywhere it appears:

- **First-order estimate** (e.g. `UGX 18,500`) — the "save about …" figure shown
  to new visitors, in one place so it is always consistent.
- **First-order discount %**, **Referral %**, **Points → UGX rate** — the offer
  percentages and the points conversion used across the header.

## Contact

- **Phone (display)** is what people read; **Phone (dial)** is the number that
  actually dials (starts with `+256`).
- **WhatsApp number** starts with `256` (no `+`). The tap-to-call and
  tap-to-WhatsApp links are built from these automatically.
- **Hours note** is the small line under the number.

## Search

- The two **placeholder** boxes are the grey hint text (one for desktop, one for
  the narrower mobile box).
- **Trending** is the list under the search box: one entry per line, written as
  `term | /link` — for example `Oraimo power bank | /search?q=oraimo`. Leave it
  empty to show nothing.

## When a save is refused

The editor checks the **whole** header before saving. If anything is wrong —
a label too long, a link that isn't a real page, an image with no alt text, an
unclosed `<b>` tag, an expired sale — it lists every problem and saves nothing.
Fix the listed items and save again. This is deliberate: a broken header can
never ship from this page.

## Seeing what's working — "Last 30 days"

At the bottom of the page is a report:

- **Tip line (NBA) by segment** — how often the helper tip under the search box
  was seen, clicked and dismissed, split by new / returning / signed-in visitors.
- **Suggestion CTR** — how often a search suggestion was clicked after being
  shown.
- **Mini-cart → checkout** — how often opening the mini-cart led to checkout.
- **Top zero-result searches** — what customers searched for and found nothing.
  This is your best list of products to add or words to alias.
- **Battery-finder submits** — the phone/laptop models people looked up.

Rates are hidden until there is enough data to trust them (a handful of clicks is
not a real percentage), so a new metric may read "below sample floor" for a while.
