# Phase 3 Slice 3: Controlled Live Canary Activation

## Overview
This slice implements the first controlled live canary activation capability for the GoldPlus Measurement Control Tower.

## Live Canary Scope
- Enforces strict consent eligibility and destination allowlists.
- Requires operator confirmation text: `START_CONTROLLED_CANARY`.
- Imposes strict canary audience caps.
- Monitored by designated owners; supports pausing and rollback triggers.
- Generates fully-redacted evidence packs.

## Restrictions
- Unrestricted broad live launch is blocked by default.
- Real provider transport returns `NOT_CONFIGURED` or `BLOCKED` if missing safe configuration.
- No GTM publishing or manual purchase conversions permitted in this phase.
