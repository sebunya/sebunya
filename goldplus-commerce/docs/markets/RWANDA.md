# Rwanda: market readiness

Owner decision 2026-11-05: Rwanda alongside Kenya. Rwanda switches on by setting `live: true` on `MARKETS.RW` in
packages/shared/src/markets/index.ts, only after every owner item below is done. Read with docs/markets/KENYA.md: the
refactor list there (prices per market, duplicated phone checks, currency literals, places, copy, domain) applies here too.

## Done in code

| Item | State |
|---|---|
| Market record: RWF, +250, mobile 072/073 (Airtel) and 078/079 (MTN), en-RW, Africa/Kigali, VAT 18 %, RRA, MTN MoMo + Airtel Money | Configured, off |
| Phone normalisation (`normalizeMarketPhone`, `marketForPhone`) and money formatting (`RWF 15,000`) | Done, tested |
| UTC offset per market (`MARKET_UTC_OFFSET_MINUTES`: UG 180, KE 180, RW 120) | Done |
| Dealer listings can carry country RW | Done (0219 country column; admin select lists Rwanda) |

## Different from Uganda and Kenya

- **Time zone.** Kigali is UTC+02:00, one hour behind Kampala and Nairobi. The EAT module (packages/shared/src/time/eat.ts,
  fixed +03:00) drives same-day cut-offs, delivery windows, scheduled sends and reports; 147 files name Africa/Kampala.
  A Rwandan storefront needs those to read the market's offset. This is the one piece of the Kenya plan that is NOT
  free for Rwanda.
- **Tax.** RRA's EBM (electronic billing machine / EBM v2 API) is the e-invoicing system, not URA EFRIS or KRA eTIMS.
- **Language.** English is an official language and fine for launch; Kinyarwanda (and French) copy is a later choice.
- **Google Ads.** The Google Ads sign-up (916-133-9749) is currently set to Rwanda as its country and time zone. That
  account serves ads anywhere; its country is the billing country. Decide which country bills, then finish the sign-up.

## Owner checklist

- [ ] RWF price list.
- [ ] A Rwandan payment account taking MTN MoMo and Airtel Money. First ask Pesapal whether the existing relationship
      can add a Rwandan merchant profile; otherwise a local aggregator.
- [ ] A delivery partner in Kigali and their rates.
- [ ] RRA TIN, VAT and EBM registration, or a local distributor who holds them.
- [ ] Import route and duties into Rwanda (EAC member, like Uganda and Kenya).
- [ ] Domain choice: .rw or /rw.
- [ ] Ad accounts targeting Rwanda (Meta and Google serve Rwanda; check TikTok and Snapchat sign-up lists for Rwanda
      before planning on them, as both refused Uganda).
