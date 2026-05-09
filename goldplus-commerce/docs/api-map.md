# GoldPlus API Map

| Route | Method | Access | Description |
|-------|--------|--------|-------------|
| `/api/health` | GET | Public | Health check |
| `/api/products` | GET | Public | List products (only published) |
| `/api/products/:id` | GET | Public | Get product details |
| `/api/admin/products` | POST | Admin | Create/Update product |
| `/api/webhooks/payment/mtn` | POST | Webhook | Handle MTN webhook |
| `/api/webhooks/payment/airtel` | POST | Webhook | Handle Airtel webhook |

*Note: All mutations route to use cases in `apps/api/src/application/use-cases`.*
