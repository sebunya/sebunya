import { describe, expect, it } from "vitest";
import {
  RECOMMENDATION_EVENT_TYPES,
  SYSTEM_EXPOSURE_EVENT_TYPES,
  VISITOR_ACTION_EVENT_TYPES,
} from "../../packages/shared/src/recommendations";

/**
 * Every event type is either something a visitor did or something we emitted
 * about our own rendering. Adding a type forces this decision: the snapshot
 * below fails until the new name is placed.
 */
describe("visitor action vs system exposure", () => {
  it("the two lists partition the vocabulary", () => {
    const all = [...VISITOR_ACTION_EVENT_TYPES, ...SYSTEM_EXPOSURE_EVENT_TYPES].sort();
    expect(all).toEqual([...RECOMMENDATION_EVENT_TYPES].sort());
  });

  it("nothing we render counts as a visitor action", () => {
    for (const t of ["RECOMMENDATION_RESPONSE", "RECOMMENDATION_IMPRESSION", "RECOMMENDATION_VIEWED", "RECOMMENDATION_ERROR"]) {
      expect(VISITOR_ACTION_EVENT_TYPES).not.toContain(t);
    }
  });

  it("a NEW type must be classified deliberately (update this count with the decision)", () => {
    expect(RECOMMENDATION_EVENT_TYPES.length).toBe(28);
    expect(VISITOR_ACTION_EVENT_TYPES.length).toBe(24);
  });
});
