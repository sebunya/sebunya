/**
 * Affected-entity planning: the difference between "incremental" as a label
 * and incremental as a fact.
 *
 * The previous implementation evaluated every category on every run and called
 * itself INCREMENTAL. That is correct but wasteful, and worse, it hides the
 * question that actually matters: when one product changes, what genuinely
 * depends on it?
 *
 * Two rules govern this file:
 *
 *   CORRECTNESS OUTRANKS OPTIMISATION. When dependency certainty is weak the
 *   planner widens the set (EXPANDED) or gives up and rebuilds (FULL_FALLBACK).
 *   Silently missing a downstream update to claim a small evaluated count would
 *   be the worst possible outcome — the portfolio would quietly go stale.
 *
 *   SOME CHANGES ARE GLOBAL. A scoring-policy change touches every score; a
 *   provider connecting for the first time touches every entity that gains
 *   evidence. Forcing those through an incremental path would be wrong, so the
 *   planner recognises them and selects FULL_REBUILD deliberately.
 *
 * Pure and deterministic.
 */

import type { EntityType } from './OrganicIntelligenceIdentity';

export const CHANGE_SOURCES = [
  'PRODUCT', 'INVENTORY', 'PRICE', 'CATEGORY', 'LIFECYCLE', 'CANONICAL',
  'INDEXABILITY', 'INTERNAL_LINK', 'CONTENT', 'SCHEMA', 'FACT',
  'GSC_QUERY', 'POLICY', 'PROVIDER_CONNECTED', 'TAXONOMY', 'UNKNOWN',
] as const;
export type ChangeSource = (typeof CHANGE_SOURCES)[number];

export const PLAN_MODES = ['EXACT', 'EXPANDED', 'FULL_FALLBACK', 'GLOBAL'] as const;
export type PlanMode = (typeof PLAN_MODES)[number];

export interface SourceChange {
  source: ChangeSource;
  /** The thing that changed, in its own namespace (product id, url, fact key). */
  entityId: string;
  changeType: string;
  /** Monotonic version/timestamp of the change, for provenance. */
  changeVersion?: string;
}

export interface EntityRef {
  entityType: EntityType;
  entityId: string;
}

/** How the world hangs together, for invalidation purposes. */
export interface DependencyResolver {
  /** Categories a product belongs to. */
  categoriesForProduct(productId: string): string[];
  /** URLs that render a product or category. */
  urlsForEntity(ref: EntityRef): string[];
  /** Clusters whose ownership involves a URL. */
  clustersForUrl(url: string): string[];
  /** Answer units grounded in a fact. */
  answerUnitsForFact(factKey: string): string[];
  /** Pages linking to a URL, for link-graph propagation. */
  linkSourcesForUrl(url: string): string[];
}

export interface AffectedPlan {
  mode: PlanMode;
  directlyAffected: EntityRef[];
  dependentAffected: EntityRef[];
  affectedAnswerUnits: string[];
  affectedClusters: string[];
  /** Everything that must be evaluated, deduplicated. */
  evaluate: EntityRef[];
  reasons: string[];
  /** True when the planner could not bound the set and rebuilt instead. */
  fellBack: boolean;
}

/** Changes whose true affected set is the entire portfolio. */
const GLOBAL_SOURCES: ChangeSource[] = ['POLICY', 'PROVIDER_CONNECTED', 'TAXONOMY'];

/**
 * Beyond this many changes, per-change dependency expansion costs more than a
 * rebuild and risks missing transitive edges. Rebuild instead — honestly.
 */
export const FULL_FALLBACK_THRESHOLD = 50;

const refKey = (r: EntityRef) => `${r.entityType}:${r.entityId}`;

export function planAffectedEntities(input: {
  changes: SourceChange[];
  resolver: DependencyResolver;
  /** The complete evaluable universe, used for GLOBAL and FULL_FALLBACK. */
  universe: EntityRef[];
}): AffectedPlan {
  const reasons: string[] = [];
  const changes = input.changes ?? [];

  if (changes.length === 0) {
    return {
      mode: 'EXACT', directlyAffected: [], dependentAffected: [], affectedAnswerUnits: [],
      affectedClusters: [], evaluate: [], fellBack: false,
      reasons: ['No source changes; nothing to evaluate.'],
    };
  }

  const global = changes.filter((c) => GLOBAL_SOURCES.includes(c.source));
  if (global.length > 0) {
    reasons.push(
      `${global.map((g) => g.source).join(', ')} affects the whole portfolio, so a full rebuild is the CORRECT plan, not a fallback.`,
    );
    return {
      mode: 'GLOBAL',
      directlyAffected: input.universe,
      dependentAffected: [],
      affectedAnswerUnits: [],
      affectedClusters: [],
      evaluate: input.universe,
      reasons,
      fellBack: false,
    };
  }

  if (changes.length > FULL_FALLBACK_THRESHOLD) {
    reasons.push(
      `${changes.length} changes exceeds the ${FULL_FALLBACK_THRESHOLD}-change threshold; expanding each one risks missing a transitive edge, so the planner rebuilds.`,
    );
    return {
      mode: 'FULL_FALLBACK',
      directlyAffected: input.universe,
      dependentAffected: [],
      affectedAnswerUnits: [],
      affectedClusters: [],
      evaluate: input.universe,
      reasons,
      fellBack: true,
    };
  }

  const direct = new Map<string, EntityRef>();
  const dependent = new Map<string, EntityRef>();
  const answerUnits = new Set<string>();
  const clusters = new Set<string>();
  let uncertain = false;

  const addDirect = (r: EntityRef) => direct.set(refKey(r), r);
  const addDependent = (r: EntityRef) => {
    if (!direct.has(refKey(r))) dependent.set(refKey(r), r);
  };

  for (const change of changes) {
    switch (change.source) {
      case 'PRODUCT':
      case 'INVENTORY':
      case 'PRICE':
      case 'LIFECYCLE': {
        addDirect({ entityType: 'PRODUCT', entityId: change.entityId });
        // A product's readiness rolls up into its categories.
        for (const cat of input.resolver.categoriesForProduct(change.entityId)) {
          addDependent({ entityType: 'CATEGORY', entityId: cat });
        }
        for (const url of input.resolver.urlsForEntity({ entityType: 'PRODUCT', entityId: change.entityId })) {
          addDependent({ entityType: 'URL', entityId: url });
          for (const cl of input.resolver.clustersForUrl(url)) clusters.add(cl);
        }
        break;
      }
      case 'CATEGORY': {
        addDirect({ entityType: 'CATEGORY', entityId: change.entityId });
        for (const url of input.resolver.urlsForEntity({ entityType: 'CATEGORY', entityId: change.entityId })) {
          addDependent({ entityType: 'URL', entityId: url });
          for (const cl of input.resolver.clustersForUrl(url)) clusters.add(cl);
        }
        break;
      }
      case 'CANONICAL':
      case 'INDEXABILITY':
      case 'SCHEMA':
      case 'CONTENT': {
        addDirect({ entityType: 'URL', entityId: change.entityId });
        // Ownership and cannibalisation both key off the URL's clusters.
        for (const cl of input.resolver.clustersForUrl(change.entityId)) clusters.add(cl);
        break;
      }
      case 'INTERNAL_LINK': {
        addDirect({ entityType: 'URL', entityId: change.entityId });
        for (const src of input.resolver.linkSourcesForUrl(change.entityId)) {
          addDependent({ entityType: 'URL', entityId: src });
        }
        break;
      }
      case 'FACT': {
        // Facts do not map to an entity directly; they invalidate the answer
        // units grounded in them.
        for (const au of input.resolver.answerUnitsForFact(change.entityId)) answerUnits.add(au);
        break;
      }
      case 'GSC_QUERY': {
        clusters.add(change.entityId);
        break;
      }
      default: {
        // An unrecognised change source is exactly when NOT to guess.
        uncertain = true;
        reasons.push(`Change source ${change.source} has no dependency rule; widening the evaluated set.`);
      }
    }
  }

  if (uncertain) {
    reasons.push('Dependency certainty was incomplete, so the planner expanded rather than risk a stale portfolio.');
    return {
      mode: 'EXPANDED',
      directlyAffected: [...direct.values()],
      dependentAffected: input.universe.filter((u) => !direct.has(refKey(u))),
      affectedAnswerUnits: [...answerUnits].sort(),
      affectedClusters: [...clusters].sort(),
      evaluate: input.universe,
      reasons,
      fellBack: false,
    };
  }

  const evaluate = [...direct.values(), ...dependent.values()];
  reasons.push(
    `${changes.length} change(s) → ${direct.size} directly affected, ${dependent.size} dependent, ` +
    `${answerUnits.size} answer unit(s), ${clusters.size} cluster(s).`,
  );

  return {
    mode: 'EXACT',
    directlyAffected: [...direct.values()],
    dependentAffected: [...dependent.values()],
    affectedAnswerUnits: [...answerUnits].sort(),
    affectedClusters: [...clusters].sort(),
    evaluate,
    reasons,
    fellBack: false,
  };
}

/**
 * Reports how much work the plan avoided. Reported honestly: if the evaluated
 * set is not materially smaller than the universe, the caller should say
 * LOGICALLY_CORRECT_BUT_NOT_OPTIMISED rather than claim incrementality.
 */
export function planEfficiency(plan: AffectedPlan, universeSize: number): {
  totalEligible: number;
  directlyAffected: number;
  dependentAffected: number;
  evaluated: number;
  skipped: number;
  materiallySmaller: boolean;
} {
  const evaluated = plan.evaluate.length;
  return {
    totalEligible: universeSize,
    directlyAffected: plan.directlyAffected.length,
    dependentAffected: plan.dependentAffected.length,
    evaluated,
    skipped: Math.max(0, universeSize - evaluated),
    // "Materially smaller" means it actually saved work, not that it technically
    // filtered something.
    materiallySmaller: universeSize > 0 && evaluated < universeSize * 0.8,
  };
}
