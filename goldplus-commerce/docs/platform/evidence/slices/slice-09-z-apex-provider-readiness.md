# Slice 9-Z APEX provider readiness

## Baseline and backups

- Starting local/remote commit: `ee8b5e81747cf1305a665b16892145bde3749e6f`.
- Branch: `phase-2-measurement-control-tower-completion`.
- Production source backup: `/opt/goldplus/backups/slice-09-z-apex-20260715T081539Z/source-before.tar.gz`, 3,802,000 bytes, SHA-256 `e3358dab62fd0aa2e55b427edcbb13e87b6c33be2a84b72a92265dcb27c82b21`.
- Production database backup: `/opt/goldplus/backups/slice-09-z-apex-20260715T081539Z/database-before.dump`, 295,728 bytes, SHA-256 `ef23de9fbc7f6af0842d534e750eb8570a5d13d0ff5d34c9da463b422df8f6fe`.
- Both backups existed, were non-empty and were completed before deploy or UAT writes.

## Boolean-only readiness matrix

`T` means present/available and `F` means absent/unavailable. No value, token, address or secret is included.

| Provider | Credential | Host | Sender/business ID | Template/message key | Internal recipient | Broad live default off | Guard | Suppression table | Audit table | Copy version | Eligibility | One-send limit | Rollback | Safe internal transport | Classification/result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Transactional email | T | T | T | T | T | T | T | T | T | T | T | T | T | T | Ready; one attempt failed at provider delivery |
| WhatsApp | F | T | F | F | F | T | T | T | T | F | T | T | T | F | `blocked_transport_not_implemented`; credentials/template/recipient also missing |
| SMS | T | T | T | F | F | T | T | T | T | F | T | T | T | F | `blocked_missing_internal_recipient`; guarded internal transport/message key also missing |
| Meta CAPI | F | T | F | T | F | T | T | T | T | F | T | T | T | readiness only | `dry_run_only` |
| TikTok Events | F | T | F | T | F | T | T | T | T | F | T | T | T | readiness only | `dry_run_only` |
| Google Ads | F | T | F | T | F | T | T | T | T | F | T | T | T | readiness only | `dry_run_only` |
| LinkedIn | F | F | F | F | F | T | T | T | T | F | T | T | T | readiness only | `dry_run_only` |
| X | F | F | F | F | F | T | T | T | T | F | T | T | T | readiness only | `dry_run_only` |
| Pinterest | F | F | F | F | F | T | T | T | T | F | T | T | T | readiness only | `dry_run_only` |
| Snapchat | F | F | F | F | F | T | T | T | T | F | T | T | T | readiness only | `dry_run_only` |
| PostHog | F | F | T | T | F | T | T | T | T | F | T | T | T | readiness only | `dry_run_only` |

The email provider host returned a response to a non-delivery connectivity check. The single delivery attempt still failed and was not retried. Dry-run success is not recorded as live-send success.

## Guard readiness

The new guard is internal-only and has no route. It issues an unforgeable, one-shot, recipient-bound authorization only after audit, eligibility, suppression, withdrawal, policy, copy, credential, allowlist and correlation checks. It rejects campaign/newsletter identifiers, bulk recipients, customers, prospects, order/checkout/support/legacy contacts, unknown recipients and any use of the broad live-send flag. The email transport accepts only this authorization and a process-only canary gate; production API gates remain unchanged.
