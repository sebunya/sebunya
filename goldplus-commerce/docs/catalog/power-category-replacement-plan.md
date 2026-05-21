# Power Category Replacement Plan

## 1. Product Data Source Found
`goldplus-commerce/apps/web/src/lib/catalog/catalog.ts` (specifically the `LOCAL_SEED_PRODUCTS` array).

## 2. Current Power Category Products
- `generic-fast-charger`
- `reinforced-usb-c-cable`
- `heavy-duty-power-bank`

## 3. Products to Remove from Power
All 3 current Power category products will be removed from `LOCAL_SEED_PRODUCTS`.

## 4. Final Six Products to Add
1. **GoldPlus Built-In Cable Power Bank** (`GP-PD-W3`)
2. **GoldPlus 100W Portable Power Station** (`GP-09`)
3. **GoldPlus Digital Display Power Bank** (`GP-P07`)
4. **GoldPlus Magnetic Power Bank** (`GP-03`)
5. **GoldPlus Power Bank with Handle** (`GP-X03`)
6. **GoldPlus Slim Power Bank** (`GP-04`)

*(Products 1, 2, 3, and 4 will be positioned as featured in standard layouts if applicable, but `LOCAL_SEED_PRODUCTS` does not use a direct featured flag, we will simply replace them in the array)*

## 5. Image Source Folder
`~/Documents/GitHub_Projects/GoldPlusFinal/PowerBanks`

## 6. Image Destination Folder
We will copy them to `goldplus-commerce/apps/web/public/images/products/` (Need to verify this is the actual image path convention based on current `primaryImageUrl`). Wait, `LOCAL_SEED_PRODUCTS` currently uses unsplash URLs. Let's create an `assets` or `images` directory in public, maybe `goldplus-commerce/apps/web/public/products/`. I will verify the destination. If there is no specific directory, I'll use `/images/products/`.

## 7. Price Handling Decision
`ProductPublicDto` supports `retailPriceUgx: number | null`. Since no prices are provided, we will set `retailPriceUgx: null`.

## 8. Confirmation of No Excel/Spec Sheet
Confirmed. No Excel or spec sheet is being used.

## 9. Confirmation that Specs and Prices will not be invented
Confirmed. Specs requiring confirmation will be marked as "Confirm from packaging / official product sheet", and prices will be strictly `null`.

## 10. Files Proposed for Editing
- `goldplus-commerce/apps/web/src/lib/catalog/catalog.ts`
- `goldplus-commerce/apps/web/src/pages/products/[slug].astro`
- `goldplus-commerce/docs/catalog/power-category-replacement-plan.md`
- `goldplus-commerce/docs/catalog/goldplus-power-category-copy-bank.md`
