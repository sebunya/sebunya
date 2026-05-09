# Fake Implementation Removal Log

| Fake Pattern Found | File | Risk | Fix Applied | Remaining Concern |
|--------------------|------|------|-------------|-------------------|
| `return { token: "mock-token" }` | `AuthenticateUserUseCase.ts` | Complete bypass of auth | Removed fake success. Returns standard AuthNotReady typed error. | Proper authentication implementation required by Owner. |
| `return c.json({ success: true, token: "mock-token" })` | `routes/auth.ts` | Allows fake logins over API | Fixed to pass error from use case. | None. |
| `return { checkoutSessionId: "sess-123" }` | `StartCheckoutUseCase.ts` | Faking financial transactions | Removed. Throws strict "NotConfigured" error for payment gateway. | Owner must supply payment gateway keys and configure integration. |
| `return true` | `WhatsAppAdapter.ts` | Silently hiding missing configuration | Changed to return `{ success: false, code: "NOT_CONFIGURED" }` | Requires valid WhatsApp Business credentials. |
| `return true` | `ZeptoMailAdapter.ts` | Silently hiding missing configuration | Changed to return `{ success: false, code: "NOT_CONFIGURED" }` | Requires valid ZeptoMail credentials. |
| `return { quoteId: "q-123" }` | `RequestQuoteUseCase.ts` | Pretending a quote was saved | Changed to throw "RepositoryNotImplemented" or "NotConfigured" | Persistence layer needs real wiring. |
| `return { leadId: "l-123" }` | `CreateLeadUseCase.ts` | Pretending a lead was saved | Changed to throw "RepositoryNotImplemented" | Persistence layer needs real wiring. |
