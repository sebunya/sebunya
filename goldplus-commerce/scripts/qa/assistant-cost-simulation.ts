/**
 * Shop-assistant month simulation (mandate 2026-10-12 §5, §5A.H.14, §12).
 *
 * Runs the REAL policy (apps/api/src/domain/assistant/AssistantPolicy.ts) over
 * synthetic traffic with an in-memory ledger and counters that behave like the
 * production ones (atomic reservation against the kill threshold; sliding
 * windows per visitor pseudonym and per network address). Model usage is
 * MOCKED at the mandate's planning figures; no provider is called and nothing
 * is spent. Deterministic: a seeded generator, so the numbers are repeatable.
 *
 *   pnpm exec tsx scripts/qa/assistant-cost-simulation.ts
 *
 * Scenarios: a normal month (1,000 sessions), the mandate's $7.20 stress month
 * (same sessions, 8,000/800 tokens per call), and three attacks on top of a
 * normal month: four-and-reset (fresh identities), a botnet behind 50
 * addresses, and one flooding visitor. Each reports spend, how many genuine
 * first-four requests met any friction, fifth-request outcomes and the
 * decisions taken.
 */
import {
  DEFAULT_ASSISTANT_CONFIG, costMicroUsd, decideAdmission, reservationMicroUsd, type AdmissionDecision, type AssistantConfig, type Usage,
} from '../../apps/api/src/domain/assistant/AssistantPolicy';

export interface ScenarioResult {
  name: string;
  sessions: number;
  meaningfulRequests: number;
  deterministicAnswers: number;
  paidCalls: number;
  settledUsd: number;
  peakCommittedUsd: number;
  /** True once the ledger refused a paid turn: the cap engaged. Settled spend never reaches the threshold itself because every turn is reserved first. */
  killReached: boolean;
  decisions: Record<AdmissionDecision, number>;
  /** Welcome-tier (requests 1–4) genuine requests that met anything other than an answer while the budget still had room. */
  welcomeFriction: number;
  welcomeRequests: number;
  fifthRequests: number;
  fifthServed: number;
  attackerPaidCalls: number;
  costPerResolvedUsd: number;
}

const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

class Windows {
  private hits = new Map<string, number[]>();
  count(key: string, at: number, windowMs: number): number {
    const arr = (this.hits.get(key) ?? []).filter((t) => at - t < windowMs);
    arr.push(at);
    this.hits.set(key, arr);
    return arr.length;
  }
}

class Ledger {
  settled = 0; reserved = 0; peak = 0;
  reserve(amount: number, kill: number): boolean {
    if (this.settled + this.reserved + amount > kill) return false;
    this.reserved += amount; this.peak = Math.max(this.peak, this.settled + this.reserved); return true;
  }
  settle(amount: number, cost: number): void { this.reserved -= amount; this.settled += cost; }
}

interface Visitor { principal: string; address: string; genuine: boolean }
interface Request { at: number; visitor: Visitor; wantsAi: boolean; usage: Usage }

const usageAt = (input: number, output: number, cached: boolean): Usage =>
  cached ? { inputTokens: input - 1500, outputTokens: output, cacheReadTokens: 1500, cacheWriteTokens: 0 } : { inputTokens: input - 1500, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 1500 };

/** 1,000 genuine sessions over 30 days: the mix the mandate describes, with the deterministic share the eval set measured. */
export function genuineMonth(seed: number, input: number, output: number): Request[] {
  const r = rng(seed);
  const out: Request[] = [];
  const DAY = 86_400_000;
  for (let s = 0; s < 1000; s += 1) {
    const kind = r();
    // 55% all-deterministic, 30% one paid answer, 13% a 2–4 paid comparison, 2% heavy-but-genuine (10–12 requests, 6 paid)
    const requests = kind < 0.55 ? 1 + Math.floor(r() * 3) : kind < 0.85 ? 2 + Math.floor(r() * 2) : kind < 0.98 ? 3 + Math.floor(r() * 3) : 10 + Math.floor(r() * 3);
    const paid = kind < 0.55 ? 0 : kind < 0.85 ? 1 : kind < 0.98 ? 2 + Math.floor(r() * 3) : 6;
    // 15% of sessions are a repeat visitor (same pseudonym as an earlier session that day)
    const repeat = r() < 0.15 && out.length > 0 ? out[Math.floor(r() * out.length)]!.visitor : null;
    const visitor: Visitor = repeat ?? { principal: `g${s}`, address: `net${Math.floor(r() * 400)}`, genuine: true };
    const start = Math.floor(r() * 30 * DAY);
    for (let i = 0; i < requests; i += 1) {
      const wantsAi = i < paid; // paid questions first, then the cheap follow-ups
      out.push({ at: start + i * (20_000 + Math.floor(r() * 90_000)), visitor, wantsAi, usage: usageAt(input, output, r() < 0.7) });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export function fourAndReset(seed: number, identities: number): Request[] {
  // One attacker, fresh cookie every four questions, all wanting paid answers, inside one hour on day 3.
  const r = rng(seed);
  const out: Request[] = [];
  for (let k = 0; k < identities; k += 1) {
    const visitor: Visitor = { principal: `reset${k}`, address: `attacker-net${k % 3}`, genuine: false };
    for (let i = 0; i < 4; i += 1) out.push({ at: 3 * 86_400_000 + k * 18_000 + i * 2_000, visitor, wantsAi: true, usage: usageAt(8000, 800, r() < 0.3) });
  }
  return out;
}

export function botnet(seed: number, bots: number): Request[] {
  const r = rng(seed);
  const out: Request[] = [];
  for (let k = 0; k < bots; k += 1) {
    const visitor: Visitor = { principal: `bot${k}`, address: `botnet${k % 50}`, genuine: false };
    for (let i = 0; i < 2; i += 1) out.push({ at: 10 * 86_400_000 + Math.floor(r() * 600_000) + i * 5_000, visitor, wantsAi: true, usage: usageAt(8000, 800, false) });
  }
  return out;
}

export function flood(count: number): Request[] {
  const visitor: Visitor = { principal: 'flooder', address: 'flood-net', genuine: false };
  return Array.from({ length: count }, (_, i) => ({ at: 20 * 86_400_000 + i * 500, visitor, wantsAi: true, usage: usageAt(8000, 800, false) }));
}

export function simulate(name: string, requests: Request[], config: AssistantConfig = DEFAULT_ASSISTANT_CONFIG): ScenarioResult {
  const windows = new Windows();
  const ledger = new Ledger();
  const decisions: Record<AdmissionDecision, number> = { DISABLED: 0, DENY_EXPENSIVE: 0, ALLOW_DETERMINISTIC: 0, AI_DISABLED: 0, SOFT_LIMIT: 0, GLOBAL_BUDGET_FALLBACK: 0, ALLOW_AI: 0 };
  const res: ScenarioResult = { name, sessions: new Set(requests.map((q) => q.visitor.principal)).size, meaningfulRequests: 0, deterministicAnswers: 0, paidCalls: 0, settledUsd: 0, peakCommittedUsd: 0, killReached: false, decisions, welcomeFriction: 0, welcomeRequests: 0, fifthRequests: 0, fifthServed: 0, attackerPaidCalls: 0, costPerResolvedUsd: 0 };
  const amount = reservationMicroUsd(config);
  let resolved = 0;
  for (const q of [...requests].sort((a, b) => a.at - b.at)) {
    const p = q.visitor.principal;
    const burst = windows.count(`burst:${p}`, q.at, 60_000);
    const address = windows.count(`addr:${q.visitor.address}`, q.at, 60_000);
    const meaningful = windows.count(`meaningful:${p}`, q.at, config.fairnessWindowHours * 3_600_000);
    const progressive = meaningful > config.freeRequests;
    let paidInHour = 0, paidInDay = 0, paidInPace = 0;
    if (q.wantsAi && progressive) {
      paidInHour = windows.count(`paid.h:${p}`, q.at, 3_600_000);
      paidInDay = windows.count(`paid.d:${p}`, q.at, 86_400_000);
      paidInPace = windows.count(`paid.p:${p}`, q.at, config.pacingSeconds * 1000);
    }
    let d = decideAdmission(config, q.wantsAi, { meaningfulInWindow: meaningful, burstInMinute: burst, addressInMinute: address, paidInHour, paidInDay, paidInPacingWindow: paidInPace, settledMicroUsd: ledger.settled, reservedMicroUsd: ledger.reserved });
    if (d.decision === 'ALLOW_AI' && !ledger.reserve(amount, config.killThresholdMicroUsd)) d = { ...d, decision: 'GLOBAL_BUDGET_FALLBACK' };
    decisions[d.decision] += 1;
    if (d.decision === 'GLOBAL_BUDGET_FALLBACK') res.killReached = true; // the cap engaged: paid answers stopped while settled + reserved stayed under the kill threshold
    if (d.decision !== 'DENY_EXPENSIVE') res.meaningfulRequests += 1;
    const budgetHadRoom = ledger.settled + ledger.reserved + amount <= config.killThresholdMicroUsd;
    if (q.visitor.genuine && meaningful <= config.freeRequests) {
      res.welcomeRequests += 1;
      if (d.decision !== 'ALLOW_AI' && d.decision !== 'ALLOW_DETERMINISTIC' && budgetHadRoom) res.welcomeFriction += 1;
    }
    if (q.visitor.genuine && meaningful === config.freeRequests + 1) { res.fifthRequests += 1; if (d.decision === 'ALLOW_AI' || d.decision === 'ALLOW_DETERMINISTIC') res.fifthServed += 1; }
    if (d.decision === 'ALLOW_AI') {
      res.paidCalls += 1;
      if (!q.visitor.genuine) res.attackerPaidCalls += 1;
      ledger.settle(amount, costMicroUsd(q.usage, config.model));
      resolved += 1;
    } else if (d.decision === 'ALLOW_DETERMINISTIC') { res.deterministicAnswers += 1; resolved += 1; }
    else if (d.decision === 'SOFT_LIMIT' || d.decision === 'GLOBAL_BUDGET_FALLBACK' || d.decision === 'AI_DISABLED') { res.deterministicAnswers += 1; /* the free fallback still answers from the catalogue */ }
  }
  res.settledUsd = ledger.settled / 1e6;
  res.peakCommittedUsd = ledger.peak / 1e6;
  res.costPerResolvedUsd = resolved ? res.settledUsd / resolved : 0;
  return res;
}

export function runAll(): ScenarioResult[] {
  const normal = genuineMonth(7, 2000, 200);
  const stress = genuineMonth(7, 8000, 800);
  return [
    simulate('normal month: 1,000 genuine sessions, 2,000 in / 200 out per call', normal),
    simulate('stress month: same sessions, 8,000 in / 800 out per call (the $7.20 scenario)', stress),
    simulate('normal month + four-and-reset attacker (300 fresh identities × 4 paid)', [...normal, ...fourAndReset(11, 300)]),
    simulate('normal month + botnet (500 bots × 2 paid behind 50 addresses)', [...normal, ...botnet(13, 500)]),
    simulate('normal month + one visitor flooding 600 requests at 2/s', [...normal, ...flood(600)]),
    simulate('stress month + four-and-reset + botnet', [...stress, ...fourAndReset(11, 300), ...botnet(13, 500)]),
    simulate('stress month + 1,500 reset identities (Sybil past the cap): the ledger must stop it', [...stress, ...fourAndReset(17, 1500)]),
  ];
}

if (process.argv[1] && /assistant-cost-simulation\.ts$/.test(process.argv[1])) {
  const kill = DEFAULT_ASSISTANT_CONFIG.killThresholdMicroUsd / 1e6;
  for (const r of runAll()) {
    console.log(`\n## ${r.name}`);
    console.log(`sessions ${r.sessions} · meaningful requests ${r.meaningfulRequests} · deterministic answers ${r.deterministicAnswers} · paid calls ${r.paidCalls} (attackers ${r.attackerPaidCalls})`);
    console.log(`settled $${r.settledUsd.toFixed(4)} · peak committed $${r.peakCommittedUsd.toFixed(4)} · kill $${kill.toFixed(2)} ${r.killReached ? 'ENGAGED (paid answers stopped)' : 'not engaged'} · $/resolved ${r.costPerResolvedUsd.toFixed(5)}`);
    console.log(`welcome-tier genuine requests ${r.welcomeRequests}, with friction ${r.welcomeFriction} · fifth requests ${r.fifthRequests}, served ${r.fifthServed}`);
    console.log(`decisions ${Object.entries(r.decisions).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  }
}
