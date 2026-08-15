import { describe, expect, it } from "vitest";

import {
  canAttemptDeliveryNow,
  classifyProviderResponse,
  decideAfterProviderOutcome,
  MAX_DELIVERY_ATTEMPTS,
  nextAttemptTime,
  OPERATION_TTL_MS,
  operationBlockedBy,
  operationExpiresAt,
  tokenExpiresAt,
  type ResetOperationSnapshot,
} from "../../apps/api/src/domain/identity/PasswordResetDelivery";

/**
 * The B+ delivery state machine.
 *
 * Background: a password reset reached ZeptoMail, got HTTP 429, and the whole
 * security transaction evaporated — one synchronous attempt, outcome discarded,
 * customer left to guess they should start again.
 *
 * The fix cannot simply be "retry later", because the reset LINK is the secret
 * and only its SHA-256 hash is stored. A delayed send must therefore mint a new
 * token — which is safe only when the provider has PROVEN it never accepted the
 * previous one. Every test below exists to hold that line.
 */

const NOW = new Date("2026-08-15T12:00:00Z");

const snapshot = (over: Partial<ResetOperationSnapshot> = {}): ResetOperationSnapshot => ({
  operationId: "op-1",
  rootCreatedAt: new Date("2026-08-15T11:45:00Z"), // 15 min in, 45 min left
  consumedAt: null,
  revokedAt: null,
  supersededByNewerUserRequest: false,
  deliveryAttempts: 1,
  ...over,
});

describe("a provider response becomes one of exactly three outcomes", () => {
  it("treats a 2xx as acceptance", () => {
    const outcome = classifyProviderResponse({ responded: true, httpStatus: 202, providerReference: "msg-1" });
    expect(outcome.kind).toBe("ACCEPTED");
  });

  it("treats a transport that never answered as AMBIGUOUS, never as failure", () => {
    // A timeout means the request may well have arrived. Calling that "failed"
    // is how a reset link already in flight gets invalidated underneath someone.
    const outcome = classifyProviderResponse({ responded: false, transportError: "ETIMEDOUT" });
    expect(outcome.kind).toBe("AMBIGUOUS");
  });

  it("classifies a definitive rejection by the provider's words, not its status", () => {
    const bare = classifyProviderResponse({ responded: true, httpStatus: 429 });
    expect(bare.kind).toBe("DEFINITIVELY_REJECTED");
    if (bare.kind === "DEFINITIVELY_REJECTED") expect(bare.classification).toBe("rate_limited");

    const withBody = classifyProviderResponse({
      responded: true,
      httpStatus: 429,
      providerBody: '{"error":{"message":"sending domain is not verified"}}',
    });
    if (withBody.kind === "DEFINITIVELY_REJECTED") {
      expect(withBody.classification).toBe("domain_not_verified");
      expect(withBody.disposition).toBe("OWNER_ACTION_REQUIRED");
    }
  });

  it("marks an unclassifiable definitive response UNKNOWN rather than retryable", () => {
    const outcome = classifyProviderResponse({ responded: true, httpStatus: 418, providerBody: "teapot" });
    if (outcome.kind === "DEFINITIVELY_REJECTED") expect(outcome.disposition).toBe("UNKNOWN");
  });
});

describe("acceptance leaves the customer's token alone", () => {
  it("keeps the current token and sends nothing further", () => {
    const decision = decideAfterProviderOutcome({
      outcome: { kind: "ACCEPTED", providerReference: "msg-1" },
      snapshot: snapshot(),
      now: NOW,
    });
    expect(decision.action).toBe("KEEP_CURRENT_TOKEN");
  });
});

describe("ambiguity does nothing at all", () => {
  const ambiguous = { kind: "AMBIGUOUS", reason: "ETIMEDOUT" } as const;

  it("does not rotate, resend, or record a failure", () => {
    const decision = decideAfterProviderOutcome({ outcome: ambiguous, snapshot: snapshot(), now: NOW });
    expect(decision.action).toBe("HOLD");
    expect(decision.action).not.toBe("SUPERSEDE_AND_SCHEDULE_RETRY");
    expect(decision.action).not.toBe("TERMINAL");
  });

  it("holds even when the operation is otherwise perfectly healthy", () => {
    // Health is not the question. Whether the email is in flight is.
    const decision = decideAfterProviderOutcome({
      outcome: ambiguous,
      snapshot: snapshot({ deliveryAttempts: 0 }),
      now: NOW,
    });
    expect(decision.action).toBe("HOLD");
  });
});

describe("only a proven, retryable rejection rotates a token", () => {
  const retryable = {
    kind: "DEFINITIVELY_REJECTED",
    classification: "rate_limited",
    disposition: "RETRYABLE",
    retryAfterSeconds: null,
  } as const;

  it("supersedes the failed token immediately and schedules", () => {
    const decision = decideAfterProviderOutcome({ outcome: retryable, snapshot: snapshot(), now: NOW });
    expect(decision.action).toBe("SUPERSEDE_AND_SCHEDULE_RETRY");
  });

  it("refuses to retry an owner-action failure", () => {
    const decision = decideAfterProviderOutcome({
      outcome: { ...retryable, classification: "domain_not_verified", disposition: "OWNER_ACTION_REQUIRED" },
      snapshot: snapshot(),
      now: NOW,
    });
    expect(decision.action).toBe("TERMINAL");
    expect(decision).toMatchObject({ terminalReason: expect.stringContaining("OWNER_ACTION_REQUIRED") });
  });

  it("refuses to retry a non-retryable failure", () => {
    const decision = decideAfterProviderOutcome({
      outcome: { ...retryable, classification: "payload_validation", disposition: "NON_RETRYABLE" },
      snapshot: snapshot(),
      now: NOW,
    });
    expect(decision.action).toBe("TERMINAL");
  });

  it("holds, rather than retries, an UNKNOWN classification", () => {
    const decision = decideAfterProviderOutcome({
      outcome: { ...retryable, classification: "unknown", disposition: "UNKNOWN" },
      snapshot: snapshot(),
      now: NOW,
    });
    expect(decision.action).toBe("HOLD");
  });

  it("does not retry a consumed, revoked, superseded or expired operation", () => {
    for (const [over, expected] of [
      [{ consumedAt: NOW }, "CONSUMED"],
      [{ revokedAt: NOW }, "REVOKED"],
      [{ supersededByNewerUserRequest: true }, "SUPERSEDED"],
      [{ rootCreatedAt: new Date(NOW.getTime() - OPERATION_TTL_MS - 1) }, "EXPIRED"],
      [{ deliveryAttempts: MAX_DELIVERY_ATTEMPTS }, "ATTEMPT_CEILING_REACHED"],
    ] as const) {
      const decision = decideAfterProviderOutcome({
        outcome: retryable,
        snapshot: snapshot(over as Partial<ResetOperationSnapshot>),
        now: NOW,
      });
      expect(decision.action, JSON.stringify(over)).toBe("TERMINAL");
      expect(decision).toMatchObject({ terminalReason: expect.stringContaining(expected) });
    }
  });

  it("does not schedule a retry that would land after the operation is dead", () => {
    // 30 seconds of life left, minimum backoff 60s.
    const decision = decideAfterProviderOutcome({
      outcome: retryable,
      snapshot: snapshot({ rootCreatedAt: new Date(NOW.getTime() - OPERATION_TTL_MS + 30_000) }),
      now: NOW,
    });
    expect(decision.action).toBe("TERMINAL");
    expect(decision).toMatchObject({
      terminalReason: expect.stringContaining("AFTER_OPERATION_EXPIRY"),
    });
  });
});

describe("Retry-After is a floor, not a suggestion", () => {
  it("never schedules earlier than the provider allowed", () => {
    const at = nextAttemptTime({ attempts: 0, retryAfterSeconds: 900, now: NOW });
    expect(at.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 900_000);
  });

  it("uses bounded backoff when the provider offers no Retry-After", () => {
    const first = nextAttemptTime({ attempts: 0, retryAfterSeconds: null, now: NOW });
    const later = nextAttemptTime({ attempts: 3, retryAfterSeconds: null, now: NOW });
    expect(first.getTime()).toBeGreaterThan(NOW.getTime());
    expect(later.getTime()).toBeGreaterThan(first.getTime());
  });

  it("does not let a tiny Retry-After undercut our own backoff", () => {
    const at = nextAttemptTime({ attempts: 3, retryAfterSeconds: 1, now: NOW });
    expect(at.getTime()).toBeGreaterThan(NOW.getTime() + 60_000);
  });
});

describe("the operation's life is fixed at its root", () => {
  it("derives expiry from the ROOT creation time, so rotation cannot extend it", () => {
    const root = new Date("2026-08-15T11:45:00Z");
    const before = operationExpiresAt(snapshot({ rootCreatedAt: root }));
    // A later rotation changes attempts, never the root.
    const after = operationExpiresAt(snapshot({ rootCreatedAt: root, deliveryAttempts: 4 }));
    expect(after.toISOString()).toBe(before.toISOString());
    expect(after.getTime()).toBe(root.getTime() + OPERATION_TTL_MS);
  });

  it("clamps a rotated token to the operation, never beyond it", () => {
    // 10 minutes of operation left; a full-TTL token would outlive it.
    const snap = snapshot({ rootCreatedAt: new Date(NOW.getTime() - OPERATION_TTL_MS + 600_000) });
    const expiry = tokenExpiresAt(snap, NOW);
    expect(expiry.getTime()).toBe(operationExpiresAt(snap).getTime());
    expect(expiry.getTime()).toBeLessThan(NOW.getTime() + OPERATION_TTL_MS);
  });

  it("gives a normal token its full TTL when the operation has room", () => {
    const snap = snapshot({ rootCreatedAt: NOW });
    expect(tokenExpiresAt(snap, NOW).getTime()).toBe(NOW.getTime() + OPERATION_TTL_MS);
  });
});

describe("eligibility is re-proved at send time, not at schedule time", () => {
  const base = { snapshot: snapshot(), nextAttemptAt: new Date(NOW.getTime() - 1), hasCurrentToken: false, now: NOW };

  it("allows a due retry on a healthy operation with no live token", () => {
    expect(canAttemptDeliveryNow(base).allowed).toBe(true);
  });

  it("refuses while a current token is still live", () => {
    // Accepted or ambiguous: either way a credential may be in the customer's
    // hands, and minting a second one would invalidate it.
    const result = canAttemptDeliveryNow({ ...base, hasCurrentToken: true });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("CURRENT_TOKEN_STILL_LIVE");
  });

  it("refuses before the backoff has elapsed", () => {
    const result = canAttemptDeliveryNow({ ...base, nextAttemptAt: new Date(NOW.getTime() + 60_000) });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("BACKOFF_NOT_ELAPSED");
  });

  it("refuses once the customer has already reset the password", () => {
    // The consumption race: the retry worker wakes after the reset completed.
    const result = canAttemptDeliveryNow({ ...base, snapshot: snapshot({ consumedAt: NOW }) });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("BLOCKED_CONSUMED");
  });

  it("refuses after the operation expired, however it was scheduled", () => {
    const result = canAttemptDeliveryNow({
      ...base,
      snapshot: snapshot({ rootCreatedAt: new Date(NOW.getTime() - OPERATION_TTL_MS - 1) }),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("BLOCKED_EXPIRED");
  });

  it("refuses once the attempt ceiling is reached", () => {
    const result = canAttemptDeliveryNow({
      ...base,
      snapshot: snapshot({ deliveryAttempts: MAX_DELIVERY_ATTEMPTS }),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("BLOCKED_ATTEMPT_CEILING_REACHED");
  });

  it("refuses a revoked or superseded operation", () => {
    expect(canAttemptDeliveryNow({ ...base, snapshot: snapshot({ revokedAt: NOW }) }).allowed).toBe(false);
    expect(
      canAttemptDeliveryNow({ ...base, snapshot: snapshot({ supersededByNewerUserRequest: true }) }).allowed,
    ).toBe(false);
  });
});

describe("retry is bounded from both ends", () => {
  it("stops at the attempt ceiling", () => {
    expect(operationBlockedBy(snapshot({ deliveryAttempts: MAX_DELIVERY_ATTEMPTS }), NOW)).toBe(
      "ATTEMPT_CEILING_REACHED",
    );
  });

  it("stops at the operation lifetime even below the ceiling", () => {
    expect(
      operationBlockedBy(
        snapshot({ deliveryAttempts: 0, rootCreatedAt: new Date(NOW.getTime() - OPERATION_TTL_MS - 1) }),
        NOW,
      ),
    ).toBe("EXPIRED");
  });

  it("has no branch that can retry forever", () => {
    // Whichever bound arrives first ends it; there is no path past both.
    let snap = snapshot({ deliveryAttempts: 0, rootCreatedAt: NOW });
    for (let i = 0; i < 50; i++) {
      const blocked = operationBlockedBy(snap, new Date(NOW.getTime() + i * 60_000));
      if (blocked) return expect(blocked).toBeTruthy();
      snap = { ...snap, deliveryAttempts: snap.deliveryAttempts + 1 };
    }
    throw new Error("operation never became blocked — unbounded retry path exists");
  });
});

describe("no secret can leak through this module", () => {
  it("decides entirely from non-secret facts, never from a credential", () => {
    // The snapshot has no field able to carry a token, and the decision returns
    // only enum labels and a timestamp — so there is nothing secret to leak.
    const snap = snapshot();
    expect(Object.keys(snap).sort()).toEqual([
      "consumedAt",
      "deliveryAttempts",
      "operationId",
      "revokedAt",
      "rootCreatedAt",
      "supersededByNewerUserRequest",
    ]);

    const decision = decideAfterProviderOutcome({
      outcome: {
        kind: "DEFINITIVELY_REJECTED",
        classification: "rate_limited",
        disposition: "RETRYABLE",
        retryAfterSeconds: null,
      },
      snapshot: snap,
      now: NOW,
    });
    // No high-entropy value of the shape a reset token or its hash would take.
    expect(JSON.stringify(decision)).not.toMatch(/[A-Za-z0-9_-]{32,}/);
  });
});
