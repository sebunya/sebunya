import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  attemptTransitionGraph,
  isAllowedAttemptTransition,
  isAmbiguousAttemptStatus,
  isInFlightAttemptStatus,
  isLocalPreDispatchTerminalStatus,
  isProviderAcceptedStatus,
  isProviderRejectedStatus,
  isTerminalAttemptStatus,
  type NotificationAttemptStatus,
} from "../../apps/api/src/domain/notifications/AttemptLifecycle";

/**
 * The provider-attempt lifecycle.
 *
 * A provider attempt was previously one row written after the fact with a
 * terminal status — enough when nothing goes wrong, useless when a process dies
 * mid-send. For a password reset that gap decides whether replacing the
 * credential is safe, because the email carries the credential.
 *
 * The lifecycle answers exactly one question after a crash: might the provider
 * already have the message? PREPARED says no. DISPATCH_STARTED says maybe.
 */

const ALL: NotificationAttemptStatus[] = [
  "PENDING",
  "PREPARED",
  "DISPATCH_STARTED",
  "SENT",
  "FAILED",
  "OUTCOME_UNKNOWN",
  "NOT_DISPATCHED",
  "DRY_RUN",
  "NOT_CONFIGURED",
  "DISABLED",
];

describe("terminal and in-flight are exhaustive and disjoint", () => {
  it("classifies every status as exactly one of terminal or in-flight", () => {
    for (const status of ALL) {
      const terminal = isTerminalAttemptStatus(status);
      const inFlight = isInFlightAttemptStatus(status);
      expect(terminal || inFlight, `${status} is neither`).toBe(true);
      expect(terminal && inFlight, `${status} is both`).toBe(false);
    }
  });

  it("treats the three lifecycle phases as non-terminal", () => {
    for (const status of ["PENDING", "PREPARED", "DISPATCH_STARTED"]) {
      expect(isTerminalAttemptStatus(status), status).toBe(false);
    }
  });

  it("treats every ending as terminal, including the one where we never sent", () => {
    for (const status of ["SENT", "FAILED", "OUTCOME_UNKNOWN", "NOT_DISPATCHED", "DRY_RUN", "NOT_CONFIGURED", "DISABLED"]) {
      expect(isTerminalAttemptStatus(status), status).toBe(true);
    }
  });
});

describe("the endings mean different things and must not be confused", () => {
  it("separates provider acceptance from provider rejection", () => {
    expect(isProviderAcceptedStatus("SENT")).toBe(true);
    expect(isProviderRejectedStatus("SENT")).toBe(false);
    expect(isProviderRejectedStatus("FAILED")).toBe(true);
    expect(isProviderAcceptedStatus("FAILED")).toBe(false);
  });

  it("does not call 'we never dispatched' a provider failure", () => {
    // Counting a local crash as a provider rejection slanders a working
    // provider and corrupts every delivery metric built on FAILED.
    expect(isLocalPreDispatchTerminalStatus("NOT_DISPATCHED")).toBe(true);
    expect(isProviderRejectedStatus("NOT_DISPATCHED")).toBe(false);
    expect(isAmbiguousAttemptStatus("NOT_DISPATCHED")).toBe(false);
  });

  it("does not call 'we never dispatched' ambiguous either", () => {
    // There is no uncertainty in NOT_DISPATCHED: we know nothing left.
    expect(isAmbiguousAttemptStatus("OUTCOME_UNKNOWN")).toBe(true);
    expect(isLocalPreDispatchTerminalStatus("OUTCOME_UNKNOWN")).toBe(false);
  });

  it("never reports an in-flight attempt as accepted", () => {
    for (const status of ["PENDING", "PREPARED", "DISPATCH_STARTED"]) {
      expect(isProviderAcceptedStatus(status), status).toBe(false);
      expect(isProviderRejectedStatus(status), status).toBe(false);
    }
  });
});

describe("the transition graph is closed at every terminal state", () => {
  it("gives no terminal status any outgoing edge", () => {
    const terminals = ALL.filter(isTerminalAttemptStatus);
    for (const from of terminals) {
      for (const to of ALL) {
        expect(isAllowedAttemptTransition(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });

  it("allows exactly the intended edges out of the lifecycle phases", () => {
    expect(isAllowedAttemptTransition("PREPARED", "DISPATCH_STARTED")).toBe(true);
    expect(isAllowedAttemptTransition("PREPARED", "NOT_DISPATCHED")).toBe(true);
    expect(isAllowedAttemptTransition("DISPATCH_STARTED", "SENT")).toBe(true);
    expect(isAllowedAttemptTransition("DISPATCH_STARTED", "FAILED")).toBe(true);
    expect(isAllowedAttemptTransition("DISPATCH_STARTED", "OUTCOME_UNKNOWN")).toBe(true);
  });

  it("refuses to skip the dispatch boundary", () => {
    // Going straight to a provider outcome would mean an attempt reached a
    // verdict without any record that we crossed the boundary at all.
    expect(isAllowedAttemptTransition("PREPARED", "SENT")).toBe(false);
    expect(isAllowedAttemptTransition("PREPARED", "FAILED")).toBe(false);
    expect(isAllowedAttemptTransition("PREPARED", "OUTCOME_UNKNOWN")).toBe(false);
  });

  it("refuses to re-open a decided outcome", () => {
    expect(isAllowedAttemptTransition("SENT", "FAILED")).toBe(false);
    expect(isAllowedAttemptTransition("FAILED", "SENT")).toBe(false);
    expect(isAllowedAttemptTransition("FAILED", "DISPATCH_STARTED")).toBe(false);
    expect(isAllowedAttemptTransition("OUTCOME_UNKNOWN", "DISPATCH_STARTED")).toBe(false);
    expect(isAllowedAttemptTransition("NOT_DISPATCHED", "DISPATCH_STARTED")).toBe(false);
  });

  it("does not quietly resolve ambiguity", () => {
    // OUTCOME_UNKNOWN -> SENT would need a provider reconciliation contract.
    // ZeptoMail exposes no such lookup, so the edge does not exist.
    expect(isAllowedAttemptTransition("OUTCOME_UNKNOWN", "SENT")).toBe(false);
  });

  it("exposes a graph that is small and fully enumerated", () => {
    const graph = attemptTransitionGraph();
    expect(graph.length).toBe(7);
    for (const [from, to] of graph) expect(isAllowedAttemptTransition(from, to)).toBe(true);
  });
});

describe("the repository transitions by compare-and-set, never by patch", () => {
  const port = readFileSync(
    "apps/api/src/application/ports/INotificationAttemptRepository.ts",
    "utf8",
  );
  const repo = readFileSync(
    "apps/api/src/infrastructure/db/repositories/DrizzleNotificationAttemptRepository.ts",
    "utf8",
  );

  it("exposes no generic update on the port", () => {
    // A generic patch method lets a stale worker overwrite a decision another
    // worker already made — the exact race the expected-status predicate
    // prevents. Comments are stripped: the doc explaining why it is absent
    // must not itself count as its presence.
    const declarations = port
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(declarations).not.toMatch(/\bupdate\s*\(/);
    expect(declarations).toMatch(/transitionStatus\(/);
    expect(declarations).toMatch(/expectedStatus/);
  });

  it("puts the expected status in the WHERE clause", () => {
    const block = repo.slice(repo.indexOf("async transitionStatus"));
    expect(block).toMatch(/eq\(notificationAttempts\.id, input\.attemptId\)/);
    expect(block).toMatch(/eq\(notificationAttempts\.status, input\.expectedStatus\)/);
  });

  it("reports success only when exactly one row moved", () => {
    const block = repo.slice(repo.indexOf("async transitionStatus"));
    expect(block).toMatch(/\.returning\(/);
    expect(block).toMatch(/updated\.length === 1/);
  });

  it("does not overwrite provider evidence that the caller did not supply", () => {
    // A DISPATCH_STARTED transition carries no provider code yet; blanking the
    // column would erase evidence a later transition needs.
    const block = repo.slice(repo.indexOf("async transitionStatus"));
    expect(block).toMatch(/input\.providerCode !== undefined/);
    expect(block).toMatch(/input\.providerMessage !== undefined/);
  });
});

describe("the widened status union stays honest about the database", () => {
  it("admits PENDING, which the column has always defaulted to", () => {
    const provider = readFileSync(
      "apps/api/src/application/ports/INotificationProvider.ts",
      "utf8",
    );
    expect(provider).toMatch(/'PENDING'/);
    // A type that calls a reachable state impossible is a type that will be wrong.
    expect(isInFlightAttemptStatus("PENDING")).toBe(true);
    expect(isTerminalAttemptStatus("PENDING")).toBe(false);
  });

  it("keeps automation outcomes narrower than the lifecycle", () => {
    const automation = readFileSync(
      "apps/api/src/infrastructure/automation/AutomationOutcomeTrackingProvider.ts",
      "utf8",
    );
    // An automation OUTCOME is finished by definition; the phases have no
    // meaning there and must not silently become one of them.
    expect(automation).toMatch(/AUTOMATION_OUTCOME_STATUSES/);
    expect(automation).not.toMatch(/AutomationOutcomeStatus =[^;]*PREPARED/);
    expect(automation).not.toMatch(/AutomationOutcomeStatus =[^;]*DISPATCH_STARTED/);
  });
});
