# GoldPlus image specification — for the design team

Every number here was read from the live code on 2026-09-22 (file references at the end of each section). "Deliver" is what we need from you; "the site makes" is what our pipeline generates automatically from it.

**Two rules that apply to everything**

1. Deliver **one master per image** at the size below. The site resizes and converts (AVIF, WebP, JPEG) automatically. Do not send `@2x`, `@3x` or pre-made variants.
2. **JPEG for photographs, PNG only for flat graphics and logos, SVG for logos and icons.** Never a PNG photograph.

---

## 1. Homepage hero — the priority

The hero box is **up to 1100 px wide and 452–520 px tall** on desktop, full width on phones. There are two slide types.

### 1a. Bleed slide (full-photo background)

| | |
|---|---|
| **Deliver** | **2400 × 1600 px**, JPEG quality 80–85 |
| Aspect | 3:2 landscape |
| Crop behaviour | Fills the box and is cropped; anchored to the **right on desktop**, centre-28 % on phones |
| Safe area | Keep the **left third and the bottom half simple** — headline and buttons sit there |
| The site makes | 480 px and 760 px AVIF + WebP |
| Budget | ≤ 60 KB per generated file (we handle that) |

> **Current gap:** the three shipped hero photos are only **760 px wide** (`ambassador.jpg` 760×460, `new-arrivals.jpg` and `range.jpg` 760×507). The slot renders up to 1100 CSS px, so they are being stretched on desktop and on any retina screen. **Re-supplying these three at 2400 × 1600 is the single highest-value image job on the site.**

### 1b. Stage slide (product floating on an arch)

| | |
|---|---|
| **Deliver** | **1600 × 1600 px square**, JPEG quality 80–85, **plain white background** |
| Rendered at | 288–460 px on desktop, 132–190 px on phones (the product occupies 74 % of that) |
| Important | The product is composited with multiply blending — the background must be **pure white**, no shadows bleeding to the edges, no drop shadow baked in |

*Source: `apps/web/src/components/hero/HeroSlider.astro`, `apps/web/static-images.config.json`, `docs/hero/HERO-GUIDE.md`.*

---

## 2. Product photography (the gallery)

Four slots per product. This is the most valuable work after the hero.

| | |
|---|---|
| **Deliver** | **2000 × 2000 px square** (minimum 1200 × 1200), JPEG quality 80–85 |
| Aspect | 1:1, always |
| Background | Plain white or very light, even lighting, true colours |
| Framing | Product fills **70–85 %** of the frame; nothing clipped at the edges |
| No | Text, badges, price overlays, spec panels, collages, drop shadows on transparent backgrounds |
| The site makes | 160 px (thumbnail), 480 px (card), 1024 px (product page), 2048 px (reserve) — in AVIF, WebP and JPEG |
| Max file | 15 MB per upload |

**The four frames per product:**

| Slot | Name | Answers |
|---|---|---|
| 1 | Cover | What exactly am I buying? Product alone, correct model and colour |
| 2 | Alternate | What can't I see from the cover? Back, side, open case, connector |
| 3 | Detail | Will this fit me? The port, plug, label, printed code, a control |
| 4 | Context | How big is it, what's in the box? Honest scale or the actual contents |

**Naming for bulk delivery:** `SKU__01-main.jpg`, `SKU__02-alt.jpg`, `SKU__03-detail.jpg`, `SKU__04-context.jpg` (e.g. `GP-C08__01-main.jpg`). The number is the slot.

*Source: `apps/api/src/infrastructure/media/SharpVariantGenerator.ts`, `docs/media/GOLDPLUS_FOCUS4_MEDIA_STANDARD.md`.*

---

## 3. Everything else, in one table

| Slot | Where it appears | Deliver | Aspect / notes |
|---|---|---|---|
| Category tile | Homepage category grid | **1200 × 1200** JPEG, white background | 1:1; renders 120–190 px; multiply blend, so pure white |
| Mega-menu featured card | Header dropdown | **1200 × 1200** JPEG, white background | Renders in a 132 px arch; current default is 600 × 600 |
| Mega-menu category icon | Header dropdown matrix | **204 × 204** PNG or WebP | Renders 34 × 34; current files are 102 × 102 |
| Ambassador portrait | Homepage, the row above the footer (5 across on a computer) | **1200 × 2000** JPEG or larger, the person holding the GoldPlus product, no text on the photo | **3:5 portrait**, cropped to fill (top of the head kept). A **signed photo release** must be on file before it is published. We make the 480 / 1024 / 2048 px WebP renditions; phone photos may be sent as shot (orientation is honoured) |
| Blog cover | Blog index and post | **1920 × 1080** JPEG | **16:9**, cropped to fill |
| Blog related product | Blog post footer | uses the product cover | — |
| Cart line, compare, battery finder | Cart, compare, finder | uses the product cover | Renders 72–96 px |
| Wordmark | Site header | **640 × 184** PNG (transparent) or SVG | Renders 30 px tall (26 px, 23 px on smaller screens); master today 480 × 138 |
| Payment logos | Footer | **SVG preferred** | Rendered 20–36 px tall |
| Share image (default) | WhatsApp, Facebook, X | **1200 × 630** PNG or JPEG | Exact size; used when a page has no product photo |
| App icons | Installed app, browser tab | **512 × 512** PNG plus a **512 × 512 maskable** version (keep content inside the central 80 %) | We derive 192 px and the 180 px Apple icon |
| Favicon | Browser tab | **SVG** plus a 32 × 32 ICO | — |

*Source: `apps/web/src/pages/index.astro`, `GpNav.astro`, `components/home/AmbassadorsRail.astro`, `blog/*.astro`, `BaseLayout.astro`, `public/manifest.json`.*

**When someone withdraws consent for their portrait:** in `/admin/homepage/ambassadors` tick *Remove this person* and save (they leave the homepage within a minute); then delete the photo in `/admin/media` — it can be deleted once no page uses it. Copies already cached by browsers or search engines can take time to expire. Archiving a photo is refused while a page still uses it, because archiving never took a photo off the site.

---

## 4. Weight budgets the site enforces

These are checked automatically; a file over budget fails the build.

| Folder | Max width | Max file size |
|---|---|---|
| `hero/` | 1600 px | 60 KB per generated file |
| `nav/` | 400 px | 20 KB |
| `products/` (legacy static) | 2048 px | 260 KB |
| Root (icons, share image) | 1280 px | 80 KB |

Uploaded product photography is not bound by these; it goes through the rendition pipeline.

*Source: `apps/web/static-images.config.json`.*

---

## 5. Priority order

1. **Three hero bleed photos at 2400 × 1600** — they are the first thing every visitor sees and are currently upscaled from 760 px.
2. **Four frames for the 23 photographed products** — they show one photo repeated as a labelled sample today.
3. **Cover photos for the 160 products with no photograph** — they show a placeholder card today.
4. Category tiles and mega-menu featured cards at 1200 × 1200.
5. Wordmark at 640 × 184 and the maskable app icon.
