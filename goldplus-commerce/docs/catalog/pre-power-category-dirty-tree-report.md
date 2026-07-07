# Pre-Power Category Dirty Tree Report

## Branch Information
- **Current Branch**: `phase-1-functional-depth`
- **Current HEAD Commit**: `33d0e9d`

## Modified Files
- `apps/api/src/application/ports/IOutboxRepository.ts`
- `apps/api/src/application/use-cases/commerce/CheckoutUseCase.ts`
- `apps/api/src/application/use-cases/notifications/NotificationEventRegistry.ts`
- `apps/api/src/application/use-cases/notifications/NotificationTemplateRenderer.ts`
- `apps/api/src/application/use-cases/notifications/NotificationTruthfulnessPolicy.ts`
- `apps/api/src/application/use-cases/payments/StartPesaPalPaymentUseCase.ts`
- `apps/api/src/application/use-cases/payments/VerifyPesaPalPaymentUseCase.ts`
- `apps/api/src/infrastructure/Registry.ts`
- `apps/api/src/infrastructure/db/repositories/DrizzleOutboxRepository.ts`
- `apps/api/src/infrastructure/notifications/NotificationRouter.ts`
- `apps/api/src/infrastructure/notifications/zeptomail/ZeptoMailAdapter.ts`
- `apps/web/src/components/UgandaLocationPicker.astro`
- `apps/web/src/layouts/BaseLayout.astro`
- `tests/unit/NotificationEventRegistry.test.ts`
- `tests/unit/NotificationTemplates.test.ts`

## Untracked Files
- `../.env.production.server`
- `../PowerBanks/`
- `Caddyfile`
- `Dockerfile.api`
- `Dockerfile.web`
- `apps/api/src/application/use-cases/notifications/EnqueueNotificationEventUseCase.ts`
- `apps/web/public/payment/airtel-money.png`
- `docs/checkout-pesapal-flow.md`
- `docs/production-deployment.md`
- `implementation_plan.md`
- `tests/unit/qa-notification-lifecycle.test.ts`
- `../logos/`

## Deleted Files
- None

## Workstream Classification
- **PesaPal/payment**: Modified checkout and payment use cases, untracked Airtel Money image.
- **Outbox/notifications**: Numerous notification templates, registry, policies, router, ZeptoMail adapter, outbox repository.
- **Routing**: `UgandaLocationPicker.astro`, `BaseLayout.astro`.
- **Docs**: `docs/checkout-pesapal-flow.md`, `docs/production-deployment.md`, `implementation_plan.md`.
- **Generated/build output**: None explicitly (unless Caddy/Dockerfiles are considered related to deployment context).
- **Secrets**: `../.env.production.server` (Note: This is located outside the current repository `goldplus-commerce`, but is detected by `git` since it's an untracked file in the parent folder, though `git` typically won't track above repo root unless run from a parent repo or `git status` behaves weirdly here. Regardless, `.env.production.server` is a secret).

## Recommendation for Preservation Method
1. Create a WIP backup branch.
2. Stage all the files listed in Modified and Untracked, **EXCEPT** for `../.env.production.server`, `../PowerBanks/`, and `../logos/`.
3. Commit with a message: `chore(wip): preserve payment notification work before catalogue pass`.
4. Switch back to the main branch to proceed cleanly.
