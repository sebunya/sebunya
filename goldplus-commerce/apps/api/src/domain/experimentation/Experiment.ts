/**
 * A/B experimentation engine — domain rules.
 *
 * Assignment is deterministic: the same visitor always lands in the same
 * variant of the same experiment (hash of visitorId + experiment key),
 * so no assignment state needs to be stored to keep the experience
 * stable across visits. Weights let traffic be split unevenly.
 */

export type ExperimentStatus = 'DRAFT' | 'RUNNING' | 'PAUSED' | 'COMPLETED';

export const EXPERIMENT_STATUSES: readonly ExperimentStatus[] = ['DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED'];

export interface ExperimentVariant {
  /** Short machine key, e.g. "control" or "variant_b". */
  key: string;
  /** Human label shown in the admin UI. */
  name: string;
  /** Relative traffic weight, must be a positive integer. */
  weight: number;
}

export interface ExperimentDefinition {
  key: string;
  name: string;
  hypothesis: string;
  /** The KPI this experiment is judged on, e.g. "conversion_rate". */
  targetMetric: string;
  status: ExperimentStatus;
  variants: ExperimentVariant[];
}

export type ExperimentValidation =
  | { ok: true; experiment: ExperimentDefinition }
  | { ok: false; code: 'BAD_KEY' | 'BAD_NAME' | 'BAD_VARIANTS'; message: string };

const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,58}[a-z0-9]$/;

export function validateExperiment(input: {
  key: string;
  name: string;
  hypothesis?: string | null;
  targetMetric?: string | null;
  variants: Array<{ key?: unknown; name?: unknown; weight?: unknown }>;
}): ExperimentValidation {
  const key = (input.key || '').trim().toLowerCase();
  if (!KEY_PATTERN.test(key)) {
    return {
      ok: false,
      code: 'BAD_KEY',
      message: 'Experiment key must be 3-60 chars of lowercase letters, digits, hyphens or underscores.',
    };
  }

  const name = (input.name || '').trim();
  if (!name || name.length > 120) {
    return { ok: false, code: 'BAD_NAME', message: 'Experiment name is required (max 120 chars).' };
  }

  if (!Array.isArray(input.variants) || input.variants.length < 2 || input.variants.length > 6) {
    return { ok: false, code: 'BAD_VARIANTS', message: 'An experiment needs between 2 and 6 variants.' };
  }

  const variants: ExperimentVariant[] = [];
  const seenKeys = new Set<string>();
  for (const raw of input.variants) {
    const vKey = String(raw.key ?? '').trim().toLowerCase();
    const vName = String(raw.name ?? '').trim() || vKey;
    const weight = Number(raw.weight ?? 1);
    if (!vKey || vKey.length > 40) {
      return { ok: false, code: 'BAD_VARIANTS', message: 'Every variant needs a key (max 40 chars).' };
    }
    if (seenKeys.has(vKey)) {
      return { ok: false, code: 'BAD_VARIANTS', message: `Duplicate variant key "${vKey}".` };
    }
    if (!Number.isInteger(weight) || weight < 1 || weight > 100) {
      return { ok: false, code: 'BAD_VARIANTS', message: `Variant "${vKey}" weight must be an integer between 1 and 100.` };
    }
    seenKeys.add(vKey);
    variants.push({ key: vKey, name: vName.slice(0, 120), weight });
  }

  return {
    ok: true,
    experiment: {
      key,
      name,
      hypothesis: (input.hypothesis || '').trim().slice(0, 500),
      targetMetric: ((input.targetMetric || '').trim() || 'conversion_rate').slice(0, 60),
      status: 'DRAFT',
      variants,
    },
  };
}

/**
 * FNV-1a 32-bit hash — small, dependency-free, and stable across
 * runtimes, which is exactly what deterministic bucketing needs.
 */
export function fnv1aHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministically assigns a visitor to a variant, proportionally to
 * the variant weights. Returns null when the experiment has no variants.
 */
export function assignVariant(experiment: ExperimentDefinition, visitorId: string): ExperimentVariant | null {
  if (experiment.variants.length === 0) return null;
  const totalWeight = experiment.variants.reduce((sum, v) => sum + v.weight, 0);
  if (totalWeight <= 0) return null;

  const bucket = fnv1aHash(`${experiment.key}::${visitorId}`) % totalWeight;
  let cursor = 0;
  for (const variant of experiment.variants) {
    cursor += variant.weight;
    if (bucket < cursor) return variant;
  }
  return experiment.variants[experiment.variants.length - 1];
}

export function isValidStatusTransition(from: ExperimentStatus, to: ExperimentStatus): boolean {
  if (from === to) return false;
  switch (from) {
    case 'DRAFT':
      return to === 'RUNNING';
    case 'RUNNING':
      return to === 'PAUSED' || to === 'COMPLETED';
    case 'PAUSED':
      return to === 'RUNNING' || to === 'COMPLETED';
    case 'COMPLETED':
      return false;
  }
}
