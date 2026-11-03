import type { DayPoint } from '../../domain/measurement/OutcomeGoalSuggestions';

/** What the suggestion engine needs: a daily series (ascending, Kampala days), order economics, and micro event outcomes. */
export interface OutcomeSuggestionFacts {
  days: DayPoint[];
  paidOrders: number;
  aovUgx: number;
  marginPerPaidOrderUgx: number;
  costCoverage: number;
  micro: Array<{ key: string; label: string; n: number; converted: number }>;
}

export interface IOutcomeSuggestionReader {
  facts(now?: Date): Promise<OutcomeSuggestionFacts>;
}
