import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adminConsentReadinessRows,
  channelPreferences,
  communicationPreferences,
  customerRightsGuidance,
  dataUsePrinciples,
  forbiddenClaims,
  inactiveCapabilities,
  launchReadinessChecklist,
  loyaltyReadinessPreferences,
  memoryLaneReadinessPreferences,
  personalisationReadinessPreferences,
  preferenceCentreSafetySummary,
  preferenceCentreStatus,
  productEducationPreferences,
  riskControls,
  servicePreferences,
  supportActions,
} from "../../apps/web/src/lib/preference-centre";

const root = resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
const page = read("apps/web/src/pages/preferences.astro");
const alias = read("apps/web/src/pages/consent.astro");
const footer = read("apps/web/src/layouts/BaseLayout.astro");
const publicSurface = `${page}\n${alias}`;

const allowedStatuses = [
  "Prepared as future preference",
  "Requires verification",
  "Support-assisted today",
  "Not active yet",
];

describe("Slice 9-B Preference Centre foundation truth", () => {
  it("keeps the Preference Centre inactive", () => expect(preferenceCentreStatus.active).toBe(false));
  it("keeps persistence disabled", () => expect(preferenceCentreStatus.persistenceEnabled).toBe(false));
  it("keeps the preview non-customer-specific", () => expect(preferenceCentreStatus.customerSpecific).toBe(false));
  it("keeps provider sends disabled", () => expect(preferenceCentreStatus.providerSendsEnabled).toBe(false));
  it("uses the required preparation statement", () => expect(preferenceCentreStatus.publicMessage).toBe("GoldPlus is preparing a clearer Preference Centre."));
  it("uses the required no-send statement", () => expect(preferenceCentreStatus.sendMessage).toBe("No marketing messages are sent from this page."));
  it("uses the required verification statement", () => expect(preferenceCentreStatus.verificationMessage).toBe("Some preferences may require account verification before they can be applied."));
  it("uses the required support statement", () => expect(preferenceCentreStatus.supportMessage).toBe("GoldPlus support can help confirm or update your preferences."));
  it("uses the required future-programme statement", () => expect(preferenceCentreStatus.futureProgrammeMessage).toBe("Loyalty, Memory Lane and personalised offers are not active yet."));
  it("has no live customer state or automation", () => expect(preferenceCentreSafetySummary()).toMatchObject({ customerState: false, automation: false }));
  it("has no checkout or payment mutation", () => expect(preferenceCentreSafetySummary()).toMatchObject({ checkoutMutation: false, paymentMutation: false }));
  it("has no active loyalty, Memory Lane, personalisation or utilisation offers", () => expect(preferenceCentreSafetySummary()).toMatchObject({ loyaltyEnrolment: false, memoryLane: false, personalisation: false, utilisationOffers: false }));
});

describe("Slice 9-B communication, service and education categories", () => {
  it.each(communicationPreferences)("keeps communication preference $id conservatively classified", (item) => {
    expect(allowedStatuses).toContain(item.status);
    expect(item.description.length).toBeGreaterThan(30);
    expect(item.activationRequirement.length).toBeGreaterThan(30);
  });

  it.each(servicePreferences)("keeps service preference $id support-first", (item) => {
    expect(item.status).toBe("Support-assisted today");
    expect(item.activationRequirement).toMatch(/request|reference|verification|proof/i);
  });

  it.each(productEducationPreferences)("keeps product education preference $id future-only", (item) => {
    expect(item.status).toBe("Prepared as future preference");
    expect(item.activationRequirement).toMatch(/content|data|consent|channel/i);
  });

  it("separates essential service from optional marketing", () => {
    expect(communicationPreferences.find((item) => item.id === "essential-service")?.status).toBe("Requires verification");
    expect(communicationPreferences.find((item) => item.id === "offers-news")?.status).toBe("Not active yet");
  });
  it("includes order support without a courier promise", () => expect(servicePreferences.map((item) => item.id)).toContain("order-help"));
  it("includes returns and warranty support without a guarantee", () => expect(JSON.stringify(servicePreferences)).not.toMatch(/free returns|replacement guarantee|guaranteed warranty/i));
  it("includes compatibility and safe-charging education", () => expect(productEducationPreferences.map((item) => item.id)).toEqual(expect.arrayContaining(["compatibility-guidance", "safe-charging"])));
  it("uses unique identifiers across public preference categories", () => {
    const ids = [...communicationPreferences, ...servicePreferences, ...productEducationPreferences].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Slice 9-B channel readiness", () => {
  it.each(channelPreferences)("classifies $name without activating it", (channel) => {
    expect(allowedStatuses).toContain(channel.status);
    expect(channel.guidance.length).toBeGreaterThan(40);
  });

  it("includes all required channels", () => expect(channelPreferences.map((channel) => channel.name)).toEqual(["WhatsApp", "Email", "SMS", "Phone call", "In-account notifications", "Support-assisted updates"]));
  it("keeps WhatsApp marketing inactive", () => expect(channelPreferences.find((channel) => channel.name === "WhatsApp")?.status).toBe("Not active yet"));
  it("keeps email and SMS inactive", () => expect(channelPreferences.filter((channel) => ["Email", "SMS"].includes(channel.name)).every((channel) => channel.status === "Not active yet")).toBe(true));
  it("requires verification for phone discussions", () => expect(channelPreferences.find((channel) => channel.name === "Phone call")?.status).toBe("Requires verification"));
  it("keeps only support-assisted updates available today", () => expect(channelPreferences.filter((channel) => channel.status === "Support-assisted today").map((channel) => channel.name)).toEqual(["Support-assisted updates"]));
});

describe("Slice 9-B future-programme consent readiness", () => {
  it.each(loyaltyReadinessPreferences)("keeps $id inactive", (item) => expect(item.status).toBe("Not active yet"));
  it.each(memoryLaneReadinessPreferences)("keeps $id inactive", (item) => expect(item.status).toBe("Not active yet"));
  it.each(personalisationReadinessPreferences)("keeps $id inactive", (item) => expect(item.status).toBe("Not active yet"));

  it("requires a ledger and liability controls before loyalty", () => expect(loyaltyReadinessPreferences[0].activationRequirement).toMatch(/ledger.*liability/i));
  it("requires explicit consent and privacy review before Memory Lane", () => expect(memoryLaneReadinessPreferences[0].activationRequirement).toMatch(/explicit consent.*privacy review/i));
  it("requires explainability and fairness before personalisation", () => expect(personalisationReadinessPreferences.find((item) => item.id === "personalisation")?.activationRequirement).toMatch(/explainability.*fairness/i));
  it("requires margin floors and budget caps before utilisation offers", () => expect(personalisationReadinessPreferences.find((item) => item.id === "utilisation-aware-offers")?.activationRequirement).toMatch(/margin floors.*budget caps/i));
  it("contains no points balance or reward action", () => expect(JSON.stringify([...loyaltyReadinessPreferences, ...memoryLaneReadinessPreferences])).not.toMatch(/points balance|redeem now|claim reward/i));
  it("contains no customer history state", () => expect(JSON.stringify(memoryLaneReadinessPreferences)).not.toMatch(/customerId|order history loaded|annual recap ready/i));
  it("contains no discount issuance", () => expect(JSON.stringify(personalisationReadinessPreferences)).not.toMatch(/discount applied|coupon code|price changed/i));
  it("prepares eight read-only operator readiness rows", () => expect(adminConsentReadinessRows).toHaveLength(8));
  it("keeps every operator readiness row conservative", () => expect(adminConsentReadinessRows.every((row) => allowedStatuses.includes(row.status))).toBe(true));
  it("keeps the operator model free of PII fields", () => expect(JSON.stringify(adminConsentReadinessRows)).not.toMatch(/customerName|emailAddress|phoneNumber|customerId/i));
});

describe("Slice 9-B data-use, risk and launch controls", () => {
  it("defines eight data-use principles", () => expect(dataUsePrinciples).toHaveLength(8));
  it("separates service messages from optional marketing", () => expect(dataUsePrinciples.join(" ")).toMatch(/service messages separate.*optional marketing/i));
  it("rejects silence and pre-ticked consent", () => expect(dataUsePrinciples.join(" ")).toMatch(/silence.*pre-ticked.*consent/i));
  it("requires access, retention and audit controls before persistence", () => expect(dataUsePrinciples.join(" ")).toMatch(/access controls.*retention rules.*audit trail/i));

  it.each(riskControls.slice(0, 10))("enforces risk control: %s", (control) => {
    expect(control).toMatch(/^No /);
    expect(control.length).toBeGreaterThan(30);
  });

  it("includes all fifteen risk controls", () => expect(riskControls).toHaveLength(15));
  it("includes all twenty-one launch gates", () => expect(launchReadinessChecklist).toHaveLength(21));
  it("keeps the inactive capability register explicit", () => expect(inactiveCapabilities).toEqual(expect.arrayContaining(["Marketing sends from this page", "Saved public-page preferences", "Coupon, reward or cashback generation", "Provider, queue or automation activation"])));
});

describe("Slice 9-B public route, copy and artifact safety", () => {
  it("renders the public Preference Centre title", () => expect(page).toContain("Your GoldPlus preferences"));
  it("renders all five required truth statements", () => {
    for (const statement of [preferenceCentreStatus.publicMessage, preferenceCentreStatus.sendMessage, preferenceCentreStatus.verificationMessage, preferenceCentreStatus.supportMessage, preferenceCentreStatus.futureProgrammeMessage]) {
      expect(page).toContain(`preferenceCentreStatus.${statement === preferenceCentreStatus.publicMessage ? "publicMessage" : statement === preferenceCentreStatus.sendMessage ? "sendMessage" : statement === preferenceCentreStatus.verificationMessage ? "verificationMessage" : statement === preferenceCentreStatus.supportMessage ? "supportMessage" : "futureProgrammeMessage"}`);
    }
  });
  it("contains no forbidden customer-state claims", () => forbiddenClaims.forEach((claim) => expect(publicSurface).not.toContain(claim)));
  it("contains no form, input, toggle or save button", () => expect(page).not.toMatch(/<form|<input|type=["']checkbox|<button|Save preferences/i));
  it("contains no browser persistence", () => expect(publicSurface).not.toMatch(/localStorage|sessionStorage|document\.cookie|setCookie/));
  it("contains no API, provider or send path", () => expect(publicSurface).not.toMatch(/fetch\(|apiBase|postJson|sendEmail|sendSms|sendWhatsApp|outbox|queue/i));
  it("contains no account, order, inventory or customer read", () => expect(publicSurface).not.toMatch(/\/account\/preferences|\/orders|\/inventory|customerId|readSessionToken/));
  it("redirects the consent alias to the canonical page with 303", () => expect(alias).toContain("Astro.redirect('/preferences', 303)"));
  it("links support, privacy and terms", () => expect(supportActions.map((item) => item.href)).toEqual(["/support", "/privacy", "/terms"]));
  it("adds an accessible section navigation", () => expect(page).toContain('aria-label="Preference Centre sections"'));
  it("adds accessible support and policy navigation", () => expect(page).toContain('aria-label="Preference support and policy links"'));
  it("adds visible focus treatment and responsive layouts", () => expect(page).toMatch(/focus-visible:ring-2[\s\S]*sm:grid-cols-2/));
  it("makes the page discoverable from the scoped footer integration", () => {
    expect(footer).toContain('href="/preferences"');
  });
  it("provides five customer guidance actions", () => expect(customerRightsGuidance).toHaveLength(5));
});
