import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CHECKOUT_SIDE_EFFECT_EVENT_TYPES,
  CheckoutSideEffectType,
} from "../../apps/api/src/application/ports/ICheckoutSideEffectRecorder";
import {
  ProcessCheckoutSideEffectBatchUseCase,
  TERMINAL_SIDE_EFFECT_POLICY,
} from "../../apps/api/src/application/use-cases/outbox/ProcessCheckoutSideEffectBatchUseCase";
import {
  DEAD_LETTER_STATE,
  DEAD_LETTER_STATES,
  isDeadLettered,
} from "../../apps/api/src/domain/outbox/TerminalState";
import { toRelatedEntityId } from "../../apps/api/src/domain/notifications/RelatedEntityId";

/**
 * The reliability invariants behind four production defects, all found on
 * 2026-08-14 in a queue that reported "degraded" and nothing more:
 *
 *   - ORDER_PAYMENT_VERIFICATION_REQUIRED had no handler and no policy, and its
 *     failure branch skipped the attempt ceiling: 339 attempts over ten days on
 *     a real customer's payment, with no end state possible.
 *   - Three more emittable types had no handler either. They fire on every
 *     confirmed payment and had simply not been reached yet.
 *   - An OTP notification put '' into a uuid column, crashing AFTER the send and
 *     before the record, so each retry re-sent an expired code.
 *   - Two spellings of "dead-lettered" meant five events were uncountable and
 *     unreplayable.
 *
 * These are properties, not incidents. Each test below fails if the property is
 * removed, which is the only reason to keep it.
 */

const REGISTRY = "apps/api/src/infrastructure/Registry.ts";

/**
 * The event types the Registry actually registers a handler for.
 *
 * Read from source rather than from an instance: constructing the Registry
 * opens a database connection, and an invariant that needs a live database to
 * check is one that stops being checked.
 */
const registeredHandlerTypes = (): CheckoutSideEffectType[] => {
  const source = readFileSync(REGISTRY, "utf8");
  const start = source.indexOf("new ProcessCheckoutSideEffectBatchUseCase(");
  expect(start, "handler map not found in Registry").toBeGreaterThan(-1);
  // The handler map is the second constructor argument; the observer object that
  // follows it opens with `onUnhandledType`.
  const end = source.indexOf("onUnhandledType", start);
  expect(end, "observer argument not found").toBeGreaterThan(start);
  const block = source.slice(start, end);
  return [...block.matchAll(/^\s{8}([A-Z][A-Z_]+):\s*\{/gm)].map(
    (m) => m[1] as CheckoutSideEffectType,
  );
};

describe("every emittable checkout side effect is covered", () => {
  it("registers a handler or an explicit policy for every declared type", () => {
    const handled = new Set(registeredHandlerTypes());
    const policied = new Set(Object.keys(TERMINAL_SIDE_EFFECT_POLICY));

    const uncovered = CHECKOUT_SIDE_EFFECT_EVENT_TYPES.filter(
      (type) => !handled.has(type) && !policied.has(type),
    );

    // EMITTABLE ⊆ HANDLED ∪ EXPLICIT_TERMINAL. This assertion, had it existed,
    // would have failed the day ORDER_PAYMENT_VERIFICATION_REQUIRED was written.
    expect(uncovered).toEqual([]);
  });

  it("reads real handler names out of the Registry, so the check is not vacuous", () => {
    const handled = registeredHandlerTypes();
    expect(handled.length).toBeGreaterThan(0);
    expect(handled).toContain("ORDER_FULFILMENT_REQUIRED");
    // The defect this whole change exists for.
    expect(handled).toContain("ORDER_PAYMENT_VERIFICATION_REQUIRED");
  });

  it("never covers a type by both a handler and a policy", () => {
    // Two answers to "what happens to this event" is not coverage, it is a race
    // between whoever reads the map first.
    const handled = new Set(registeredHandlerTypes());
    const both = Object.keys(TERMINAL_SIDE_EFFECT_POLICY).filter((t) => handled.has(t as CheckoutSideEffectType));
    expect(both).toEqual([]);
  });

  it("only ever retires a type whose work is genuinely done elsewhere", () => {
    // A RETIRE policy discards the event. That is only honest when something
    // else performs the work; otherwise it is a queue made clean by deletion.
    for (const [type, policy] of Object.entries(TERMINAL_SIDE_EFFECT_POLICY)) {
      if (policy.disposition === "RETIRE") {
        expect(policy.reason, `${type} must say who does the work`).toMatch(/RECORDED_ONLY/);
        expect(policy.reason).toMatch(/performed by/i);
      }
    }
  });

  it("makes an unexpected event loud rather than silently retiring it", () => {
    expect(TERMINAL_SIDE_EFFECT_POLICY.ORDER_PAYMENT_INITIATION_REQUIRED?.disposition).toBe(
      "DEAD_LETTER",
    );
  });
});

/** A minimal outbox double that records the terminal decision per event. */
const outboxDouble = (events: any[]) => {
  const calls: Array<{ kind: string; id: string; error?: string }> = [];
  return {
    calls,
    repo: {
      claimDueBatch: async () => events,
      markProcessed: async (id: string, opts?: { lastError?: string }) => {
        calls.push({ kind: "processed", id, error: opts?.lastError });
        return true;
      },
      markDeadLettered: async (id: string, error: string) => {
        calls.push({ kind: "dead_letter", id, error });
        return true;
      },
      recordFailure: async (id: string, error: string) => {
        calls.push({ kind: "retry", id, error });
        return true;
      },
    } as any,
  };
};

const event = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "e1",
  eventType: "ORDER_PAYMENT_VERIFICATION_REQUIRED",
  payload: {},
  attemptCount: 0,
  relatedEntityId: "11111111-1111-4111-8111-111111111111",
  ...over,
});

describe("no failure branch can retry forever", () => {
  it("dead-letters an unhandled type once the attempt ceiling is reached", async () => {
    // attemptCount 7 -> the 8th attempt is the last one MAX_ATTEMPTS allows.
    const { calls, repo } = outboxDouble([event({ eventType: "UNKNOWN_TYPE_X", attemptCount: 7 })]);
    const useCase = new ProcessCheckoutSideEffectBatchUseCase(repo, {}, undefined, () => 0.5, {});

    const result = await useCase.execute();

    expect(calls.map((c) => c.kind)).toEqual(["dead_letter"]);
    expect(result.deadLettered).toBe(1);
    // Before the fix this branch called retry() directly and produced a retry
    // here — and at attempt 8, and at 339.
    expect(result.retried).toBe(0);
  });

  it("still retries an unhandled type below the ceiling, so a late handler deploy recovers it", async () => {
    const { calls, repo } = outboxDouble([event({ eventType: "UNKNOWN_TYPE_X", attemptCount: 0 })]);
    const useCase = new ProcessCheckoutSideEffectBatchUseCase(repo, {}, undefined, () => 0.5, {});

    const result = await useCase.execute();

    expect(calls[0].kind).toBe("retry");
    expect(calls[0].error).toBe("NO_HANDLER_FOR_UNKNOWN_TYPE_X");
    expect(result.unhandledType).toBe(1);
  });

  it("bounds a handler that keeps failing", async () => {
    const { calls, repo } = outboxDouble([event({ attemptCount: 7 })]);
    const useCase = new ProcessCheckoutSideEffectBatchUseCase(
      repo,
      { ORDER_PAYMENT_VERIFICATION_REQUIRED: { handle: async () => ({ status: "RETRY", error: "provider down" }) } } as any,
      undefined,
      () => 0.5,
      {},
    );

    await useCase.execute();
    expect(calls[0].kind).toBe("dead_letter");
    expect(calls[0].error).toMatch(/Exhausted after 8 attempts/);
  });

  it("retires a RETIRE-policy event without calling any handler", async () => {
    const { calls, repo } = outboxDouble([
      event({ eventType: "ORDER_LOYALTY_ELIGIBILITY_RECORDED" }),
    ]);
    const useCase = new ProcessCheckoutSideEffectBatchUseCase(repo, {}, undefined, () => 0.5);

    const result = await useCase.execute();

    expect(calls[0].kind).toBe("processed");
    expect(result.terminalByPolicy).toBe(1);
    expect(result.retried).toBe(0);
  });

  it("dead-letters a DEAD_LETTER-policy event instead of retiring it quietly", async () => {
    const { calls, repo } = outboxDouble([
      event({ eventType: "ORDER_PAYMENT_INITIATION_REQUIRED" }),
    ]);
    const useCase = new ProcessCheckoutSideEffectBatchUseCase(repo, {}, undefined, () => 0.5);

    await useCase.execute();
    expect(calls[0].kind).toBe("dead_letter");
    expect(calls[0].error).toMatch(/NOT_IN_SERVICE/);
  });
});

describe("the payment verification handler verifies and never charges", () => {
  /**
   * Just the handler body, with comments stripped, so nothing else in the
   * Registry can satisfy these — and so the comment explaining that the handler
   * never charges does not itself count as a charge.
   */
  const handlerBody = (): string => {
    const source = readFileSync(REGISTRY, "utf8");
    const start = source.indexOf("ORDER_PAYMENT_VERIFICATION_REQUIRED: {");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("onUnhandledType", start);
    return source
      .slice(start, end)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  };

  it("delegates to the canonical settlement path rather than deciding for itself", () => {
    const body = handlerBody();
    // ONE settlement path, shared with the IPN, the callback and the poller.
    expect(body).toMatch(/this\.settlePaymentUseCase\.execute\(/);
  });

  it("has no path that creates a payment or moves money", () => {
    const body = handlerBody();
    for (const forbidden of [
      /createPaymentAttempt/,
      /submitOrderRequest/i,
      /startOrderPayment/i,
      /initiatePayment/i,
      /refund/i,
      /charge/i,
    ]) {
      expect(body, `handler must not reference ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it("never writes a payment status of its own", () => {
    const body = handlerBody();
    // Only the provider's answer may be recorded, and only through settlement.
    expect(body).not.toMatch(/updateOrderPaymentStatusSafely|updatePaymentAttemptStatus/);
    expect(body).not.toMatch(/['"]completed['"]|['"]paid['"]/);
  });

  it("asks only about attempts the provider actually knows", () => {
    const body = handlerBody();
    // No tracking id means SubmitOrderRequest never succeeded: no payment page
    // existed, so no money is possible and there is nothing to ask about.
    expect(body).toMatch(/orderTrackingId/);
    expect(body).toMatch(/NO_PROVIDER_TRANSACTION_TO_VERIFY/);
  });

  it("treats a missing attempt as final rather than retrying forever", () => {
    expect(handlerBody()).toMatch(/status: 'FINAL', error: 'NO_PAYMENT_ATTEMPT_FOR_ORDER'/);
  });
});

describe("an absent relation never reaches a uuid column", () => {
  it("maps every spelling of absence to null, and never to a string", () => {
    for (const absent of [undefined, null, "", "   "]) {
      expect(toRelatedEntityId(absent)).toBeNull();
    }
  });

  it("maps a malformed id to null rather than letting PostgreSQL find it", () => {
    // '' is the exact value that crashed the worker 299 times.
    expect(toRelatedEntityId("")).toBeNull();
    expect(toRelatedEntityId("not-a-uuid")).toBeNull();
    expect(toRelatedEntityId("11111111-1111-4111-8111")).toBeNull();
  });

  it("never invents an id for a notification that has no related row", () => {
    // A generated or zero uuid would attach the attempt to an entity that does
    // not exist, which is worse than recording no link at all.
    const result = toRelatedEntityId(undefined);
    expect(result).toBeNull();
    expect(result).not.toBe("00000000-0000-0000-0000-000000000000");
  });

  it("preserves a real uuid untouched", () => {
    const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(toRelatedEntityId(id)).toBe(id);
    expect(toRelatedEntityId(` ${id} `)).toBe(id);
  });
});

describe("dead-letter monitoring sees both historical spellings", () => {
  it("recognises the value this codebase wrote and the one telemetry wrote", () => {
    expect(isDeadLettered("dead_letter")).toBe(true);
    expect(isDeadLettered("dead_lettered")).toBe(true);
  });

  it("does not treat a live or successful event as dead-lettered", () => {
    for (const state of ["pending", "processing", "processed", "retrying", null, undefined, ""]) {
      expect(isDeadLettered(state as string)).toBe(false);
    }
  });

  it("writes exactly one spelling going forward", () => {
    expect(DEAD_LETTER_STATE).toBe("dead_letter");
    expect(DEAD_LETTER_STATES).toContain(DEAD_LETTER_STATE);
  });

  it("leaves no reader filtering on a single literal", () => {
    // The replay lookup is the one that matters most: a dead letter nobody can
    // replay is an event that was quietly abandoned.
    const repo = readFileSync(
      "apps/api/src/infrastructure/db/repositories/DrizzleOutboxRepository.ts",
      "utf8",
    );
    expect(repo).not.toMatch(/eq\(outboxEvents\.status, 'dead_letter'\)/);
    expect(repo).not.toMatch(/status = 'dead_letter'/);
  });

  it("no longer writes the divergent spelling anywhere", () => {
    const telemetry = readFileSync(
      "apps/api/src/infrastructure/telemetry/TelemetryDispatchService.ts",
      "utf8",
    );
    expect(telemetry).not.toMatch(/status: 'dead_lettered'/);
  });
});
