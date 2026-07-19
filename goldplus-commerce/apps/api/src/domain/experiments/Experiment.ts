export const EXPERIMENT_STATUSES = ['DRAFT', 'READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'INCONCLUSIVE', 'INVALID'] as const;
export type ExperimentStatus = typeof EXPERIMENT_STATUSES[number];

export interface ExperimentVariant { key: string; name: string; weightBasisPoints: number }

export function validateVariants(variants: ExperimentVariant[]): string[] {
  const errors: string[] = [];
  if (variants.length < 2) errors.push('At least two variants are required.');
  if (new Set(variants.map((variant) => variant.key)).size !== variants.length) errors.push('Variant keys must be unique.');
  if (variants.some((variant) => !/^[a-z0-9_-]{1,40}$/i.test(variant.key))) errors.push('Variant keys must be bounded identifiers.');
  if (variants.some((variant) => variant.weightBasisPoints < 1 || variant.weightBasisPoints > 9999)) errors.push('Variant weights must be between 1 and 9999 basis points.');
  if (variants.reduce((sum, variant) => sum + variant.weightBasisPoints, 0) !== 10_000) errors.push('Variant weights must total 10000 basis points.');
  return errors;
}

/** Stable FNV-1a assignment. The salt is an immutable experiment UUID; no random reassignment. */
export function deterministicVariant(experimentId: string, subjectHash: string, variants: ExperimentVariant[]): ExperimentVariant {
  const errors = validateVariants(variants);
  if (errors.length) throw new Error(errors[0]);
  let hash = 0x811c9dc5;
  for (const char of `${experimentId}:${subjectHash}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const bucket = hash % 10_000;
  let boundary = 0;
  for (const variant of variants) {
    boundary += variant.weightBasisPoints;
    if (bucket < boundary) return variant;
  }
  return variants[variants.length - 1];
}

const transitions: Record<ExperimentStatus, ExperimentStatus[]> = {
  DRAFT: ['READY', 'INVALID'], READY: ['RUNNING', 'INVALID'], RUNNING: ['PAUSED', 'COMPLETED', 'INCONCLUSIVE', 'INVALID'],
  PAUSED: ['RUNNING', 'COMPLETED', 'INCONCLUSIVE', 'INVALID'], COMPLETED: [], INCONCLUSIVE: [], INVALID: [],
};
export function canTransitionExperiment(from: ExperimentStatus, to: ExperimentStatus): boolean { return transitions[from].includes(to); }
