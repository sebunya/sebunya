import { describe, expect, it } from 'vitest';

import {
  resolveSourceChanges, SOURCE_DESCRIPTORS,
  type SourceStatePorts, type SourceRow, type SourceCursor,
} from '../../apps/api/src/application/use-cases/seo-growth/SourceStateResolver';
import { planAffectedEntities } from '../../apps/api/src/application/use-cases/seo-growth/AffectedEntityPlanner';

/**
 * The activation bridge: what must already be true before a real Google
 * private key is allowed anywhere near production.
 *
 * The failure this guards against is subtle and expensive. A provider connects,
 * authentication succeeds, everyone declares victory — and the enrichment that
 * was supposed to follow was lost to a crash, or repeats every six hours
 * forever, or quietly marks itself complete after failing halfway. None of
 * those announce themselves.
 */

const PROVIDER = SOURCE_DESCRIPTORS.find((d) => d.key === 'provider_enrichment')!;
const GSC_PERF = SOURCE_DESCRIPTORS.find((d) => d.key === 'gsc_performance')!;
const REVISION = 'google-search-console:conn-1:v1';

function ports(over: {
  inventory?: Record<string, SourceRow[]>;
  known?: Record<string, Map<string, string>>;
  cursors?: Record<string, SourceCursor>;
} = {}): SourceStatePorts {
  return {
    now: async () => '2026-08-13T12:00:00.000Z',
    readCursor: async (k) => over.cursors?.[k] ?? { at: null, id: null },
    readKnownState: async (k) => over.known?.[k] ?? new Map(),
    readSince: async () => [],
    readInventory: async (d) => over.inventory?.[d.key] ?? [],
  };
}

/** One operational connection holding an active credential. */
const connected = (revision = REVISION): SourceRow[] => [{ id: revision, at: null, stateHash: revision }];

// ── Provider connection becomes a durable source change (§5) ────────────────

describe('a connected provider produces a durable enrichment requirement', () => {
  it('emits PROVIDER_ENRICHED when a connection has never been enriched', async () => {
    const snap = await resolveSourceChanges(ports({ inventory: { provider_enrichment: connected() } }), [PROVIDER]);

    expect(snap.changes).toHaveLength(1);
    expect(snap.changes[0].source).toBe('PROVIDER_CONNECTED');
    expect(snap.changes[0].changeKind).toBe('PROVIDER_ENRICHED');
    expect(snap.changes[0].entityId).toBe(REVISION);
  });

  it('emits nothing when the provider is not connected', async () => {
    const snap = await resolveSourceChanges(ports({ inventory: { provider_enrichment: [] } }), [PROVIDER]);
    expect(snap.changes).toHaveLength(0);
  });

  it('selects a global plan, because new provider evidence touches everything', () => {
    const universe = [
      { entityType: 'CATEGORY' as const, entityId: '/power' },
      { entityType: 'CATEGORY' as const, entityId: '/audio' },
    ];
    const plan = planAffectedEntities({
      changes: [{ source: 'PROVIDER_CONNECTED', entityId: REVISION, changeType: 'PROVIDER_ENRICHED' }],
      resolver: {
        categoriesForProduct: () => [], urlsForEntity: () => [], clustersForUrl: () => [],
        answerUnitsForFact: () => [], linkSourcesForUrl: () => [],
      },
      universe,
    });
    expect(plan.mode).toBe('GLOBAL');
    expect(plan.evaluate).toHaveLength(2);
    // Going wide here is correct, not a fallback.
    expect(plan.fellBack).toBe(false);
  });
});

// ── Crash safety: the requirement is derived, not delivered (§7) ────────────

describe('the enrichment requirement cannot be lost by a crash', () => {
  it('regenerates on the next run when the previous run never committed', async () => {
    // A crash between connecting and enriching leaves known state empty. The
    // requirement is a FUNCTION of connection state, not a message that can be
    // dropped, so it simply reappears.
    const first = await resolveSourceChanges(ports({ inventory: { provider_enrichment: connected() } }), [PROVIDER]);
    expect(first.changes).toHaveLength(1);

    const second = await resolveSourceChanges(ports({ inventory: { provider_enrichment: connected() } }), [PROVIDER]);
    expect(second.changes).toHaveLength(1);
    expect(second.changes[0].entityId).toBe(REVISION);
  });

  it('proposes completion state only for commit after the run succeeds', async () => {
    const snap = await resolveSourceChanges(ports({ inventory: { provider_enrichment: connected() } }), [PROVIDER]);
    expect(snap.proposedState.provider_enrichment.get(REVISION)).toBe(REVISION);
  });
});

// ── Idempotency per revision (§8, §9, §25) ──────────────────────────────────

describe('initial enrichment happens exactly once per connection revision', () => {
  it('does not repeat once the revision is committed complete', async () => {
    const snap = await resolveSourceChanges(ports({
      inventory: { provider_enrichment: connected() },
      known: { provider_enrichment: new Map([[REVISION, REVISION]]) },
    }), [PROVIDER]);

    // This is what stops a full historical backfill running every six hours.
    expect(snap.changes).toHaveLength(0);
  });

  it('re-enriches when a replacement credential creates a new revision', async () => {
    const snap = await resolveSourceChanges(ports({
      inventory: { provider_enrichment: connected('google-search-console:conn-1:v2') },
      known: { provider_enrichment: new Map([[REVISION, REVISION]]) },
    }), [PROVIDER]);

    expect(snap.changes).toHaveLength(1);
    expect(snap.changes[0].entityId).toBe('google-search-console:conn-1:v2');
  });

  it('retries the SAME revision after a failed enrichment', async () => {
    // A failed run commits nothing, so known state still lacks the revision.
    const snap = await resolveSourceChanges(ports({
      inventory: { provider_enrichment: connected() },
      known: { provider_enrichment: new Map() },
    }), [PROVIDER]);

    expect(snap.changes).toHaveLength(1);
    expect(snap.changes[0].entityId).toBe(REVISION);
  });

  it('is safe under repeated delivery — the trigger may fire many times', async () => {
    const known = new Map([[REVISION, REVISION]]);
    for (let i = 0; i < 5; i += 1) {
      const snap = await resolveSourceChanges(ports({
        inventory: { provider_enrichment: connected() }, known: { provider_enrichment: known },
      }), [PROVIDER]);
      expect(snap.changes).toHaveLength(0);
    }
  });

  it('carries completed revisions forward rather than pruning them', async () => {
    // The inventory lists outstanding work, not the whole world. Pruning would
    // make every completed enrichment look new again on the next run.
    const snap = await resolveSourceChanges(ports({
      inventory: { provider_enrichment: [] },
      known: { provider_enrichment: new Map([[REVISION, REVISION]]) },
    }), [PROVIDER]);

    expect(snap.proposedState.provider_enrichment.get(REVISION)).toBe(REVISION);
  });
});

// ── Disconnect preserves evidence (§11) ─────────────────────────────────────

describe('disconnecting a provider never erases what it already told us', () => {
  it('emits no DELETED change when the connection disappears', async () => {
    const snap = await resolveSourceChanges(ports({
      inventory: { provider_enrichment: [] },
      known: { provider_enrichment: new Map([[REVISION, REVISION]]) },
    }), [PROVIDER]);

    // A disconnect is not a deletion. Emitting DELETED here would invite
    // downstream code to retire the intelligence the provider contributed.
    expect(snap.changes.filter((c) => c.changeKind === 'DELETED')).toHaveLength(0);
  });

  it('does not re-run initial enrichment on reconnect at the same revision', async () => {
    const snap = await resolveSourceChanges(ports({
      inventory: { provider_enrichment: connected() },
      known: { provider_enrichment: new Map([[REVISION, REVISION]]) },
    }), [PROVIDER]);
    expect(snap.changes).toHaveLength(0);
  });

  it('reports the deletion capability honestly', () => {
    expect(PROVIDER.deleteDetection).toBe('NONE');
  });
});

// ── Demand changes name the affected entity (§13, §17) ──────────────────────

describe('observed demand is attributed to an entity, not to matching words', () => {
  it('emits a CATEGORY change when an entity’s demand digest moves', async () => {
    const snap = await resolveSourceChanges(ports({
      inventory: { gsc_performance: [{ id: '/power', at: '2026-08-12', stateHash: 'NEW' }] },
      known: { gsc_performance: new Map([['/power', 'OLD']]) },
    }), [GSC_PERF]);

    expect(snap.changes).toHaveLength(1);
    expect(snap.changes[0].source).toBe('CATEGORY');
    expect(snap.changes[0].entityId).toBe('/power');
  });

  it('emits nothing when demand is unchanged', async () => {
    const snap = await resolveSourceChanges(ports({
      inventory: { gsc_performance: [{ id: '/power', at: '2026-08-12', stateHash: 'SAME' }] },
      known: { gsc_performance: new Map([['/power', 'SAME']]) },
    }), [GSC_PERF]);
    expect(snap.changes).toHaveLength(0);
  });

  it('routes a demand change straight to the affected opportunity', () => {
    const plan = planAffectedEntities({
      changes: [{ source: 'CATEGORY', entityId: '/power', changeType: 'UPDATED' }],
      resolver: {
        categoriesForProduct: () => [], urlsForEntity: () => [], clustersForUrl: () => [],
        answerUnitsForFact: () => [], linkSourcesForUrl: () => [],
      },
      universe: [
        { entityType: 'CATEGORY', entityId: '/power' },
        { entityType: 'CATEGORY', entityId: '/audio' },
      ],
    });

    expect(plan.mode).toBe('EXACT');
    expect(plan.directlyAffected).toContainEqual({ entityType: 'CATEGORY', entityId: '/power' });
    // The entity whose demand did not move is not re-scored.
    expect(plan.evaluate.map((e) => e.entityId)).not.toContain('/audio');
  });

  it('does not emit a DELETED change when a page stops receiving impressions', async () => {
    // Zero recent impressions is not a deleted entity, and treating it as one
    // would retire a real category.
    const snap = await resolveSourceChanges(ports({
      inventory: { gsc_performance: [] },
      known: { gsc_performance: new Map([['/power', 'OLD']]) },
    }), [GSC_PERF]);
    expect(snap.changes.filter((c) => c.changeKind === 'DELETED')).toHaveLength(0);
  });
});
