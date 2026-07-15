# API ↔ Use-case ↔ Repository Matrix

Generated @ 4b4016c. Full per-endpoint mapping lives in docs/api-map.md; this matrix
tracks vertical completeness per application area.

## Use-case areas (apps/api/src/application/use-cases + application/recommendations)
```
DealerApplicationUseCase.ts
PublishProductUseCase.ts
VerificationCheckUseCase.ts
activation
addresses
admin
advertising
audit
checkout
commerce
consent
governance
identity
leads
measurement
notifications
orders
outbox
payments
preferences
product-finder
products
quotes
release
system
telemetry
verification
recommendations/ (25 modules — see application/recommendations)
```

## Ports (apps/api/src/application/ports)
```
IAddressRepository.ts
IAdminRoleReadRepository.ts
IAdminUserReadRepository.ts
IAttributeRepository.ts
IAuditRepository.ts
ICartQueryRepository.ts
ICustomerOrderRepository.ts
IFakeReportRepository.ts
IIdentityRepository.ts
INotificationAttemptRepository.ts
INotificationProvider.ts
IOutboxRepository.ts
IPasswordHasher.ts
IPaymentRepository.ts
IPesaPalClient.ts
IPesaPalPaymentRepository.ts
IProductImageRepository.ts
IProductImageStorage.ts
IProductRecommendationReader.ts
IProductRepository.ts
IQuoteRepository.ts
IRecommendationAnalyticsRepository.ts
IRecommendationEventRepository.ts
IRecommendationRuleAuditRepository.ts
IRecommendationRuleRepository.ts
IRoleRepository.ts
ISupportRepository.ts
ISystemHealthRepository.ts
ITokenSigner.ts
IUserRepository.ts
activation
admin
consent
index.ts
measurement
preferences
product-finder
release
```

## Drizzle repositories (apps/api/src/infrastructure/db/repositories)
```
DrizzleAddressRepository.ts
DrizzleAdminRoleReadRepository.ts
DrizzleAdminUserReadRepository.ts
DrizzleAttributeRepository.ts
DrizzleAuditRepository.ts
DrizzleCartQueryRepository.ts
DrizzleCartRepository.ts
DrizzleDealerRepository.ts
DrizzleFakeReportRepository.ts
DrizzleIdentityRepository.ts
DrizzleNotificationAttemptRepository.ts
DrizzleOrderRepository.ts
DrizzleOutboxRepository.ts
DrizzlePaymentAttemptRepository.ts
DrizzlePaymentRepository.ts
DrizzleProductImageRepository.ts
DrizzleProductRecommendationReader.ts
DrizzleProductRepository.ts
DrizzleQuoteRepository.ts
DrizzleRecommendationAnalyticsRepository.ts
DrizzleRecommendationEventRepository.ts
DrizzleRecommendationRuleAuditRepository.ts
DrizzleRecommendationRuleRepository.ts
DrizzleRoleRepository.ts
DrizzleSupportRepository.ts
DrizzleSystemHealthRepository.ts
DrizzleUserRepository.ts
DrizzleVerificationRepository.ts
```

## Known vertical gaps (from master ledger)
- Slice 3: no location/delivery-fee use case or repository
- Slice 4: no autocomplete use case; zero-result capture limited to CreateLeadUseCase
- Slice 5: compatibility exists only inside recommendations (CompatibilityRuleService)
- Slice 8: no loyalty domain/use case/port/repo (deliberate truthful placeholder)
- Slice 9: no lifecycle/NBA use cases (consent+preferences foundations exist)
- Slice 11: support has open-ticket only; no admin inbox/assignment/SLA use cases
