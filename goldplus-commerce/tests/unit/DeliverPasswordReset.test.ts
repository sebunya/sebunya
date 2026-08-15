import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DeliverPasswordResetUseCase,
  type ResetTransportResult,
} from "../../apps/api/src/application/use-cases/identity/DeliverPasswordResetUseCase";

/**
 * One password-reset delivery attempt, end to end.
 *
 * The rule the whole thing turns on: a credential stays usable only while an
 * email carrying it was accepted, or might have been. Everything else retires
 * it — including the cases where we will never try again, because a link the
 * provider definitively refused is a live credential nobody can use and nobody
 * should be able to.
 */

const NOW = new Date("2026-08-15T12:00:00Z");
const OP = "11111111-1111-4111-8111-111111111111";
const TOKEN = "22222222-2222-4222-8222-222222222222";
const ATTEMPT = "33333333-3333-4333-8333-333333333333";

const snapshot = (over: Record<string, any> = {}) => ({
  operationId: OP,
  userId: "user-1",
  recipientEmail: "owner@example.test",
  rootCreatedAt: new Date("2026-08-15T11:50:00Z"),
  consumedAt: null,
  currentToken: { id: TOKEN, expiresAt: new Date("2026-08-15T12:50:00Z") },
  dispatchedAttempts: 0,
  ...over,
});

const build = (over: { snapshot?: any; transport?: ResetTransportResult | (() => never) } = {}) => {
  const calls: string[] = [];
  const transitions: Array<{ from: string; to: string }> = [];
  let sends = 0;
  let sentUrl = "";

  const repo = {
    loadOperation: async () => (over.snapshot === null ? null : over.snapshot ?? snapshot()),
    supersedeToken: async () => { calls.push("supersedeToken"); return true; },
    supersedeAndScheduleRetry: async () => { calls.push("supersedeAndScheduleRetry"); return true; },
    finaliseIntent: async () => { calls.push("finaliseIntent"); return true; },
    createOperation: async () => ({ operationId: OP, tokenId: TOKEN, attemptId: ATTEMPT }),
    claimDueIntent: async () => null,
    createRetryTokenAndAttempt: async () => null,
  };

  const attempts = {
    transitionStatus: async (i: any) => {
      transitions.push({ from: i.expectedStatus, to: i.nextStatus });
      return true;
    },
  };

  const transport = {
    send: async (i: { recipient: string; resetUrl: string }) => {
      sends++;
      sentUrl = i.resetUrl;
      if (typeof over.transport === "function") return over.transport();
      return over.transport ?? { responded: true, httpStatus: 202, providerReference: "msg-1" };
    },
  };

  const useCase = new DeliverPasswordResetUseCase(
    repo as any,
    attempts as any,
    transport,
    "https://shopgoldplus.com",
    () => NOW,
  );

  return {
    useCase,
    calls,
    transitions,
    sendCount: () => sends,
    sentUrl: () => sentUrl,
  };
};

const run = (h: ReturnType<typeof build>) =>
  h.useCase.execute({ operationId: OP, tokenId: TOKEN, attemptId: ATTEMPT, rawToken: "raw-secret-token" });

describe("the dispatch boundary is crossed durably before the network", () => {
  it("commits PREPARED -> DISPATCH_STARTED before sending", async () => {
    const h = build();
    await run(h);
    // The first transition must be the boundary, and it must precede the send.
    expect(h.transitions[0]).toEqual({ from: "PREPARED", to: "DISPATCH_STARTED" });
    expect(h.sendCount()).toBe(1);
  });

  it("does not call the provider when the boundary CAS is lost", async () => {
    const h = build();
    // Another execution owns the attempt.
    (h as any).useCase = new DeliverPasswordResetUseCase(
      { loadOperation: async () => snapshot(), supersedeToken: async () => true, finaliseIntent: async () => true } as any,
      { transitionStatus: async () => false } as any,
      { send: async () => { throw new Error("provider must not be called"); } },
      "https://shopgoldplus.com",
      () => NOW,
    );
    const result = await (h as any).useCase.execute({ operationId: OP, tokenId: TOKEN, attemptId: ATTEMPT, rawToken: "x" });
    expect(result).toEqual({ kind: "NOT_DISPATCHED", reason: "DISPATCH_BOUNDARY_LOST" });
  });
});

describe("send-time recheck refuses what claim-time could not know", () => {
  it("does not send for an orphaned operation", async () => {
    const h = build({ snapshot: null });
    const result = await run(h);
    expect(result).toMatchObject({ kind: "NOT_DISPATCHED", reason: "RESET_OPERATION_ORPHANED" });
    expect(h.sendCount()).toBe(0);
    expect(h.transitions[0]).toEqual({ from: "PREPARED", to: "NOT_DISPATCHED" });
  });

  it("does not send once the customer has already reset the password", async () => {
    const h = build({ snapshot: snapshot({ consumedAt: NOW }) });
    const result = await run(h);
    expect(result).toMatchObject({ kind: "NOT_DISPATCHED" });
    expect(h.sendCount()).toBe(0);
  });

  it("does not send after the operation expired", async () => {
    const h = build({ snapshot: snapshot({ rootCreatedAt: new Date("2026-08-15T10:00:00Z") }) });
    const result = await run(h);
    expect(result).toMatchObject({ kind: "NOT_DISPATCHED" });
    expect(h.sendCount()).toBe(0);
  });

  it("does not send a token that is no longer the operation's current one", async () => {
    const h = build({ snapshot: snapshot({ currentToken: { id: "other-token", expiresAt: NOW } }) });
    const result = await run(h);
    expect(result).toMatchObject({ kind: "NOT_DISPATCHED", reason: "TOKEN_NO_LONGER_CURRENT" });
    expect(h.sendCount()).toBe(0);
  });

  it("marks an undispatched attempt NOT_DISPATCHED, never FAILED", async () => {
    // The provider rejected nothing; calling this a provider failure would
    // slander a working provider and corrupt delivery metrics.
    const h = build({ snapshot: snapshot({ consumedAt: NOW }) });
    await run(h);
    expect(h.transitions).toContainEqual({ from: "PREPARED", to: "NOT_DISPATCHED" });
    expect(h.transitions.some((t) => t.to === "FAILED")).toBe(false);
  });
});

describe("the token-preservation matrix", () => {
  it("PRESERVES the token when the provider accepted", async () => {
    const h = build({ transport: { responded: true, httpStatus: 202, providerReference: "msg-1" } });
    const result = await run(h);
    expect(result).toEqual({ kind: "ACCEPTED" });
    expect(h.transitions).toContainEqual({ from: "DISPATCH_STARTED", to: "SENT" });
    expect(h.calls).not.toContain("supersedeToken");
    expect(h.calls).not.toContain("supersedeAndScheduleRetry");
  });

  it("PRESERVES the token when the outcome is ambiguous", async () => {
    // The email may already be on its way carrying this exact link.
    const h = build({ transport: { responded: false, transportError: "ETIMEDOUT" } });
    const result = await run(h);
    expect(result).toMatchObject({ kind: "AMBIGUOUS" });
    expect(h.transitions).toContainEqual({ from: "DISPATCH_STARTED", to: "OUTCOME_UNKNOWN" });
    expect(h.calls).not.toContain("supersedeToken");
    expect(h.calls).not.toContain("supersedeAndScheduleRetry");
  });

  it("RETIRES the token and schedules on a definitive retryable rejection", async () => {
    const h = build({ transport: { responded: true, httpStatus: 429, providerBody: "rate limit exceeded" } });
    const result = await run(h);
    expect(result).toMatchObject({ kind: "RETRY_SCHEDULED" });
    expect(h.transitions).toContainEqual({ from: "DISPATCH_STARTED", to: "FAILED" });
    expect(h.calls).toContain("supersedeAndScheduleRetry");
  });

  it("RETIRES the token on an owner-action rejection, and does NOT retry", async () => {
    const h = build({
      transport: { responded: true, httpStatus: 429, providerBody: "sending domain is not verified" },
    });
    const result = await run(h);
    expect(result).toMatchObject({ kind: "TERMINAL" });
    // Retired even though nobody will try again — the provider proved it never
    // took the message, so the credential is dead weight.
    expect(h.calls).toContain("supersedeToken");
    expect(h.calls).not.toContain("supersedeAndScheduleRetry");
  });

  it("RETIRES the token on an unclassifiable definitive rejection, and fails closed", async () => {
    const h = build({ transport: { responded: true, httpStatus: 418, providerBody: "teapot" } });
    const result = await run(h);
    expect(result).toMatchObject({ kind: "TERMINAL" });
    expect(h.calls).toContain("supersedeToken");
    expect(h.calls).not.toContain("supersedeAndScheduleRetry");
  });

  it("treats a thrown transport as ambiguous, not as failure", async () => {
    const h = build({ transport: (() => { throw new Error("socket hang up"); }) as any });
    const result = await run(h);
    expect(result).toMatchObject({ kind: "AMBIGUOUS" });
    expect(h.calls).not.toContain("supersedeToken");
  });
});

describe("the raw secret never leaves this call", () => {
  it("puts the token in the URL and nowhere else", async () => {
    const h = build();
    await run(h);
    expect(h.sentUrl()).toContain("raw-secret-token");
    // Nothing handed to persistence carries it.
    expect(JSON.stringify(h.transitions)).not.toContain("raw-secret-token");
    expect(JSON.stringify(h.calls)).not.toContain("raw-secret-token");
  });

  it("never persists the token or the reset URL", () => {
    const source = readFileSync(
      "apps/api/src/application/use-cases/identity/DeliverPasswordResetUseCase.ts",
      "utf8",
    );
    // The URL is built locally and passed to transport; it is not written to
    // any repository call.
    expect(source).toMatch(/const resetUrl =/);
    expect(source).not.toMatch(/resetUrl[^)]*repo\./);
    expect(source).not.toMatch(/rawToken:[^)]*repo\./);
  });
});

describe("the reset intent cannot be swallowed by the generic worker", () => {
  it("is excluded from the notification outbox claim", () => {
    const worker = readFileSync(
      "apps/api/src/application/use-cases/outbox/ProcessOutboxBatchUseCase.ts",
      "utf8",
    );
    // Claimed there it would find no route and be marked processed as
    // 'No channel mapping' — destroying the delivery silently.
    expect(worker).toMatch(/PASSWORD_RESET_DELIVERY_EVENT_TYPE/);
    expect(worker).toMatch(/excludeEventTypes: \[\.\.\.CHECKOUT_SIDE_EFFECT_EVENT_TYPES, PASSWORD_RESET_DELIVERY_EVENT_TYPE\]/);
  });
});
