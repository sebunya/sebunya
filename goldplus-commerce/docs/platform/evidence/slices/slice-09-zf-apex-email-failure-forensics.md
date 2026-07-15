# Slice 9-ZF APEX email failure forensics

## Baseline and scope

- Local and remote starting commit: `b63a0eecfcc9302eadcb1efb286bdbdd14a179b0`.
- Branch: `phase-2-measurement-control-tower-completion`.
- Provider: transactional email only.
- Previous correlation ID: `slice-09-z-email-canary-20260715081756`.
- Previous attempt: 15 July 2026, 08:17:56 UTC; one masked Robert-owned internal allowlisted recipient (`ro***@gm***.com`).
- Production source backup: not required because no production overlay or gate change was performed.
- Database backup: not required because this slice performed no production write.

## Retained evidence

The immutable timeline contains exactly one `internal_provider_canary_attempted` event and one `internal_provider_canary_result_recorded` event. Both have integrity hashes. The result reason retains only `failed`; no HTTP status, provider code or provider response category was persisted. The attempt and result are approximately 769 ms apart, which does not prove a timeout. No later event or provider reference exists.

Boolean configuration evidence remains: credential present, host present, sender present, fixed copy present and internal recipient present. No value was printed. The request used the ZeptoMail single-email endpoint and its structural fields match the provider's documented single-email contract: from, one recipient, subject, body, tracking controls and client reference.

## Classification

| Field | Result |
|---|---|
| Root-cause classification | `unknown` |
| Provider status/category | unavailable |
| Provider code/category | unavailable |
| Retryable | unknown |
| Safe historical root-cause fix identified | no |
| Provider-console action proven necessary | no; cannot be excluded |
| Credential replacement proven necessary | no; cannot be excluded |
| Recipient allowlist change required | no |
| Diagnostic defect | `transport_adapter_bug`: failed responses discarded bounded status/error categories |

`transport_adapter_bug` describes the loss of diagnostics, not the unproven provider delivery root cause. Treating it as the delivery cause would fabricate certainty.

## Safe local fix

A pure failure classifier now maps only bounded status/code categories to the allowed taxonomy and never returns raw provider strings. The internal transport now retains that redacted classification for future attempts, including configuration, HTTP 4xx/5xx, rate-limit and timeout categories. The change is local and dormant; it was not deployed because the historical failure remains unresolved and no rerun was authorized.

Decision: `SLICE_9_ZF_APEX_EMAIL_FAILURE_DIAGNOSED_RERUN_BLOCKED`.
