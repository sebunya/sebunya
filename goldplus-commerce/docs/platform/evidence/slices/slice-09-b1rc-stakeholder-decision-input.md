# Slice 9-B1RC sponsor-attributed interim stakeholder decision input

## Decision authority

- **Decision authority:** Robert Sebunya, Business Sponsor and accountable product owner for GoldPlus Commerce OS next-phase planning.
- **Decision date:** 2026-07-15 (Africa/Kampala local date).
- **Decision scope:** Authorize Slice 9-B2 to proceed as design-only only.
- **Rationale:** Slice 9-B2 is required to produce design proposals for specialist review. Formal specialist approvals remain mandatory before any implementation slice.

This input records sponsor-attributed interim decisions for design planning. It is not final specialist approval and is not final legal, privacy/data-protection, security, operator/support, provider/channel, or data-owner/analytics approval.

## Excluded scope

- No persistence.
- No migrations or tables.
- No API mutations or mutation endpoints.
- No preference saving or customer writes.
- No provider enforcement.
- No WhatsApp, email, or SMS sends.
- No customer communications.
- No loyalty activation.
- No Memory Lane activation.
- No personalisation activation.
- No utilisation-aware offers.
- No discounts or coupons.
- No checkout/payment changes.
- No auth/RBAC changes.

## Sponsor-attributed interim decisions

All statuses below mean `approved with conditions` for Slice 9-B2 design-only. Every condition blocks later implementation where stated but does not block design-only proposals. Robert Sebunya owns each condition as Business Sponsor until the required specialist reviewer is assigned.

| Stakeholder group | Decision owner and attribution | Status | Decision and scope | Condition | Condition owner | Due date | Severity | Future persistence impact | Future provider-enforcement impact | Blocks 9-B2 design-only | Evidence reviewed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Legal | Robert Sebunya, Business Sponsor; interim design-planning decision, not legal sign-off | approved with conditions | 9-B2 may document legal-facing proposals and open legal questions only. | Formal legal review must approve purpose classification, withdrawal rights, retention, terms/privacy updates, and policy basis. | Robert Sebunya, to assign formal legal reviewer | Before any implementation, migration, persistence, provider-enforcement, or customer-communication slice is authorized | Critical | Blocking | Blocking | No | 9-B1R approval record, 9-B1RA review pack, 9-B1RB distribution pack, red-line register |
| Privacy/data protection | Robert Sebunya, Business Sponsor; interim design-planning decision, not privacy sign-off | approved with conditions | 9-B2 may design identity, copy-versioning, retention, withdrawal, minimisation, and support-evidence proposals only. | Formal privacy review must approve identity verification, minimisation, retention/deletion, copy-version evidence, and provider callback handling. | Robert Sebunya, to assign privacy/data-protection reviewer | Before any implementation, migration, persistence, provider-enforcement, or customer-communication slice is authorized | Critical | Blocking | Blocking | No | 9-B1R approval record, 9-B1RA review pack, 9-B1RB distribution pack, red-line register |
| Security | Robert Sebunya, Business Sponsor; interim design-planning decision, not security sign-off | approved with conditions | 9-B2 may design authentication, authorization, tamper-evident audit, callback verification, and replay/fraud-control proposals only. | Formal security review must approve mutation authentication, admin/support authorization, tamper evidence, callback verification, audit protection, and abuse controls. | Robert Sebunya, to assign security reviewer | Before any implementation, migration, persistence, provider-enforcement, or customer-communication slice is authorized | Critical | Blocking | Blocking | No | 9-B1R approval record, 9-B1RA review pack, 9-B1RB distribution pack, red-line register |
| Product | Robert Sebunya, Business Sponsor and product owner | approved with conditions | 9-B2 may design preference concepts, pending-verification UX, inactive-state copy, and purpose explanations only. | Product approval is required before saved/updated/subscribed, loyalty, Memory Lane, personalisation, discount, or offer-activation copy goes live. | Robert Sebunya | Before runtime implementation or customer-facing saved-preference UX is authorized | High | High | Medium | No | 9-B1R approval record, 9-B1RA review pack, 9-B1RB distribution pack, red-line register |
| Operator/support | Robert Sebunya, Business Sponsor; interim design-planning decision, not operator/support sign-off | approved with conditions | 9-B2 may design support-assisted workflow, verification scripts, dispute path, and SLA proposals only. | Formal operator/support review must approve scripts, verification, SLA, disputes, and manual-correction controls. | Robert Sebunya, to assign operator/support reviewer | Before any support-assisted preference-update workflow is implemented | High | Blocking | Medium | No | 9-B1R approval record, 9-B1RA review pack, 9-B1RB distribution pack, red-line register |
| Provider/channel owner | Robert Sebunya, Business Sponsor; interim design-planning decision, not provider/channel sign-off | approved with conditions | 9-B2 may design provider dry-run, STOP/unsubscribe, template-readiness, and suppression proposals only. | Formal provider/channel review must approve WhatsApp templates, email unsubscribe, SMS opt-out, STOP handling, suppression, and dry-run evidence. | Robert Sebunya, to assign provider/channel reviewer | Before any provider dry-run implementation or live-send authorization | Critical | Medium | Blocking | No | 9-B1R approval record, 9-B1RA review pack, 9-B1RB distribution pack, red-line register |
| Data owner/analytics | Robert Sebunya, Business Sponsor; interim design-planning decision, not data-owner sign-off | approved with conditions | 9-B2 may design canonical ownership, taxonomy versioning, reporting, reconciliation, and Measurement-separation proposals only. | Formal data-owner review must approve canonical ownership, taxonomy ownership, reporting boundaries, reconciliation, and Measurement/messaging separation. | Robert Sebunya, to assign data owner/analytics reviewer | Before canonical consent persistence, reporting, or provider-enforcement implementation is authorized | High | Blocking | High | No | 9-B1R approval record, 9-B1RA review pack, 9-B1RB distribution pack, red-line register |
| Business sponsor | Robert Sebunya | approved with conditions | Slice 9-B2 is explicitly authorized as design-only; no implementation is authorized. | 9-B2 must produce proposals only and must not implement any excluded capability. | Robert Sebunya | Applies throughout Slice 9-B2; implementation requires separate authorization after specialist review | Critical | Blocking | Blocking | No | Sponsor decision statement dated 2026-07-15 and prior Slice 9-B1R/9-B1RA/9-B1RB evidence |

## Non-waivable red lines

1. Checkout contact is not marketing consent.
2. Support conversation is not campaign consent.
3. Legacy broad flags are not canonical purpose consent.
4. Measurement consent is not messaging consent.
5. Loyalty interest is not Memory Lane consent.
6. Memory Lane consent is not utilisation-aware offer consent.
7. Provider STOP overrides local optional marketing preference.
8. Withdrawal wins over marketing.
9. Unknown intent cannot authorize provider sends.
10. No provider sends before dry-run enforcement.
11. No persistence before identity and audit model.
12. No manual override without audit.

No sponsor condition waives or alters these red lines.
