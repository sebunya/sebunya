# Kenya: second market readiness

Owner decision 2026-11-05: Kenya is the next country. This file is the plan and the register of what is done in code,
what still names Uganda, and what only the owner can do. Kenya switches on by setting `live: true` on `MARKETS.KE` in
packages/shared/src/markets/index.ts, and only after every owner item below is done.

## Done in code (PR "markets: Kenya groundwork")

| Item | Where | State |
|---|---|---|
| One record per country: currency, dialling code, phone shape, locale, timezone, VAT %, tax authority, mobile money | packages/shared/src/markets | Uganda live, Kenya configured and off |
| Phone normalisation per market (Kenya 07/01 numbers, +254) | `normalizeMarketPhone`, `marketForPhone` | Done, tested against the Uganda helper |
| Money formatting per currency, ISO code shown (`KES 1,250`) | `formatMoney`; the storefront's `formatUgx` now calls it | Done, output for UGX unchanged |
| Time | Kenya is UTC+03:00 with no DST, the same as Kampala | Nothing to change: the EAT module is correct for Nairobi |
| Dealer listings carry a country (UG/KE) | 0219, /dealers | Done |

## Still Uganda-only in code (the refactor, in order)

1. **Prices**: products carry `retail_price_ugx` only. Kenya needs a KES price column per product (or a price list per
   market) and the catalogue, cart, checkout and feeds reading the shopper's market. Largest single change; needs the
   owner's KES price list first, because converting at the exchange rate is not a price.
2. **Phone checks duplicated outside the shared helper** (12 files, all Uganda-shaped): the Goldie assistant
   (goldieCare, goldieAnswerMemory, goldieTurn, AnswerMemory), gift-card buy page, basket stop token, loyalty identity,
   ad platform contact hashing (AdPlatforms, ContactNormalisation, PhoneHygiene), user repository, fulfilment alerts.
   Each moves to `normalizeMarketPhone` when Kenya goes live; changing them earlier only risks Uganda.
3. **Currency literals**: about 250 files name UGX (formatting, column names, copy). Formatting moves to `formatMoney`;
   column names stay (they are the Uganda price) until the price model in item 1 lands.
4. **Places**: the gazetteer, districts, delivery fee ladder and bus rates are Ugandan data. Kenya needs its own delivery
   partner's coverage, not a copy.
5. **Tax**: URA EFRIS is Uganda's e-invoicing; Kenya uses KRA eTIMS. A separate integration.
6. **Copy**: "Kampala", "Uganda" and "+256" in customer copy are correct for the Uganda storefront; a Kenyan storefront
   gets its own copy per market, not a find-and-replace.
7. **Domain and routing**: decide shopgoldplus.co.ke versus shopgoldplus.com/ke; the market is then read from the host
   or path, never guessed from IP.

## Owner checklist (nothing in code can do these)

- [ ] KES price list for the products to sell in Kenya.
- [ ] A Kenyan payment account: Pesapal Kenya (M-Pesa, Airtel Money, cards) on a Kenyan merchant profile.
- [ ] A delivery partner in Kenya (Nairobi first) and their rates.
- [ ] KRA PIN and VAT/eTIMS registration, or a local distributor who holds them.
- [ ] Import route and duties for stock entering Kenya (or stock held by a Kenyan dealer).
- [ ] Domain choice: .co.ke or /ke.
- [ ] Ad accounts targeting Kenya (Meta, Google, TikTok all accept Kenya; TikTok does not accept Uganda).
