import { createHash } from 'crypto';

/**
 * Owned-channel holdouts (2026-10-23). A promotional message (abandoned basket, win-back, loyalty expiry, review
 * reminder) is the shop's real marketing today. Each programme keeps a random share of its would-be recipients
 * unmessaged, recorded as the control arm, so that the revenue the message actually caused can be measured instead
 * of assumed. The arm is a deterministic hash: the same person is in the same arm for the whole wave (one calendar
 * month), so a customer is never messaged on Tuesday and held on Thursday, and the decision needs no lookup.
 *
 * Transactional messages (order dispatched, OTP, payment, delivery) are never held: they are not marketing.
 */
export const HOLDOUT_PROGRAMMES = ['abandoned_basket', 'win_back', 'loyalty_expiry', 'review_reminder', 'buy_again', 'campaign'] as const;
export type HoldoutProgramme = typeof HOLDOUT_PROGRAMMES[number];
export type HoldoutArm = 'treat' | 'hold';
export const DEFAULT_HOLDOUT_SHARE = 0.1;
/** Below this many subjects in an arm the comparison is reported as insufficient, never as a lift. */
export const MIN_ARM_SUBJECTS = 30;

export function isHoldoutProgramme(v: string): v is HoldoutProgramme {
  return (HOLDOUT_PROGRAMMES as readonly string[]).includes(v);
}

/** One wave per calendar month (UTC): long enough to accumulate buyers, short enough to answer within a quarter. */
export function waveKeyFor(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Uniform bucket in [0, 1) from a keyed hash. `salt` is a server secret so the arm cannot be predicted from a
 * customer id alone; `share` is the control share (0 disables the holdout: everyone is treated).
 */
export function holdoutArm(args: { programme: string; waveKey: string; subjectKey: string; salt: string; share: number }): HoldoutArm {
  const share = Number.isFinite(args.share) ? Math.min(Math.max(args.share, 0), 0.5) : 0;
  if (share <= 0) return 'treat';
  const digest = createHash('sha256').update(`${args.programme}:${args.waveKey}:${args.subjectKey}:${args.salt}`).digest();
  const bucket = digest.readUInt32BE(0) / 0x1_0000_0000;
  return bucket < share ? 'hold' : 'treat';
}

export interface ArmOutcome { subjects: number; buyers: number; orders: number; revenueMinor: bigint }
export interface LiftSummary {
  status: 'insufficient' | 'measured';
  reason: string | null;
  treat: { subjects: number; buyers: number; conversion: number; revenuePerSubject: number };
  hold: { subjects: number; buyers: number; conversion: number; revenuePerSubject: number };
  /** Conversion-rate difference (treat minus hold), as a rate. */
  conversionLift: number;
  /** Relative lift against the control rate, null when the control rate is zero. */
  relativeLift: number | null;
  /** Revenue the messages caused: (treat per-subject minus hold per-subject) times the treated subjects, whole minor units. */
  incrementalRevenueMinor: bigint;
  /** Two-proportion z-test on conversion; two-sided p-value. */
  z: number;
  pValue: number;
  significant: boolean;
}

function erfc(x: number): number {
  // Numerical Recipes erfc with fractional error < 1.2e-7: enough for a p-value shown to three decimals.
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

export function liftSummary(treat: ArmOutcome, hold: ArmOutcome): LiftSummary {
  const rate = (a: ArmOutcome) => (a.subjects > 0 ? a.buyers / a.subjects : 0);
  const rps = (a: ArmOutcome) => (a.subjects > 0 ? Number(a.revenueMinor) / a.subjects : 0);
  const t = { subjects: treat.subjects, buyers: treat.buyers, conversion: rate(treat), revenuePerSubject: rps(treat) };
  const h = { subjects: hold.subjects, buyers: hold.buyers, conversion: rate(hold), revenuePerSubject: rps(hold) };
  const base = { treat: t, hold: h, conversionLift: t.conversion - h.conversion, relativeLift: h.conversion > 0 ? (t.conversion - h.conversion) / h.conversion : null };
  const incremental = BigInt(Math.round((t.revenuePerSubject - h.revenuePerSubject) * treat.subjects));
  if (treat.subjects < MIN_ARM_SUBJECTS || hold.subjects < MIN_ARM_SUBJECTS) {
    return { status: 'insufficient', reason: `Needs at least ${MIN_ARM_SUBJECTS} people in each arm (treated ${treat.subjects}, held ${hold.subjects}).`, ...base, incrementalRevenueMinor: incremental, z: 0, pValue: 1, significant: false };
  }
  const pooled = (treat.buyers + hold.buyers) / (treat.subjects + hold.subjects);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / treat.subjects + 1 / hold.subjects));
  const z = se > 0 ? (t.conversion - h.conversion) / se : 0;
  const pValue = Math.min(1, erfc(Math.abs(z) / Math.SQRT2));
  return { status: 'measured', reason: null, ...base, incrementalRevenueMinor: incremental, z, pValue, significant: pValue < 0.05 };
}
