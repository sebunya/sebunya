/**
 * Storage-capacity testing (0119) — the evidence rules, kept pure.
 *
 * The single non-negotiable: a product with NO test record is NOT_TESTED, and
 * NOT_TESTED must never render as verified quality. There is no default row,
 * no "assumed pass", and no aggregate that treats untested stock as good.
 *
 * A counterfeit flash drive that reports 128GB and holds 8GB is the exact harm
 * this exists to catch, so a PASS requires a measured capacity within
 * tolerance of the claim — not merely the absence of a complaint.
 */

export const STORAGE_TEST_RESULTS = ['PASS', 'FAIL', 'INCONCLUSIVE'] as const;
export type StorageTestResult = (typeof STORAGE_TEST_RESULTS)[number];

/** What the storefront/admin may say about a product's storage verification. */
export const STORAGE_EVIDENCE_STATES = ['VERIFIED', 'FAILED', 'INCONCLUSIVE', 'NOT_TESTED'] as const;
export type StorageEvidenceState = (typeof STORAGE_EVIDENCE_STATES)[number];

export const STORAGE_TEST_METHODS = ['FULL_WRITE_VERIFY', 'SAMPLED_WRITE_VERIFY', 'CAPACITY_REPORT_ONLY'] as const;
export type StorageTestMethod = (typeof STORAGE_TEST_METHODS)[number];

/**
 * Usable capacity is legitimately below the marketed figure (1 GB marketed =
 * 10^9 bytes, reported as 2^30 bytes ≈ 0.931 GiB, minus filesystem overhead).
 * Anything at or above this ratio is consistent with an honest device; below
 * it is a real shortfall, not a rounding artefact.
 */
export const STORAGE_CAPACITY_TOLERANCE = 0.9;

export interface StorageTestInput {
  productId: string;
  claimedCapacityGb: number;
  testedCapacityGb?: number | null;
  readMbS?: number | null;
  writeMbS?: number | null;
  method: StorageTestMethod | string;
  tool?: string | null;
  tester: string;
  testedAt: string;
  evidenceNote?: string | null;
}

export type StorageTestValidation =
  | { ok: true; input: StorageTestInput & { result: StorageTestResult; capacityRatio: number | null } }
  | { ok: false; code: string; message: string };

/** The measured/claimed ratio, or null when nothing was measured. */
export function capacityRatio(claimedGb: unknown, testedGb: unknown): number | null {
  // null/undefined/'' mean NOT MEASURED, not zero — Number() would coerce all
  // three to 0 and turn an unmeasured drive into a fabricated FAIL.
  if (testedGb === null || testedGb === undefined || testedGb === '') return null;
  const claimed = Number(claimedGb);
  const tested = Number(testedGb);
  if (!Number.isFinite(claimed) || claimed <= 0) return null;
  if (!Number.isFinite(tested) || tested < 0) return null;
  return tested / claimed;
}

/**
 * The result is DERIVED from the measurement, never hand-picked: an operator
 * cannot mark a device PASS while recording a capacity that does not support
 * it. A test with no measured capacity is INCONCLUSIVE — never PASS.
 */
export function deriveStorageResult(claimedGb: unknown, testedGb: unknown): StorageTestResult {
  const ratio = capacityRatio(claimedGb, testedGb);
  if (ratio === null) return 'INCONCLUSIVE';
  return ratio >= STORAGE_CAPACITY_TOLERANCE ? 'PASS' : 'FAIL';
}

export function validateStorageTest(raw: StorageTestInput): StorageTestValidation {
  if (!raw.productId) return { ok: false, code: 'BAD_INPUT', message: 'productId is required.' };
  const claimed = Number(raw.claimedCapacityGb);
  if (!Number.isFinite(claimed) || claimed <= 0) {
    return { ok: false, code: 'BAD_INPUT', message: 'claimedCapacityGb must be a positive number.' };
  }
  if (!(raw.tester ?? '').trim()) {
    return { ok: false, code: 'EVIDENCE_REQUIRED', message: 'A test must record who performed it.' };
  }
  if (!(raw.testedAt ?? '').trim() || Number.isNaN(new Date(raw.testedAt).getTime())) {
    return { ok: false, code: 'BAD_INPUT', message: 'testedAt must be a valid date.' };
  }
  if (!STORAGE_TEST_METHODS.includes(raw.method as StorageTestMethod)) {
    return { ok: false, code: 'BAD_INPUT', message: `method must be one of ${STORAGE_TEST_METHODS.join(', ')}.` };
  }
  const tested = raw.testedCapacityGb == null || raw.testedCapacityGb === ('' as unknown)
    ? null
    : Number(raw.testedCapacityGb);
  if (tested !== null && (!Number.isFinite(tested) || tested < 0)) {
    return { ok: false, code: 'BAD_INPUT', message: 'testedCapacityGb must be a non-negative number when provided.' };
  }
  return {
    ok: true,
    input: {
      ...raw,
      claimedCapacityGb: claimed,
      testedCapacityGb: tested,
      tester: raw.tester.trim(),
      result: deriveStorageResult(claimed, tested),
      capacityRatio: capacityRatio(claimed, tested),
      evidenceNote: (raw.evidenceNote ?? '')?.trim() || null,
    },
  };
}

/**
 * The evidence state for a product from its test history. No rows at all →
 * NOT_TESTED. This is the ONLY function the storefront should ask.
 */
export function storageEvidenceState(tests: Array<{ result?: string; testedAt?: string }>): StorageEvidenceState {
  if (!Array.isArray(tests) || tests.length === 0) return 'NOT_TESTED';
  // Any recorded failure dominates: a device that failed once is not verified
  // merely because a later sample passed.
  if (tests.some((t) => t.result === 'FAIL')) return 'FAILED';
  if (tests.some((t) => t.result === 'PASS')) return 'VERIFIED';
  return 'INCONCLUSIVE';
}

/** Storefront copy per state. NOT_TESTED says so — it never implies quality. */
export function storageEvidenceLabel(state: StorageEvidenceState): string {
  switch (state) {
    case 'VERIFIED': return 'Capacity verified in our workshop';
    case 'FAILED': return 'Failed our capacity check — not sold as advertised capacity';
    case 'INCONCLUSIVE': return 'Tested, but the result was inconclusive';
    default: return 'Not yet capacity-tested';
  }
}

/** Only a VERIFIED product may carry the public capacity-verified claim. */
export const mayClaimCapacityVerified = (state: StorageEvidenceState): boolean => state === 'VERIFIED';
