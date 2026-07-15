# Slice 9-Z APEX internal consent UAT

## Scope

The UAT used only synthetic identity `uat_synthetic_slice_09_z_20260715081756` and an opaque SHA-256 endpoint reference. No customer, prospect, order, checkout, support or legacy contact was read or used. Public Preference Centre saves and production API persistence commands remained disabled; a non-network-exposed one-off process received a local gate map for this synthetic flow only.

## Lifecycle result

Correlation ID: `slice-09-z-uat-20260715081756`.

| Step | Result |
|---|---|
| Record versioned fixed internal copy reference | passed |
| Request preference change | persisted |
| Verify preference change | persisted; no implicit grant |
| Record explicit synthetic grant | persisted |
| Replay same grant idempotency key | returned existing receipt |
| Eligibility before canary | eligible for internal email only |
| Suppression gate simulation | ineligible |
| Policy-block gate simulation | ineligible |
| Record withdrawal | persisted |
| Eligibility after withdrawal | ineligible: `withdrawal_active`, `consent_state_withdrawn` |
| Final projection | `withdrawn` |

## Immutable audit evidence

Six consent events exist, each with an integrity hash:

1. `preference_change_requested`
2. `preference_change_verified`
3. `consent_grant_recorded`
4. `internal_provider_canary_attempted`
5. `internal_provider_canary_result_recorded`
6. `consent_withdrawal_recorded`

The two canary events use correlation ID `slice-09-z-email-canary-20260715081756`; the lifecycle events use the UAT correlation ID above. Database verification found one attempt event, one result event, six total events and final state `withdrawn`. Provider unsubscribe and channel suppression tables remained unchanged at zero rows.

No provider call occurred before eligibility and immutable attempt audit. No customer communication was created by the consent lifecycle itself.
