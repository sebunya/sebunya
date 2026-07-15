# Test Coverage Matrix

Generated @ 4b4016c.

| Area | Location | Files |
|---|---|---|
| Unit | tests/unit | 95 |
| Architecture | tests/architecture | 2 |
| UAT measurement control tower | tests/uat/measurement-control-tower | 7 |
| Total *.test.ts | repo-wide | 159 |

Full-suite evidence at head (10-D PRIME, prior session): 157 files / 3,733 tests pass;
protected suites 700/700; hardened 10-C test 440/440.

## Unit test files
```
AddProductImageByUrlUseCase.test.ts
AdminOrderOperations.test.ts
AdminQueues.test.ts
AuthenticateUserUseCase.test.ts
Cart.test.ts
Checkout.test.ts
Commerce.test.ts
CompatibilityRuleService.test.ts
ConsentAwareMeasurementPolicy.test.ts
CreateAuditLogUseCase.test.ts
DateRangeValidation.test.ts
Dealer.test.ts
Deployment.test.ts
FrontendApiNotifications.test.ts
Governance.test.ts
GovernanceAdminReadProtection.test.ts
GtmCredentialRedactor.test.ts
HttpClient.test.ts
ListOrderNotificationsRoute.test.ts
ListOrderNotificationsUseCase.test.ts
NotificationChannelEligibility.test.ts
NotificationEventRegistry.test.ts
NotificationIdempotency.test.ts
NotificationTemplates.test.ts
NotificationTruthfulnessPolicy.test.ts
Observability.test.ts
OrderPrivacyIsolation.test.ts
OrderStateTransitions.test.ts
OrderTracking.test.ts
PaidSocialPayloadRedactor.test.ts
Pass12Validation.test.ts
PlanNotificationEventUseCase.test.ts
ProcessOutboxBatchUseCase.test.ts
ProductEntity.test.ts
ProductFiltering.test.ts
ProductSignalExtractor.test.ts
RecommendationAdminUseCases.test.ts
RecommendationAnalyticsApi.test.ts
RecommendationAnalyticsService.test.ts
RecommendationEligibilityService.test.ts
RecommendationExclusions.test.ts
RecommendationMaterializer.test.ts
RecommendationPipelineIntegrity.test.ts
RecommendationRuleValidationService.test.ts
RecommendationValidation.test.ts
RecordPaymentWebhook.test.ts
RequestQuoteUseCase.test.ts
Sha256MeasurementHashingService.test.ts
Slice02StorefrontP0.test.ts
Slice03BAuthAccessTrustCompileRegression.test.ts
Slice03CheckoutLocationPaymentP0.test.ts
Slice04ProductDetailTrustP0.test.ts
Slice05ProductDiscoveryP0.test.ts
Slice06CustomerSupportOrderConfidenceP0.test.ts
Slice06DLegalPolicyRoutesP0.test.ts
Slice06F0DLiveReviewDateFormatFoundation.test.ts
Slice06FRecommendationsDedupeRulesPreview.test.ts
Slice07AdminTrustCentreP0.test.ts
Slice08B0AdminMeasurementProtection.test.ts
Slice08B1AdminRouteProtectionSweep.test.ts
Slice08LoyaltyGamificationFoundation.test.ts
Slice09B1PreferenceSurfaceReconciliation.test.ts
Slice09B1RAStakeholderReviewPack.test.ts
Slice09B1RBStakeholderDistributionPack.test.ts
Slice09B1RCStakeholderDecisionGate.test.ts
Slice09B1RConsentBoundaryApprovalGate.test.ts
Slice09B2ConsentPersistenceDesignProposal.test.ts
Slice09B3ConsentSchemaAuditCommandFoundation.test.ts
Slice09BConsentPreferenceCentreP0.test.ts
Slice09XPrimeConsentOperatingLayerP0.test.ts
Slice09ZApexProviderReadinessCanaryUAT.test.ts
Slice09ZFApexTransactionalEmailFailureForensics.test.ts
Slice09ZGApexEmailDiagnosticTransportGuard.test.ts
Slice09ZHPrimeEmailDiagnosticRunnerRemediation.test.ts
Slice09ZIPrimeEmailRateLimitRecovery.test.ts
Slice10AB2ApexRing1PilotIdentitySave.test.ts
Slice10ABApexConsentPilotRing.test.ts
Slice10CApexControlledPilotRingExpansion.test.ts
Slice10DBRPrimeBaseImageDigestGuard.test.ts
Slice10DESMPrimeApiRuntimePackaging.test.ts
Slice10DPrimeConsentOperationsControlRoom.test.ts
SmsProvider.test.ts
StorefrontCatalog.test.ts
Support.test.ts
TrackRecommendationEventUseCase.test.ts
UgandaLocationSystem.test.ts
UploadProductImagesUseCase.test.ts
ValidateGtmMeasurementPlanUseCase.test.ts
Verification.test.ts
ZeptoMailProvider.test.ts
homepage-merchandising.test.ts
pesapal-payment.test.ts
product-admin.test.ts
toProductPublicDto.test.ts
visitor-intelligence.test.ts
```

Coverage gaps tracked in master ledger: support admin flows, checkout location/delivery
(not yet implemented), Slice 7 page-state assertions, Lighthouse/WCAG matrices (Slice 13).
