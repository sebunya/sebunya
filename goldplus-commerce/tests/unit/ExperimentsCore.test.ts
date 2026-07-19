import { describe, expect, it } from 'vitest';
import { canTransitionExperiment, deterministicVariant, validateVariants } from '../../apps/api/src/domain/experiments/Experiment';

const variants = [{ key: 'control', name: 'Control', weightBasisPoints: 5000 }, { key: 'treatment', name: 'Treatment', weightBasisPoints: 5000 }];
describe('Experiments core', () => {
  it('assigns the same subject deterministically', () => {
    const first = deterministicVariant('11111111-1111-4111-8111-111111111111', 'subject-hash', variants);
    expect(deterministicVariant('11111111-1111-4111-8111-111111111111', 'subject-hash', variants)).toEqual(first);
  });
  it('rejects invalid weights and duplicate keys', () => expect(validateVariants([{ key: 'a', name: 'A', weightBasisPoints: 5000 }, { key: 'a', name: 'B', weightBasisPoints: 4000 }])).toHaveLength(2));
  it('enforces truthful lifecycle transitions', () => {
    expect(canTransitionExperiment('DRAFT', 'RUNNING')).toBe(false);
    expect(canTransitionExperiment('DRAFT', 'READY')).toBe(true);
    expect(canTransitionExperiment('READY', 'RUNNING')).toBe(true);
    expect(canTransitionExperiment('RUNNING', 'PAUSED')).toBe(true);
    expect(canTransitionExperiment('COMPLETED', 'RUNNING')).toBe(false);
  });
});
