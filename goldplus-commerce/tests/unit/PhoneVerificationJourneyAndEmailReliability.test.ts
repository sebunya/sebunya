import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  GetPhoneVerificationStateUseCase,
  maskPhone,
  OTP_RESEND_COOLDOWN_MS,
} from "../../apps/api/src/application/use-cases/loyalty/LoyaltyIdentityUseCases";

/**
 * Two defects the owner hit in production on 2026-08-15, after the OTP
 * transport itself was proven working.
 *
 * PHONE: the code arrived and verified, but leaving the Rewards page lost the
 * thread. The only thing that ever said "a code is on its way" was the POST
 * response, so a customer who glanced at their orders came back to a bare
 * six-digit box with no destination, no expiry and no resend guidance. The
 * challenge was alive in PostgreSQL the whole time; nothing asked it. The code
 * is ephemeral by design — the JOURNEY must not be.
 *
 * EMAIL: the password reset never arrived, inbox or spam. It was not a
 * classification defect: governance permitted it as TRANSACTIONAL and ZeptoMail
 * WAS called. It returned 429 — and the adapter threw the provider's
 * explanation away, reporting only `HTTP error status 429`, which is why nobody
 * could tell a rate limit from a quota from a restricted account.
 */

const REWARDS = "apps/web/src/pages/account/rewards.astro";
const ZEPTOMAIL = "apps/api/src/infrastructure/notifications/zeptomail/ZeptoMailAdapter.ts";
const RESET_USE_CASES = "apps/api/src/application/use-cases/identity/PasswordResetUseCases.ts";

const NOW = new Date("2026-08-15T12:00:00Z");

const identityDouble = (over: Record<string, any> = {}) => ({
  latestOtp: async () => null,
  lastOtpIssuedAt: async () => null,
  ...over,
});

const activeOtp = (over: Record<string, any> = {}) => ({
  id: "c1",
  phoneE164: "+256705123456",
  codeHash: "hash-that-must-never-escape",
  attempts: 0,
  expiresAt: new Date("2026-08-15T12:08:00Z"),
  consumedAt: null,
  ...over,
});

describe("a verification in progress survives leaving the page", () => {
  const state = (over: Record<string, any> = {}) =>
    new GetPhoneVerificationStateUseCase(identityDouble(over) as any, () => NOW).execute({
      userId: "u1",
    });

  it("reports ACTIVE from durable state, with nothing from the original POST", async () => {
    const result = (await state({ latestOtp: async () => activeOtp() })) as any;
    expect(result.status).toBe("ACTIVE");
    expect(result.expiresAt).toBe("2026-08-15T12:08:00.000Z");
  });

  it("reports NONE when no challenge is outstanding", async () => {
    expect((await state()).status).toBe("NONE");
    // A consumed challenge is finished, not outstanding.
    expect(
      (await state({ latestOtp: async () => activeOtp({ consumedAt: new Date() }) })).status,
    ).toBe("NONE");
  });

  it("distinguishes EXPIRED from NONE, because they need different words", async () => {
    const result = (await state({
      latestOtp: async () => activeOtp({ expiresAt: new Date("2026-08-15T11:50:00Z") }),
    })) as any;
    // "That code has expired, ask for another" is actionable. A silently
    // missing form is not.
    expect(result.status).toBe("EXPIRED");
  });

  it("never returns the code or its hash", async () => {
    const result = await state({ latestOtp: async () => activeOtp() });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("hash-that-must-never-escape");
    expect(serialised).not.toMatch(/codeHash|code_hash/);
  });

  it("masks the destination but leaves it recognisable to its owner", async () => {
    const result = (await state({ latestOtp: async () => activeOtp() })) as any;
    expect(result.maskedPhone).toBe("••••••••••456");
    expect(result.maskedPhone).not.toContain("705123");
  });

  it("tells the customer when a resend actually becomes available", async () => {
    const result = (await state({
      latestOtp: async () => activeOtp(),
      lastOtpIssuedAt: async () => new Date(NOW.getTime() - 20_000), // 20s ago
    })) as any;
    const readyAt = new Date(result.resendAvailableAt).getTime();
    expect(readyAt).toBe(NOW.getTime() - 20_000 + OTP_RESEND_COOLDOWN_MS);
  });

  it("reports resend as available once the cooldown has passed", async () => {
    const result = (await state({
      latestOtp: async () => activeOtp(),
      lastOtpIssuedAt: async () => new Date(NOW.getTime() - OTP_RESEND_COOLDOWN_MS - 1),
    })) as any;
    expect(result.resendAvailableAt).toBeNull();
  });

  it("counts down the remaining verify attempts", async () => {
    const result = (await state({ latestOtp: async () => activeOtp({ attempts: 3 }) })) as any;
    expect(result.attemptsRemaining).toBe(2);
  });

  it("masks a short value without leaking it", () => {
    expect(maskPhone("+256705123456")).toMatch(/456$/);
    expect(maskPhone("+256705123456")).not.toContain("+256705123");
  });
});

describe("the rewards page reads the journey from the server", () => {
  const page = readFileSync(REWARDS, "utf8");

  it("asks for the verification state on every load, not only after a POST", () => {
    expect(page).toContain("/account/phone/verification-state");
    // Inside the normal data fetch, so a plain GET after navigating back finds it.
    const fetchBlock = page.slice(
      page.indexOf("await Promise.all(["),
      page.indexOf("The rewards service is unreachable"),
    );
    expect(fetchBlock).toContain("/account/phone/verification-state");
  });

  it("renders the code entry with the masked destination when one is outstanding", () => {
    expect(page).toContain("verificationPending");
    expect(page).toContain("verificationState.maskedPhone");
    expect(page).toContain('name="intent" value="phone-verify"');
  });

  it("keeps the code field accessible and OTP-autofillable", () => {
    expect(page).toContain('autocomplete="one-time-code"');
    expect(page).toContain('inputmode="numeric"');
    expect(page).toMatch(/<label class="sr-only" for="verify-code">/);
  });

  it("puts the customer in the code field after sending, not hunting for it", () => {
    const pending = page.slice(page.indexOf("{verificationPending ? ("), page.indexOf("Send a new code"));
    expect(pending).toContain("autofocus");
  });

  it("does not offer a resend during the cooldown", () => {
    expect(page).toContain("verificationResendAt");
    expect(page).toMatch(/You can ask for another code from/);
  });

  it("says the code expired rather than silently showing the send form again", () => {
    expect(page).toContain("verificationExpired");
    expect(page).toMatch(/That code has expired/);
  });

  it("never renders internal vocabulary to the customer", () => {
    const forbidden = [
      /PHONE_VERIFICATION_REQUESTED/,
      /outbox/i,
      /TRANSACTIONAL/,
      /codeHash/,
      /challenge id/i,
    ];
    // Strip comments: the explanation of the fix may name the internals.
    const prose = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const pattern of forbidden) expect(prose).not.toMatch(pattern);
  });
});

describe("a provider refusal keeps the provider's reason", () => {
  const adapter = readFileSync(ZEPTOMAIL, "utf8");

  it("preserves the response body so a 429 can be classified", () => {
    const block = adapter.slice(adapter.indexOf("if (!response.ok)"), adapter.indexOf("const resJson"));
    expect(block).toContain("response.text()");
    expect(block).toContain("retry-after");
    // The bare version is what made 128 dead letters indistinguishable.
    expect(block).not.toMatch(/providerMessage: `HTTP error status \$\{response\.status\}`,\s*\}/);
  });

  it("bounds the captured detail so it cannot become a log of customer data", () => {
    const block = adapter.slice(adapter.indexOf("if (!response.ok)"), adapter.indexOf("const resJson"));
    expect(block).toMatch(/slice\(0, 300\)/);
  });

  it("still reports the raw status alongside the classification", () => {
    const block = adapter.slice(adapter.indexOf("if (!response.ok)"), adapter.indexOf("const resJson"));
    expect(block).toMatch(/HTTP error status \$\{response\.status\}/);
  });
});

describe("a provider refusal is classified by cause, not by status code", () => {
  const adapter = readFileSync(ZEPTOMAIL, "utf8");

  it("uses the canonical forensics classifier rather than a second taxonomy", () => {
    expect(adapter).toContain("classifyTransactionalEmailFailure");
    const block = adapter.slice(adapter.indexOf("if (!response.ok)"), adapter.indexOf("const resJson"));
    // The provider's own words are what let the classifier distinguish
    // domain_not_verified from a genuine rate limit.
    expect(block).toMatch(/provider_code: detail/);
  });

  it("groups failures by classification, so causes are countable", () => {
    expect(adapter).toContain("PROVIDER_${failure.classification.toUpperCase()}");
  });

  it("carries retryability and whether the owner must act", () => {
    const block = adapter.slice(adapter.indexOf("if (!response.ok)"), adapter.indexOf("const resJson"));
    expect(block).toMatch(/retryable=\$\{failure\.retryable\}/);
    expect(block).toMatch(/requires_provider_action/);
  });

  it("classifies a real ZeptoMail-style body beyond the status fallback", async () => {
    const { classifyTransactionalEmailFailure } = await import(
      "../../apps/api/src/application/services/consent/TransactionalEmailFailureForensics"
    );
    // Status alone can only ever say "rate_limited". The body is what tells an
    // operator whether to wait or to go and verify a domain.
    expect(classifyTransactionalEmailFailure({ response_status: 429 }).classification).toBe(
      "rate_limited",
    );
    expect(
      classifyTransactionalEmailFailure({
        response_status: 429,
        provider_code: '{"error":{"message":"sending domain is not verified"}}',
      }).classification,
    ).toBe("domain_not_verified");
    // And that one is not something waiting will fix.
    expect(
      classifyTransactionalEmailFailure({
        response_status: 429,
        provider_code: "sending domain is not verified",
      }).requires_provider_action,
    ).toBe(true);
  });
});

describe("a failed password reset leaves durable evidence", () => {
  const delivery = readFileSync(
    "apps/api/src/infrastructure/identity/NotificationResetDelivery.ts",
    "utf8",
  );

  it("records the attempt, because this path bypasses the outbox worker", () => {
    // Production had a reset refused with 429 and notification_attempts showed
    // nothing at all — which is why the first diagnosis of it was wrong.
    expect(delivery).toContain("this.recordAttempt");
    expect(delivery).toMatch(/template: 'PASSWORD_RESET'/);
    expect(delivery).toMatch(/channel: 'email'/);
  });

  it("never lets recording break the reset itself", () => {
    expect(delivery).toMatch(/\.catch\(\(\) => undefined\)/);
  });

  it("keeps the token and the reset URL out of the record", () => {
    const record = delivery.slice(delivery.indexOf("this.recordAttempt"), delivery.indexOf("return { status, detail"));
    expect(record).not.toMatch(/rawToken|resetUrl/);
    // The related id is deliberately null rather than the recipient address.
    expect(record).toMatch(/relatedEntityId: null/);
  });
});

describe("a reset token is never created without attempting delivery", () => {
  const source = readFileSync(RESET_USE_CASES, "utf8");

  it("attempts delivery in the same path that issues the token", () => {
    // A token in PostgreSQL is not a password-reset experience. If the token is
    // issued, the send must be attempted — otherwise the customer is told a
    // link is coming and nothing was ever asked of the provider.
    const issueIndex = source.indexOf("rawToken");
    const deliverIndex = source.indexOf("this.delivery.sendPasswordReset");
    expect(issueIndex).toBeGreaterThan(-1);
    expect(deliverIndex).toBeGreaterThan(issueIndex);
  });

  it("passes the provider's own verdict back rather than flattening it", () => {
    expect(source).toMatch(/delivery: sent\.status/);
  });

  it("keeps the account-neutral response regardless of delivery outcome", () => {
    // Delivery failure must never become an account-existence oracle.
    expect(source).toMatch(/generic\(/);
    expect(source).toMatch(/userFound: false/);
  });
});
