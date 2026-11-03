import type { IOutcomeSuggestionReader } from '../../ports/IOutcomeSuggestionReader';
import { suggestGoals, DEFAULT_CPA_MARGIN_SHARE_PCT, type Suggestion } from '../../../domain/measurement/OutcomeGoalSuggestions';
import { effectiveNumber } from '../../../domain/measurement/MeasurementConfig';

export interface MeasurementSettingsPort {
  values(): Promise<Record<string, string>>;
  set(input: { key: string; value: string; actorId: string }): Promise<{ ok: true } | { ok: false; message: string }>;
}

export interface SuggestedGoal extends Suggestion { currentSetting: string | null }

/** Suggest every goal and micro value from the shop's own data, beside what is set today. */
export class SuggestOutcomeGoalsUseCase {
  constructor(private readonly reader: IOutcomeSuggestionReader, private readonly settings: MeasurementSettingsPort) {}

  async execute(now = new Date()): Promise<{ generatedAt: string; suggestions: SuggestedGoal[]; facts: { paidOrders: number; aovUgx: number; marginPerPaidOrderUgx: number; costCoverage: number; daysWithSessions: number } }> {
    const [facts, values] = await Promise.all([this.reader.facts(now), this.settings.values()]);
    const cpaMarginSharePct = effectiveNumber(values, 'cpa_margin_share_pct') ?? DEFAULT_CPA_MARGIN_SHARE_PCT;
    const suggestions = suggestGoals({ ...facts, cpaMarginSharePct }).map((s) => ({ ...s, currentSetting: values[s.key] ?? null }));
    return {
      generatedAt: now.toISOString(),
      suggestions,
      facts: { paidOrders: facts.paidOrders, aovUgx: facts.aovUgx, marginPerPaidOrderUgx: facts.marginPerPaidOrderUgx, costCoverage: facts.costCoverage, daysWithSessions: facts.days.filter((d) => d.sessions > 0).length },
    };
  }
}

/** Adopt the suggested values (all, or the keys named) through the audited settings path. */
export class AdoptOutcomeGoalsUseCase {
  constructor(private readonly suggest: SuggestOutcomeGoalsUseCase, private readonly settings: MeasurementSettingsPort) {}

  async execute(input: { keys?: string[] | null; actorId: string }): Promise<{ adopted: Array<{ key: string; value: string }>; refused: Array<{ key: string; message: string }> }> {
    const { suggestions } = await this.suggest.execute();
    const wanted = input.keys && input.keys.length ? new Set(input.keys) : null;
    const adopted: Array<{ key: string; value: string }> = [];
    const refused: Array<{ key: string; message: string }> = [];
    for (const s of suggestions) {
      if (wanted && !wanted.has(s.key)) continue;
      const value = s.unit === 'pct' && s.key === 'goal_conversion_pct' ? String(s.suggested) : String(Math.round(s.suggested));
      const r = await this.settings.set({ key: s.key, value, actorId: input.actorId });
      if (r.ok) adopted.push({ key: s.key, value }); else refused.push({ key: s.key, message: r.message });
    }
    return { adopted, refused };
  }
}
