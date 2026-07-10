# Phase 3 Slice 2: Controlled Activation Dry-Run Orchestrator

## Overview
This phase introduces the dry-run orchestration module for Controlled Activation. It guarantees that any activation request can be fully simulated and reviewed via generated payload previews before it reaches live execution.

## Architecture
- **Use Cases:** `RunControlledActivationDryRunUseCase`, `CreateControlledActivationExecutionPlanUseCase`, `ValidateControlledActivationCanaryPlanUseCase`
- **Interfaces:** `ControlledActivationDryRunRepository`, `ControlledActivationPayloadPreviewer`, etc.
- **Safety:** Redaction layers intercept PII and secrets before they are stored or viewed.

## Restrictions
- No live activation is permitted.
- `publishGtm` and related live dispatch mechanisms are completely isolated and unsupported in this phase.
