# Slice 9-Z APEX controlled canary report

## Canary scope and guard result

- Provider: transactional email.
- Recipient classification: Robert-owned internal allowlisted test address.
- Masked recipient: `ro***@gm***.com`.
- Correlation ID: `slice-09-z-email-canary-20260715081756`.
- Message: fixed internal consent delivery canary; no promotion, discount, product claim, personalisation or action request.
- Recipient count: one.
- Campaign/newsletter/bulk identifiers: none.
- Eligibility before attempt: passed.
- Suppression, withdrawal and policy checks before attempt: passed.
- Immutable attempt audit recorded before transport: yes.
- Broad live-send gate used: no.
- Process-only email canary mode: enabled only for the one-off process and removed on exit.

## Delivery result

| Provider | Attempts | Confirmed sends | Status | Provider reference |
|---|---:|---:|---|---|
| Transactional email | 1 | 0 | failed | none |
| WhatsApp | 0 | 0 | blocked: transport/config/template/recipient missing | none |
| SMS | 0 | 0 | blocked: internal recipient and guarded transport missing | none |

The email host was reachable, but the provider did not return a successful delivery result or message reference. The attempt was not retried because the guard reserves at most one attempt per provider per run. A result audit was appended with status `failed`; no success was fabricated.

## Post-attempt state

The guard locked down, the process-only gate disappeared when the process exited, the broad notification live-send gate remained false, the consent provider live-send gate remained false, and the synthetic consent was withdrawn. No confirmed internal canary delivery completed.
