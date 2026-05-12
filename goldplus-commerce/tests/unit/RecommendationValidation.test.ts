import { describe, expect, it } from "vitest";
import { validateMetadata } from "../../apps/api/src/application/recommendations/RecommendationValidation";

describe("RecommendationValidation - Recursive PII scanning", () => {
  it("accepts completely valid, clean metadata objects", () => {
    const clean = { pageType: "product", position: 1, railTitle: "Popular Now" };
    expect(() => validateMetadata(clean)).not.toThrow();
    expect(validateMetadata(clean)).toEqual(clean);
  });

  it("rejects flat objects containing explicitly disallowed PII keys", () => {
    expect(() => validateMetadata({ email: "test@example.com" })).toThrow("metadata contains disallowed key: email");
    expect(() => validateMetadata({ "device_fingerprint": "xyz" })).toThrow();
  });

  it("rejects nested objects containing disallowed keys deep within tree", () => {
    const nested = { customer: { email: "test@example.com" } };
    expect(() => validateMetadata(nested)).toThrow("metadata contains disallowed key: email");
  });

  it("rejects multi-level nested properties like profiles", () => {
    const deeper = { customer: { profile: { phoneNumber: "123" } } };
    expect(() => validateMetadata(deeper)).toThrow("metadata contains disallowed key: phoneNumber");
  });

  it("rejects keys housed within arrays iterating recursively", () => {
    const arr = { events: [{ ipAddress: "127.0.0.1" }] };
    expect(() => validateMetadata(arr)).toThrow("metadata contains disallowed key: ipAddress");
  });

  it("normalises special character variants correctly during blockade comparison", () => {
    expect(() => validateMetadata({ "IP_ADDRESS": "..." })).toThrow();
    expect(() => validateMetadata({ "phone_number": "..." })).toThrow();
    expect(() => validateMetadata({ "Phone Number": "..." })).toThrow();
  });
});
