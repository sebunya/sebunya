# Slice 5-A discovery baseline

The public shop route is `apps/web/src/pages/shop.astro`. It reads the existing `GET /products` public listing API and uses the existing listed-product fallback in `apps/web/src/lib/catalog/catalog.ts` when the API is unavailable. Product tiles use `apps/web/src/components/ProductCard.astro` and link to `/products/{slug}`.

Before Slice 5-A, the shop used `q`, free-form category/sort values, five category controls including unapproved PC Accessories, no approved subcategory controls, a desktop-only primary search form, and recommendation/popularity language in sorting, a category rail, and the empty state. Duplicate suppression was slug-based only during API/local merging, not product-ID based at final rendering. Availability badges could be replaced by merchandising badge text. Unknown availability said `Check Availability`, and present prices used `USh` rather than explicit `UGX`.

In-scope runtime files: the shop route, shared public product card, and a web-only discovery helper. Excluded: API, database, checkout/cart, payment/PesaPal, order state, auth, providers, Measurement, Product Finder, recommendation infrastructure, PDP, homepage, migrations, and customer communications.
