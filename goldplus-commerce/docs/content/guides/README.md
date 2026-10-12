# Guides: ready-to-publish drafts

Three articles for the empty blog (design audit 37), written in the blog's own
article markup (`# heading`, `- bullet`, `**bold**`, `[text](/path)`), so they
paste straight into the editor.

| File | Article |
|---|---|
| `01-find-the-right-phone-battery.md` | How to find the right replacement battery for your phone |
| `02-power-bank-capacity-explained.md` | Power bank capacity explained: what 10,000mAh really gives you |
| `03-charger-watts-explained.md` | Charger watts explained: how to read a charger's real power |

## Publishing one

1. Open **/admin/blog/new**.
2. Copy each labelled line at the top of the file into its box: **Title**, **Summary**, **Meta title**, **Meta description**.
3. Copy everything under the `---- Article ----` line into **Article**.
4. Pick two or three **related products** (the file suggests which kind).
5. Add a cover photo if you have one, then **Save**, read the preview, and **Publish**.

## Publishing all of them at once (host, inside the API builder image)

`publish-guides.ts` reads every numbered file here (the image carries no docs/, so the host folder is mounted), creates or updates the
article through the blog's own use cases (audited), resolves the `Related SKUs:`
line to live products, and publishes unless the file says `Publish: hold`.
Guide 03 is on hold until the charger labels below are checked.

```
docker run --rm --network goldplus-commerce_default --env-file .env.production \
  -e NODE_ENV=production -e DRY_RUN=1 -e ACTOR_USER_ID=<admin uuid> \
  -v /opt/goldplus/app/goldplus-commerce/docs/content/guides:/guides:ro -e GUIDES_DIR=/guides \
  -w /app/apps/api goldplus-migrator:<sha> \
  npx tsx src/scripts/publish-guides.ts
```

Read the dry-run lines (which articles are created, updated, published or held,
and the links each one carries), then rerun with `DRY_RUN=0`. Re-running is
safe: a published article keeps its URL and its first publish date.

## Before publishing guide 03

Guide 03 teaches readers to check a charger's real power on its label
(volts × amps). Four listings currently claim more than their own output
tables allow, and a reader who follows the guide will notice:

- GP-C10 "100W": listed outputs 5V⎓3A, 9V⎓2.2A, 12V⎓1.6A, which is about 20W at most.
- GP-C12 and GP-C13 "50W GaN": the same output table, about 20W at most.
- GP-CA01 "65W": listed outputs reach about 48W.

Check each against the label printed on the charger itself, then correct
either the wattage in the name and specs or the output table. Publish guide 03
after that.

## Rules these drafts follow

- No claim about a specific GoldPlus product that the listing does not already make.
- General facts only where they are standard: lithium charging maths, the
  airline watt-hour limits, USB PD and Quick Charge, the UK-style plug.
- Every promise about the shop (same-day delivery, the shop address, WhatsApp
  help, the battery finder) is one the site already publishes.
