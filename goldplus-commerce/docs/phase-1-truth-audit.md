# Phase 1 Truth Audit

| Module | Files Found | Use Case | Route | Repo Interface | Repo Impl | Validation | Audit/Event | Tests | Verification Status | Repair Needed |
|--------|-------------|----------|-------|----------------|-----------|------------|-------------|-------|---------------------|---------------|
| Identity Foundation | UserEntity.ts, AuthenticateUserUseCase.ts, auth.ts | Yes | Yes | No | No | No | No | No | Not verified | Remove fake mock-token, add NotConfigured response. |
| Audit Logs | AuditLogEntity.ts, CreateAuditLogUseCase.ts | Yes | No | No | No | No | No | No | Not verified | Add repository interface and implementation stub. |
| Products (Catalog) | ProductEntity.ts, CategoryEntity.ts | Yes | Yes | Yes | No | Yes | Yes | Yes | Not verified | None for MVP domain purity, but lacks full repo impl. |
| Cart | CartEntity.ts | No | No | No | No | No | No | No | Not verified | Create missing use case, interface, and route. |
| Checkout | StartCheckoutUseCase.ts | Yes | No | No | No | No | No | No | Not verified | Remove fake 'sess-123', use proper error/interface. |
| Orders | OrderEntity.ts | No | No | No | No | No | No | No | Not verified | Missing use cases. |
| Payments | PaymentStateMachine.ts, PaymentIdempotencyService.ts | Yes | No | Yes | No | Yes | Yes | No | Not verified | Full webhook route needed. |
| Notification Ports | WhatsAppAdapter.ts, ZeptoMailAdapter.ts, DisabledSmsAdapter.ts, INotificationProvider.ts | No | No | Yes | Yes | No | No | No | Not verified | Remove fake `return true`. Return typed `NotConfigured`. |
| Quotes / Leads | RequestQuoteUseCase.ts, CreateLeadUseCase.ts | Yes | No | No | No | Yes | No | No | Not verified | Remove fake `q-123` / `l-123`. |
| Verification / Reports | ReportFakeProductUseCase.ts, VerificationCheckUseCase.ts | Yes | No | No | No | Yes | Yes | No | Not verified | Implement missing repo interfaces. |
| CMS / SEO / AEO | SeoMetadataService.ts | Yes | No | No | No | No | No | No | Not verified | Needs full use case wrapper. |
| Advertising | CampaignReadinessScorer.ts, CreateAttributionEventUseCase.ts | Yes | No | No | No | Yes | No | No | Not verified | Needs repo interfaces. |
