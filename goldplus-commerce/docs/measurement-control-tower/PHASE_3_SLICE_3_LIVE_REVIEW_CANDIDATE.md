# Phase 3 Slice 3: Controlled Activation Live-Review Candidate

## Overview
This phase introduces the **Live-Review Candidate** layer of the Controlled Activation Governance protocol. It bridges the gap between a successful dry-run and actual live activation. 

**CRITICAL RULE:** This slice does **NOT** activate anything. It builds the governance mechanism required to ensure absolute safety, zero data leakage, and verified stakeholder alignment *before* any future live activation adapter is built.

## Architecture

The live-review candidate sits atop the evidence pack generated in Phase 3 Slice 2. It orchestrates three critical components:

1.  **Readiness Verification (`ControlledActivationLiveReadinessChecker`)**
    *   Verifies the underlying Dry-Run status is strictly `PASSED`.
    *   Validates the activation window has not expired.
    *   Ensures the Canary Scope remains within the strict 5% / 1000 user maximums.
    *   Re-evaluates the consent review summary to guarantee zero PII or override blockers exist.

2.  **Canary Runbook Generation (`ControlledActivationRunbookBuilder`)**
    *   Generates a formal artifact (`CanaryRunbook`) detailing the exact success, failure, pause, and rollback criteria.
    *   Incorpoates the `ControlledActivationIncidentPlan` defining the escalation path and owners.
    *   Establishes the strict cadence for monitoring post-activation.

3.  **Stakeholder & Operator Governance**
    *   **Stakeholder Approval (`ControlledActivationStakeholderLiveApprovalRepository`)**: Mandates explicit, recorded approvals (e.g., from Legal, Privacy, Architecture) before proceeding.
    *   **Operator Checklist (`ControlledActivationOperatorChecklistRepository`)**: Forces the human operator initiating the eventual activation to acknowledge all pre-flight conditions and runbook procedures.

## Core Entities

*   `LiveReviewCandidate`: The root aggregate holding the state (`DRAFT`, `READY_FOR_REVIEW`, `APPROVED_FOR_FUTURE_CONTROLLED_ACTIVATION`, `BLOCKED`, `CANCELLED`).
*   `LiveReadinessCheck`: Individual check results mapping to strict governance gates (e.g., `WINDOW_FRESHNESS`, `CONSENT_SAFETY`).
*   `CanaryRunbook`: The operational guide dictating the boundaries of the activation.
*   `StakeholderLiveApproval`: Cryptographically safe (in theory) or at least immutable records of human authorization.

## Workflow

1.  **Create Candidate**: A candidate is created from a specific Execution Plan and Dry Run Result.
2.  **Run Checks**: The `RunControlledActivationLiveReadinessChecksUseCase` evaluates all safety gates. If any fail, the candidate is marked `BLOCKED`.
3.  **Build Runbook**: If checks pass, a `CanaryRunbook` is generated. State moves to `READY_FOR_REVIEW`.
4.  **Review Phase**:
    *   Operators review and acknowledge checklists.
    *   Stakeholders review the Evidence Pack (from Slice 2) and Runbook, then record their approval or rejection.
5.  **Final State**: If approved, the candidate reaches `APPROVED_FOR_FUTURE_CONTROLLED_ACTIVATION`.

## Safety Invariants

*   **No Live Data**: This slice does not send HTTP requests to Meta, Google, or any external vendor.
*   **No Auto-Activation**: Passing this review does not trigger activation. It simply marks the candidate as approved for a *future* slice to pick up.
*   **Read-Only PII**: PII is rigorously redacted at the Evidence Pack boundary. The Live-Review candidate operates purely on metadata and redacted summaries.

## Next Steps (Phase 3 Slice 4)
Phase 3 Slice 4 will implement the actual outbound adapter that safely consumes an `APPROVED_FOR_FUTURE_CONTROLLED_ACTIVATION` candidate and performs the strict canary delivery according to the generated Runbook.
