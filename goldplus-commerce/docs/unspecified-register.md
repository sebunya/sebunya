# Unspecified Requirements & Missing Files Register

| Item | Description | Mitigation Strategy | Owner Review Status |
|------|-------------|---------------------|---------------------|
| Product Seed Data | `product_catalog.xlsx` or `.csv` files were not found in the root directory. | Generated safe sample data inside `scripts/seed.ts` using the strict requirement "Missing. Requires admin review." where applicable. | Pending |
| External Auth | ZeptoMail/WhatsApp Tokens missing | Mocked out interfaces for MVP Phase 1 | Pending |
| Payment Gateway | Real credentials missing | Used sandbox endpoints | Pending |
