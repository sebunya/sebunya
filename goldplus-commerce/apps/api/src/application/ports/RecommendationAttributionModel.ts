/**
 * THE attribution model (R3.1 §5.5) — application-layer truth, exposed with
 * every commercial payload so the operator always sees WHICH model produced a
 * number, and a silent model change is impossible.
 */
export const ATTRIBUTION_MODEL = {
  name: "last_eligible_touch_v1",
  clickWindowDays: 7,
  atcWindowDays: 7,
  viewThroughWindowDays: 1,
  precedence: ["RECOMMENDATION_ADD_TO_CART", "RECOMMENDATION_CLICKED"],
  assistOnly: ["RECOMMENDATION_IMPRESSION"],
} as const;
