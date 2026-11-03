import { apiBase } from './api';

/**
 * The public loyalty programme as /commerce/loyalty-programme describes it.
 * One shape for /loyalty and /loyalty-terms (each page carried its own copy,
 * and they had drifted: tiers with and without benefits, badges on one page,
 * termsEffectiveFrom on the other). Anything not configured yet arrives as
 * null or absent and the pages say exactly that — nothing is defaulted here.
 */
export interface Programme {
  active: boolean;
  earnRatePer1000Ugx: number;
  expiryDays: number;
  redemption: { configured: boolean; pointValueUgx?: number; minPoints?: number; maxShareBps?: number };
  vesting?: string;
  /** 0087: only ACTIVE earn sources arrive here — nothing unshipped is listed. */
  earnSources?: {
    verificationScan: number | null;
    counterfeitReport: number | null;
    phoneVerification: number | null;
    referral: { referrer: number | null; referee: number | null; bonus?: { friends: number; points: number } | null } | null;
    birthday: number | null;
    streak: { orders: number; windowDays: number | null; points: number } | null;
    milestones?: Array<{ title: string; description: string | null; points: number }>;
  } | null;
  tiers?: Array<{ code: string; name: string; threshold: number; benefits?: Record<string, boolean> }>;
  /** 0087: the real admin-defined badge catalogue — empty until configured. */
  badges?: Array<{ key: string; title: string; description?: string | null }>;
  termsVersion?: string | null;
  termsEffectiveFrom?: string | null;
}

/** 0088: the running scratch-card draw, with the odds the engine selects on. */
export interface RewardDraw {
  name: string;
  tokenExpiryDays: number;
  odds?: Array<{ label: string; oddsBps: number; soldOut: boolean }>;
}

/**
 * Programme and draw in ONE round trip's time: /loyalty fetched them one after
 * the other (up to 3 s + 2.5 s on a slow API) although neither depends on the
 * other. Either call failing or timing out leaves its half null, which the
 * pages render as "not running" — never as invented terms.
 */
export async function loadProgrammeAndDraw(): Promise<{ programme: Programme | null; draw: RewardDraw | null }> {
  const [programme, draw] = await Promise.all([
    fetch(`${apiBase}/commerce/loyalty-programme`, { signal: AbortSignal.timeout(3000) })
      .then(async (res) => {
        const json: any = res.ok ? await res.json().catch(() => null) : null;
        return json?.success && json.data?.active ? (json.data as Programme) : null;
      })
      .catch(() => null),
    fetch(`${apiBase}/commerce/reward-draw`, { signal: AbortSignal.timeout(3000) })
      .then(async (res) => {
        const json: any = res.ok ? await res.json().catch(() => null) : null;
        return json?.success && json.data?.enabled ? (json.data as RewardDraw) : null;
      })
      .catch(() => null),
  ]);
  return { programme, draw };
}
