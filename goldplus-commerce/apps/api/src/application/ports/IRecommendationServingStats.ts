/**
 * Operational serving facts about the recommendation engine. NOT customer
 * behaviour: a rail we rendered says nothing about what a person did, so it
 * is counted here and never written to the behavioural event stream.
 */
export interface IRecommendationServingStats {
  /** Must never throw and never block the serve. */
  record(fact: { placement: string; empty: boolean; fallbackServed: boolean; at: Date }): void;
}
