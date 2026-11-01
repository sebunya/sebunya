import { describe, expect, it } from 'vitest';

import {
  planAffectedEntities, planEfficiency, FULL_FALLBACK_THRESHOLD,
  type DependencyResolver, type EntityRef, type SourceChange,
} from '../../apps/api/src/application/use-cases/seo-growth/AffectedEntityPlanner';

const universe: EntityRef[] = [
  { entityType: 'CATEGORY', entityId: 'cat-1' },
  { entityType: 'CATEGORY', entityId: 'cat-2' },
  { entityType: 'CATEGORY', entityId: 'cat-3' },
  { entityType: 'URL', entityId: '/a' },
  { entityType: 'URL', entityId: '/b' },
];

const resolver = (over: Partial<DependencyResolver> = {}): DependencyResolver => ({
  categoriesForProduct: () => ['cat-1'],
  urlsForEntity: () => ['/a'],
  clustersForUrl: () => ['cluster:x'],
  answerUnitsForFact: () => ['answer:1'],
  linkSourcesForUrl: () => ['/b'],
  ...over,
});

const change = (over: Partial<SourceChange> = {}): SourceChange => ({
  source: 'PRODUCT', entityId: 'p-1', changeType: 'UPDATED', ...over,
});

describe('incremental means incremental, not a label on a full scan', () => {
  it('evaluates nothing when nothing changed', () => {
    const plan = planAffectedEntities({ changes: [], resolver: resolver(), universe });
    expect(plan.evaluate).toHaveLength(0);
    expect(plan.mode).toBe('EXACT');
  });

  it('follows a product change up into its categories and pages', () => {
    const plan = planAffectedEntities({ changes: [change()], resolver: resolver(), universe });

    expect(plan.mode).toBe('EXACT');
    expect(plan.directlyAffected).toContainEqual({ entityType: 'PRODUCT', entityId: 'p-1' });
    // The category is not directly changed but its readiness depends on it.
    expect(plan.dependentAffected).toContainEqual({ entityType: 'CATEGORY', entityId: 'cat-1' });
    expect(plan.dependentAffected).toContainEqual({ entityType: 'URL', entityId: '/a' });
    expect(plan.affectedClusters).toContain('cluster:x');
  });

  it('actually skips the entities nothing touched', () => {
    const plan = planAffectedEntities({ changes: [change()], resolver: resolver(), universe });
    const eff = planEfficiency(plan, universe.length);

    expect(eff.skipped).toBeGreaterThan(0);
    expect(eff.materiallySmaller).toBe(true);
    // cat-2 and cat-3 depend on nothing that moved.
    expect(plan.evaluate.map((e) => e.entityId)).not.toContain('cat-2');
  });

  it('propagates a link change backwards to the pages that link in', () => {
    const plan = planAffectedEntities({
      changes: [change({ source: 'INTERNAL_LINK', entityId: '/a' })],
      resolver: resolver(), universe,
    });
    expect(plan.dependentAffected).toContainEqual({ entityType: 'URL', entityId: '/b' });
  });

  it('invalidates the answer units grounded in a changed fact', () => {
    const plan = planAffectedEntities({
      changes: [change({ source: 'FACT', entityId: 'fact:price:p-1' })],
      resolver: resolver(), universe,
    });
    expect(plan.affectedAnswerUnits).toContain('answer:1');
  });
});

describe('the planner widens rather than risk a stale portfolio', () => {
  it('rebuilds everything when the scoring policy changes', () => {
    const plan = planAffectedEntities({
      changes: [change({ source: 'POLICY', entityId: 'scoring' })],
      resolver: resolver(), universe,
    });
    expect(plan.mode).toBe('GLOBAL');
    expect(plan.evaluate).toHaveLength(universe.length);
    // A policy change is not a failure of incrementality — it is genuinely global.
    expect(plan.fellBack).toBe(false);
    expect(plan.reasons.join(' ')).toMatch(/whole portfolio/i);
  });

  it('rebuilds when a provider connects, because evidence appears everywhere at once', () => {
    const plan = planAffectedEntities({
      changes: [change({ source: 'PROVIDER_CONNECTED', entityId: 'GSC' })],
      resolver: resolver(), universe,
    });
    expect(plan.mode).toBe('GLOBAL');
    expect(plan.evaluate).toHaveLength(universe.length);
  });

  it('gives up honestly past the change threshold instead of guessing', () => {
    const many = Array.from({ length: FULL_FALLBACK_THRESHOLD + 1 }, (_, i) => change({ entityId: `p-${i}` }));
    const plan = planAffectedEntities({ changes: many, resolver: resolver(), universe });

    expect(plan.mode).toBe('FULL_FALLBACK');
    expect(plan.fellBack).toBe(true);
    expect(plan.evaluate).toHaveLength(universe.length);
  });

  it('expands when it meets a change source it has no rule for', () => {
    const plan = planAffectedEntities({
      changes: [change({ source: 'UNKNOWN', entityId: '???' })],
      resolver: resolver(), universe,
    });
    // Missing a downstream update would be far worse than evaluating too much.
    expect(plan.mode).toBe('EXPANDED');
    expect(plan.evaluate).toHaveLength(universe.length);
    expect(plan.reasons.join(' ')).toMatch(/no dependency rule/i);
  });

  it('never reports a full evaluation as materially smaller', () => {
    const plan = planAffectedEntities({
      changes: [change({ source: 'POLICY', entityId: 'scoring' })],
      resolver: resolver(), universe,
    });
    expect(planEfficiency(plan, universe.length).materiallySmaller).toBe(false);
  });
});

describe('the same entity is never evaluated twice', () => {
  it('deduplicates when several changes converge on one entity', () => {
    const plan = planAffectedEntities({
      changes: [
        change({ source: 'PRICE', entityId: 'p-1' }),
        change({ source: 'INVENTORY', entityId: 'p-1' }),
        change({ source: 'LIFECYCLE', entityId: 'p-1' }),
      ],
      resolver: resolver(), universe,
    });
    const keys = plan.evaluate.map((e) => `${e.entityType}:${e.entityId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('does not list an entity as dependent when it is already direct', () => {
    const plan = planAffectedEntities({
      changes: [
        change({ source: 'CATEGORY', entityId: 'cat-1' }),
        change({ source: 'PRODUCT', entityId: 'p-1' }),
      ],
      resolver: resolver(), universe,
    });
    expect(plan.directlyAffected).toContainEqual({ entityType: 'CATEGORY', entityId: 'cat-1' });
    expect(plan.dependentAffected).not.toContainEqual({ entityType: 'CATEGORY', entityId: 'cat-1' });
  });
});
