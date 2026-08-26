# Operating the battery catalogue

Everything below is done from the admin site. None of it needs a developer, a
deploy, a seed file or a SQL prompt.

## The one rule the whole module is built on

**One physical battery is one product.** It has one code, one price, one stock
balance and one page, and it fits as many phones as you have checked. Never
create a second product for a second phone.

## Where things are

| I want to | Go to |
|---|---|
| See what needs my attention | `/admin/batteries` |
| Add a battery, or find one before I duplicate it | `/admin/batteries/catalogue` (Quick add) |
| Edit one battery, its codes, photos, price, stock | `/admin/batteries/catalogue/<id>` |
| Add a phone brand, series or exact model | `/admin/batteries/devices` |
| Say a battery fits a phone, or check someone's claim | `/admin/batteries/compatibility` |
| Receive a delivery or count the shelf | `/admin/batteries/stock` |
| Load a spreadsheet | `/admin/batteries/imports` |
| See what customers searched for and asked for | `/admin/batteries/demand` |
| Change the wording customers read on the finder | `/admin/batteries/finder-settings` |

## Adding one battery, end to end

1. **Quick add.** Scan the barcode or type the code. If it already exists you are
   sent to it, so the same battery is never created twice.
2. **Fill in what the pack says.** Capacity, voltage, warranty, barcode,
   supplier. Leave anything you do not know blank. Never guess: a blank field is
   honest, a guessed one is a promise to a customer you cannot keep.
3. **Photograph it.** Front, back, the printed label, the connector, the
   packaging. Tick "use as the product photo" for the one customers should see.
4. **Record the stock.** Opening stock, or a receipt. Even zero must be recorded,
   because "never counted" and "counted zero" are different facts.
5. **Set the price.** It must be at least UGX 145,000 or publication is refused.
6. **Connect the phones it fits** (see below).
7. **Confirm the pack** (the Verify button). A second person should do this.
8. **Publish.** The checklist on the right tells you exactly what is still
   missing; the button is refused until nothing is.

## Saying a battery fits a phone

A claim goes **draft → submitted → checked → published**, and two different
people must be involved:

- Anyone with *propose* may create and submit a claim.
- **The person who entered or submitted it cannot check it.** A second person
  looks at the evidence and decides.
- Checking needs real evidence: the GoldPlus pack, a fit test, or an exact
  confirmation. "A supplier lists it" is not verification and stays labelled as
  unchecked.
- A **conditional** fit must say its condition, in words a customer will read.
- Only a published claim reaches a customer, and it is labelled for what it is.

You can pick several phones at once to save typing. Each one still becomes its
own claim and is still checked on its own.

## Loading a spreadsheet

Upload → map the columns → dry run → resolve anything held → a **second person**
approves → apply. An import never publishes anything: everything it creates is a
draft for someone to check.

Two kinds of row are always **held** for a person, never guessed:

- **Compound codes** (`15GI/4LT`, `49CI/CT`, `49LT/49LX`, `20NT/NI`, `29FT/FI`,
  `38CT/CI`, `34DT/30VX`, `15FI/FT`, `11DI/DT`, `19CI/CT`). One line, two
  references. Look at the pack and say which single code it becomes, or leave it
  out.
- **Named conflicts**: `NOTE 4 EDGE`, `NOTE 4 EDGE PLUS`, `39LT9`, `OPPO A57`,
  `A03/A04`, and `49FX` claimed across Pop 5, Smart 6 and Smart 7.

Uploading the same file twice reuses the same import. It does not create
anything a second time.

`DC3650 WIFI BIG` and `4G WIFI SMALL` land under **MiFi & Router Batteries**.
"Big" and "small" are descriptions, not model numbers, so they stay in review
until the real model is captured.

## Stock

Nothing changes a balance without a movement, and every movement needs a reason.
Receipts add, damage and loss remove, counts and corrections set the balance and
record the difference. Stock is refused below zero and below what is reserved for
open orders. A count that differs from the system needs a reason before it can be
applied.

Unit costs are supplier information. Only an operator with the cost right can
enter or see them, and they never reach a public page.

## What a customer sees

| We recorded | They read |
|---|---|
| Checked by us, in stock | Verified fit, in stock |
| Checked by us, none on the shelf | Verified fit, out of stock |
| Checked, with a caveat | Fits with a condition, and the condition |
| A supplier lists it, we have not checked | Listed by the supplier, not yet checked by us |
| Anything not published | Nothing at all |

A phone that is not listed has not been checked. We say that rather than guess,
and the customer can ask us to check it. Those requests land in
`/admin/batteries/demand`.

## The improvement loop

`/admin/batteries/demand` shows what people searched for and what we could not
answer. Working a row there is how the catalogue improves:

- a search that only worked through an alias → add the alias properly,
- a phone people search for with no battery → add the phone and the claim,
- a request from a customer → map it, or say it is not real, and record why.
