import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { classifyTemplate } from "../../apps/api/src/infrastructure/notifications/messageClassification";
import { OutboundGovernanceService } from "../../apps/api/src/infrastructure/notifications/OutboundGovernanceService";
import {
  OTP_MAX_PER_HOUR,
  OTP_RESEND_COOLDOWN_MS,
  RequestPhoneVerificationUseCase,
} from "../../apps/api/src/application/use-cases/loyalty/LoyaltyIdentityUseCases";

/**
 * Purpose is the authorization boundary.
 *
 * Found in production on 2026-08-14: phone-verification OTPs had never been
 * delivered. `OutboxOtpSender` enqueued them as LOYALTY_EXPIRY_WARNING —
 * "routed identically: SMS-first customer message" — and routing IS identical,
 * but the event type is also what governance classifies from. A security
 * challenge inherited a loyalty event's identity, fell through to MARKETING,
 * and was refused NO_CONSENT_FOR_MARKETING on a fully configured SMS provider.
 *
 * PASSWORD_RESET had the same defect before it, which is what makes this a
 * class of error rather than a typo. The repair is to give the OTP its correct
 * identity — never to teach marketing events to bypass consent.
 *
 * So these tests are deliberately TWO-WAY. A one-way test ("OTP is allowed")
 * passes just as happily if consent were removed for everyone.
 */

const ROUTER = "apps/api/src/infrastructure/notifications/NotificationRouter.ts";
const OTP_SENDER = "apps/api/src/infrastructure/loyalty/LoyaltyIdentityInfrastructure.ts";

/** Templates carrying a security/authentication purpose. */
const SECURITY_TEMPLATES = ["PHONE_VERIFICATION", "PASSWORD_RESET", "PASSWORD_RESET_CODE"];

/** Templates that are genuinely marketing and must stay consent-gated. */
const MARKETING_TEMPLATES = [
  "LOYALTY_EXPIRY_WARNING",
  "LOYALTY_POINTS_EARNED",
  "LOYALTY_REDEMPTION_CONFIRMED",
  "LOYALTY_TIER_CHANGED",
];

describe("security traffic is never governed as marketing", () => {
  it("classifies every security template as transactional", () => {
    for (const template of SECURITY_TEMPLATES) {
      expect(classifyTemplate(template), template).toBe("TRANSACTIONAL");
    }
  });

  it("classifies it whatever case the producer wrote it in", () => {
    // The password-reset producer enqueues 'password_reset' in lower case.
    expect(classifyTemplate("password_reset")).toBe("TRANSACTIONAL");
    expect(classifyTemplate("phone_verification")).toBe("TRANSACTIONAL");
  });

  it("SECURITY_EVENTS_USING_MARKETING_POLICY = 0", () => {
    const offenders = SECURITY_TEMPLATES.filter((t) => classifyTemplate(t) === "MARKETING");
    expect(offenders).toEqual([]);
  });
});

describe("marketing cannot escape consent by claiming to be transactional", () => {
  it("keeps every genuine marketing template classified as marketing", () => {
    for (const template of MARKETING_TEMPLATES) {
      expect(classifyTemplate(template), template).toBe("MARKETING");
    }
  });

  it("MARKETING_EVENTS_USING_SECURITY_POLICY = 0", () => {
    const offenders = MARKETING_TEMPLATES.filter((t) => classifyTemplate(t) !== "MARKETING");
    expect(offenders).toEqual([]);
  });

  it("still fails closed for a template nobody classified", () => {
    // A new template must not reach a customer by default.
    expect(classifyTemplate("SOME_NEW_CAMPAIGN_BLAST")).toBe("MARKETING");
    expect(classifyTemplate("")).toBe("MARKETING");
  });
});

describe("the OTP no longer wears a loyalty event's identity", () => {
  const sender = readFileSync(OTP_SENDER, "utf8");
  const senderBlock = sender.slice(
    sender.indexOf("export class OutboxOtpSender"),
    sender.indexOf("export const otpHash"),
  );

  it("enqueues a distinct security event type", () => {
    expect(senderBlock).toMatch(/eventType: PHONE_VERIFICATION_EVENT_TYPE/);
    expect(sender).toMatch(/PHONE_VERIFICATION_EVENT_TYPE = 'PHONE_VERIFICATION_REQUESTED'/);
  });

  it("no longer enqueues OTPs as a loyalty event", () => {
    expect(senderBlock).not.toMatch(/LOYALTY_EXPIRY_WARNING/);
  });

  it("routes the security event on its own template, not the event name", () => {
    const router = readFileSync(ROUTER, "utf8");
    const otpCase = router.slice(
      router.indexOf("case 'PHONE_VERIFICATION_REQUESTED'"),
      router.indexOf("case 'LOYALTY_EXPIRY_WARNING'"),
    );
    expect(otpCase).toMatch(/template: 'PHONE_VERIFICATION'/);
    // Sharing the loyalty case would mean sharing `template: eventType`, which
    // is exactly how the OTP became marketing.
    expect(otpCase).not.toMatch(/template: eventType/);
  });

  it("does not deliver a phone challenge to an email address", () => {
    const router = readFileSync(ROUTER, "utf8");
    const otpCase = router.slice(
      router.indexOf("case 'PHONE_VERIFICATION_REQUESTED'"),
      router.indexOf("case 'LOYALTY_EXPIRY_WARNING'"),
    );
    expect(otpCase).not.toMatch(/emailProvider|customerEmail/);
  });

  it("leaves the loyalty routing untouched", () => {
    const router = readFileSync(ROUTER, "utf8");
    const loyaltyCase = router.slice(
      router.indexOf("case 'LOYALTY_EXPIRY_WARNING'"),
      router.indexOf("case 'FAKE_PRODUCT_REPORTED'"),
    );
    expect(loyaltyCase).toMatch(/template: eventType/);
  });
});

describe("governance outcome, both directions", () => {
  const service = new OutboundGovernanceService();

  /** Everything open, so the ONLY variable under test is consent by class. */
  const env = {
    PROVIDER_DELIVERY_ENABLED: "true",
    CUSTOMER_COMMUNICATIONS_ENABLED: "true",
    NOTIFICATION_DELIVERY_ENABLED: "true",
    NOTIFICATIONS_LIVE_SEND_ENABLED: "true",
    NOTIFICATIONS_OPERATOR_APPROVED: "true",
    NOTIFICATIONS_SMS_ENABLED: "true",
    NOTIFICATIONS_DRY_RUN: "false",
  } as NodeJS.ProcessEnv;

  const decide = (template: string, over: Record<string, unknown> = {}) =>
    service.decide(
      {
        channel: "SMS",
        messageClass: classifyTemplate(template),
        recipientClass: "CUSTOMER",
        providerConfigured: true,
        allowlistActive: false,
        recipientAllowlisted: false,
        ...over,
      } as any,
      env,
    );

  it("lets a verification code through to a customer with no marketing consent", () => {
    const decision = decide("PHONE_VERIFICATION");
    expect(decision.kind).toBe("ALLOW_LIVE");
    expect(decision.guard).not.toMatch(/CONSENT/);
  });

  it("still blocks genuine marketing to that same customer", () => {
    const decision = decide("LOYALTY_EXPIRY_WARNING");
    expect(decision.kind).toBe("BLOCK_CONSENT");
    expect(decision.guard).toBe("NO_CONSENT_FOR_MARKETING");
  });

  it("still blocks marketing when the customer HAS refused explicitly", () => {
    expect(decide("LOYALTY_EXPIRY_WARNING", { consentGranted: false }).kind).toBe("BLOCK_CONSENT");
  });

  it("does not make the OTP a general bypass of the other controls", () => {
    // Only the marketing-purpose dependency was removed. Every other guard
    // must still be able to stop this message.
    expect(decide("PHONE_VERIFICATION", { suppressed: true }).kind).toBe("BLOCK_SUPPRESSION");
    expect(decide("PHONE_VERIFICATION", { providerConfigured: false }).kind).toBe(
      "BLOCK_PROVIDER_NOT_CONFIGURED",
    );
    expect(decide("PHONE_VERIFICATION", { serviceHealthy: false }).kind).toBe(
      "BLOCK_SERVICE_UNHEALTHY",
    );
    expect(
      decide("PHONE_VERIFICATION", { allowlistActive: true, recipientAllowlisted: false }).kind,
    ).toBe("BLOCK_RECIPIENT_NOT_ALLOWLISTED");
    expect(decide("PHONE_VERIFICATION", { frequencyCapReached: true }).kind).toBe(
      "BLOCK_FREQUENCY_CAP",
    );
  });

  it("respects the global switches for a security message too", () => {
    const off = { ...env, PROVIDER_DELIVERY_ENABLED: "false", CUSTOMER_COMMUNICATIONS_ENABLED: "false" };
    const decision = service.decide(
      {
        channel: "SMS",
        messageClass: classifyTemplate("PHONE_VERIFICATION"),
        recipientClass: "CUSTOMER",
        providerConfigured: true,
        allowlistActive: false,
        recipientAllowlisted: false,
      } as any,
      off,
    );
    expect(decision.kind).toBe("BLOCK_GLOBAL_DISABLED");
  });
});

describe("requesting a code is bounded", () => {
  const build = (over: Partial<Record<string, any>> = {}) => {
    const sent: Array<{ phone: string; code: string }> = [];
    const identity = {
      lastOtpIssuedAt: async () => null,
      otpCountSince: async () => 0,
      createOtp: async () => undefined,
      ...over,
    };
    const useCase = new RequestPhoneVerificationUseCase(
      identity as any,
      { send: async (phone: string, code: string) => { sent.push({ phone, code }); return "sent" as const; } },
      (v: string) => `hash:${v}`,
      () => "123456",
      () => new Date("2026-08-15T12:00:00Z"),
    );
    return { useCase, sent, identity };
  };

  it("issues a code on a first request", async () => {
    const { useCase, sent } = build();
    const result = await useCase.execute({ userId: "u1", phone: "0700000000" });
    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("refuses a resend inside the cooldown, and sends nothing", async () => {
    const { useCase, sent } = build({
      lastOtpIssuedAt: async () => new Date("2026-08-15T11:59:30Z"), // 30s ago
    });
    const result = await useCase.execute({ userId: "u1", phone: "0700000000" }) as any;
    expect(result.ok).toBe(false);
    expect(result.code).toBe("RESEND_TOO_SOON");
    expect(sent).toEqual([]);
  });

  it("allows a resend once the cooldown has passed", async () => {
    const { useCase, sent } = build({
      lastOtpIssuedAt: async () => new Date(Date.parse("2026-08-15T12:00:00Z") - OTP_RESEND_COOLDOWN_MS - 1),
    });
    expect((await useCase.execute({ userId: "u1", phone: "0700000000" })).ok).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("caps the number of codes per hour", async () => {
    const { useCase, sent } = build({ otpCountSince: async () => OTP_MAX_PER_HOUR });
    const result = await useCase.execute({ userId: "u1", phone: "0700000000" }) as any;
    expect(result.ok).toBe(false);
    expect(result.code).toBe("TOO_MANY_CODES");
    expect(sent).toEqual([]);
  });

  it("refuses BEFORE creating a challenge, so a blocked resend cannot void the live code", async () => {
    let created = 0;
    const { useCase } = build({
      lastOtpIssuedAt: async () => new Date("2026-08-15T11:59:59Z"),
      createOtp: async () => { created++; },
    });
    await useCase.execute({ userId: "u1", phone: "0700000000" });
    expect(created).toBe(0);
  });

  it("rejects an invalid phone before anything else happens", async () => {
    const { useCase, sent } = build();
    const result = await useCase.execute({ userId: "u1", phone: "not-a-phone" }) as any;
    expect(result.code).toBe("INVALID_PHONE");
    expect(sent).toEqual([]);
  });

  it("UNBOUNDED_OTP_RESEND_PATHS = 0", () => {
    const source = readFileSync(
      "apps/api/src/application/use-cases/loyalty/LoyaltyIdentityUseCases.ts",
      "utf8",
    );
    const block = source.slice(
      source.indexOf("export class RequestPhoneVerificationUseCase"),
      source.indexOf("export class VerifyPhoneUseCase"),
    );
    expect(block).toMatch(/RESEND_TOO_SOON/);
    expect(block).toMatch(/TOO_MANY_CODES/);
  });
});

describe("sending is not verifying", () => {
  const source = readFileSync(
    "apps/api/src/application/use-cases/loyalty/LoyaltyIdentityUseCases.ts",
    "utf8",
  );
  const requestBlock = source.slice(
    source.indexOf("export class RequestPhoneVerificationUseCase"),
    source.indexOf("export class VerifyPhoneUseCase"),
  );

  it("PROVIDER_SUCCESS_AUTO_VERIFICATION_PATHS = 0", () => {
    // Requesting a code must never mark the phone verified. Only the
    // verification use case may, and only after a correct code.
    expect(requestBlock).not.toMatch(/markPhoneVerified/);
  });

  it("marks the phone verified only after the submitted code matches", () => {
    const verifyBlock = source.slice(source.indexOf("export class VerifyPhoneUseCase"));
    const matchIndex = verifyBlock.indexOf("!== otp.codeHash");
    const verifyIndex = verifyBlock.indexOf("markPhoneVerified");
    expect(matchIndex).toBeGreaterThan(-1);
    expect(verifyIndex).toBeGreaterThan(matchIndex);
  });

  it("keeps expiry, single use and attempt limits on the verify path", () => {
    const verifyBlock = source.slice(source.indexOf("export class VerifyPhoneUseCase"));
    expect(verifyBlock).toMatch(/EXPIRED/);
    expect(verifyBlock).toMatch(/consumeOtp/);
    expect(verifyBlock).toMatch(/TOO_MANY_ATTEMPTS/);
    expect(verifyBlock).toMatch(/otp\.consumedAt/);
  });

  it("never stores or compares the raw code", () => {
    // The stored value is a hash, and comparison hashes the submission.
    expect(source).toMatch(/codeHash: this\.hash\(code\)/);
    expect(source).toMatch(/this\.hash\(input\.code\.trim\(\)\) !== otp\.codeHash/);
  });
});

describe("the code itself never leaks", () => {
  it("is not logged by the producer", () => {
    const sender = readFileSync(OTP_SENDER, "utf8");
    const block = sender.slice(
      sender.indexOf("export class OutboxOtpSender"),
      sender.indexOf("export const otpHash"),
    );
    expect(block).not.toMatch(/logger|console\./);
  });

  it("keeps the code out of the idempotency key in clear", () => {
    const sender = readFileSync(OTP_SENDER, "utf8");
    // The key is derived from a hash of the code, never the code.
    expect(sender).toMatch(/createHash\('sha256'\)\.update\(code\)/);
    expect(sender).not.toMatch(/idempotencyKey: `otp:\$\{phoneE164\}:\$\{code\}/);
  });
});
