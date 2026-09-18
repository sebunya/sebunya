/**
 * Spend governance for provider calls. A run is planned, costed with a
 * conservative per-call estimate, and checked against every cap BEFORE any
 * call is made; during the run, actual spend is re-checked before each call.
 * Nothing here spends money — it only decides whether spending may happen.
 */
export interface BudgetPolicy {
  maxQueriesPerRun: number;
  maxSpendPerRunUsd: number;
  maxDailySpendUsd: number;
  maxMonthlySpendUsd: number;
  /** Per-provider monthly cap; absent = only the global caps apply. */
  providerMonthlyUsd?: Readonly<Record<string, number>>;
  /** A run whose estimate exceeds this needs explicit human approval. */
  approvalAboveUsd: number;
}

export interface SpendToDate {
  todayUsd: number;
  monthUsd: number;
  providerMonthUsd: Readonly<Record<string, number>>;
}

export interface RunPlan {
  queryCount: number;
  /** calls per provider in this run */
  callsByProvider: Readonly<Record<string, number>>;
  /** estimated USD per call, by provider (upper-bound estimates) */
  estimateUsdPerCall: Readonly<Record<string, number>>;
}

export type BudgetDecision =
  | { allowed: true; estimatedUsd: number; requiresApproval: boolean }
  | { allowed: false; estimatedUsd: number; reason: string };

export function estimateRunUsd(plan: RunPlan): number {
  return Object.entries(plan.callsByProvider).reduce((s, [p, n]) => s + n * (plan.estimateUsdPerCall[p] ?? 0), 0);
}

export function evaluateRunBudget(plan: RunPlan, policy: BudgetPolicy, spent: SpendToDate): BudgetDecision {
  const est = estimateRunUsd(plan);
  const deny = (reason: string): BudgetDecision => ({ allowed: false, estimatedUsd: est, reason });
  if (plan.queryCount === 0) return deny('The run has no active queries.');
  if (Object.values(plan.callsByProvider).every((n) => n === 0)) return deny('No configured provider is enabled for this project.');
  if (plan.queryCount > policy.maxQueriesPerRun) return deny(`${plan.queryCount} queries exceeds the per-run limit of ${policy.maxQueriesPerRun}.`);
  if (est > policy.maxSpendPerRunUsd) return deny(`Estimated $${est.toFixed(2)} exceeds the per-run limit of $${policy.maxSpendPerRunUsd.toFixed(2)}.`);
  if (spent.todayUsd + est > policy.maxDailySpendUsd) return deny(`Estimated $${est.toFixed(2)} on top of $${spent.todayUsd.toFixed(2)} today exceeds the daily limit of $${policy.maxDailySpendUsd.toFixed(2)}.`);
  if (spent.monthUsd + est > policy.maxMonthlySpendUsd) return deny(`Estimated $${est.toFixed(2)} on top of $${spent.monthUsd.toFixed(2)} this month exceeds the monthly limit of $${policy.maxMonthlySpendUsd.toFixed(2)}.`);
  for (const [p, cap] of Object.entries(policy.providerMonthlyUsd ?? {})) {
    const pe = (plan.callsByProvider[p] ?? 0) * (plan.estimateUsdPerCall[p] ?? 0);
    if ((spent.providerMonthUsd[p] ?? 0) + pe > cap) return deny(`${p} would exceed its monthly limit of $${cap.toFixed(2)}.`);
  }
  return { allowed: true, estimatedUsd: est, requiresApproval: est > policy.approvalAboveUsd };
}

/** Mid-run guard: may one more call of `callUsd` be made? */
export function mayContinue(runSpentUsd: number, callUsd: number, policy: BudgetPolicy, spent: SpendToDate): boolean {
  return runSpentUsd + callUsd <= policy.maxSpendPerRunUsd
    && spent.todayUsd + callUsd <= policy.maxDailySpendUsd
    && spent.monthUsd + callUsd <= policy.maxMonthlySpendUsd;
}

export const DEFAULT_BUDGET: BudgetPolicy = {
  maxQueriesPerRun: 50,
  maxSpendPerRunUsd: 2,
  maxDailySpendUsd: 5,
  maxMonthlySpendUsd: 30,
  approvalAboveUsd: 1,
};
