import { describe, expect, it } from 'vitest';

import {
  resolveSourceChanges, reconcileInventory, isAfter, stateHashOf,
  SOURCE_DESCRIPTORS,
  type SourceStatePorts, type SourceDescriptor, type SourceRow, type SourceCursor,
} from '../../apps/api/src/application/use-cases/seo-growth/SourceStateResolver';

/**
 * These tests exist because a cursor bug is invisible. A pipeline that skips a
 * row does not crash, log, or fail a smoke test — it just quietly stops
 * reflecting reality, and the first symptom is an operator noticing that the
 * intelligence is wrong weeks later.
 */

const PRODUCTS = SOURCE_DESCRIPTORS.find((d) => d.key === 'products')!;
const CATEGORIES = SOURCE_DESCRIPTORS.find((d) => d.key === 'categories')!;

function ports(over: {
  since?: Record<string, SourceRow[]>;
  inventory?: Record<string, SourceRow[]>;
  known?: Record<string, Map<string, string>>;
  cursors?: Record<string, SourceCursor>;
  now?: string;
} = {}): SourceStatePorts {
  return {
    now: async () => over.now ?? '2026-08-13T12:00:00.000Z',
    readCursor: async (k) => over.cursors?.[k] ?? { at: null, id: null },
    readKnownState: async (k) => over.known?.[k] ?? new Map(),
    readSince: async (d) => over.since?.[d.key] ?? [],
    readInventory: async (d) => over.inventory?.[d.key] ?? [],
  };
}

const row = (id: string, at: string | null, hash: string, extra: Partial<SourceRow> = {}): SourceRow =>
  ({ id, at, stateHash: hash, ...extra });

// ── Cursor arithmetic (§4) ──────────────────────────────────────────────────

describe('the cursor cannot skip a row that shares a timestamp', () => {
  it('treats everything as new before bootstrap', () => {
    expect(isAfter(row('a', '2026-01-01T00:00:00Z', 'h'), { at: null, id: null })).toBe(true);
  });

  it('includes a later timestamp', () => {
    expect(isAfter(row('a', '2026-01-02T00:00:00Z', 'h'), { at: '2026-01-01T00:00:00Z', id: 'z' })).toBe(true);
  });

  it('excludes an earlier timestamp', () => {
    expect(isAfter(row('a', '2025-12-31T00:00:00Z', 'h'), { at: '2026-01-01T00:00:00Z', id: 'a' })).toBe(false);
  });

  it('includes a row sharing the cursor timestamp with a greater id', () => {
    // The whole point: a `> timestamp` scan would drop this row forever.
    expect(isAfter(row('b', '2026-01-01T00:00:00Z', 'h'), { at: '2026-01-01T00:00:00Z', id: 'a' })).toBe(true);
  });

  it('excludes the cursor row itself, so it is not processed twice', () => {
    expect(isAfter(row('a', '2026-01-01T00:00:00Z', 'h'), { at: '2026-01-01T00:00:00Z', id: 'a' })).toBe(false);
  });

  it('handles many rows at the same instant without losing any', async () => {
    const at = '2026-08-13T10:00:00.000Z';
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => row(id, at, `h-${id}`));
    // Cursor sits on the second row; the last three must still be seen.
    const snap = await resolveSourceChanges(
      ports({ since: { products: rows }, cursors: { products: { at, id: 'b' } } }),
      [PRODUCTS],
    );
    expect(snap.changes.map((c) => c.entityId)).toEqual(['c', 'd', 'e']);
  });
});

// ── Source snapshot (§5) ────────────────────────────────────────────────────

describe('every run is attributable to one source boundary', () => {
  it('captures a snapshot id and a single upper bound', async () => {
    const snap = await resolveSourceChanges(ports(), [PRODUCTS, CATEGORIES]);
    expect(snap.snapshotId).toMatch(/^[0-9a-f]{32}$/);
    expect(snap.upperBound).toBe('2026-08-13T12:00:00.000Z');
  });

  it('produces the same snapshot id for the same boundary', async () => {
    const a = await resolveSourceChanges(ports(), [PRODUCTS]);
    const b = await resolveSourceChanges(ports(), [PRODUCTS]);
    expect(b.snapshotId).toBe(a.snapshotId);
  });

  it('produces a different snapshot id when the boundary moves', async () => {
    const a = await resolveSourceChanges(ports({ now: '2026-08-13T12:00:00.000Z' }), [PRODUCTS]);
    const b = await resolveSourceChanges(ports({ now: '2026-08-13T13:00:00.000Z' }), [PRODUCTS]);
    expect(b.snapshotId).not.toBe(a.snapshotId);
  });
});

// ── Change classification (§8) ──────────────────────────────────────────────

describe('changes carry the kind and provenance downstream needs', () => {
  it('classifies a row we have never seen as CREATED', async () => {
    const snap = await resolveSourceChanges(
      ports({ since: { products: [row('p1', '2026-08-13T10:00:00Z', 'h1')] } }), [PRODUCTS],
    );
    expect(snap.changes[0].changeKind).toBe('CREATED');
  });

  it('classifies a known row with a new hash as UPDATED', async () => {
    const snap = await resolveSourceChanges(ports({
      since: { products: [row('p1', '2026-08-13T10:00:00Z', 'h2')] },
      known: { products: new Map([['p1', 'h1']]) },
    }), [PRODUCTS]);
    expect(snap.changes[0].changeKind).toBe('UPDATED');
  });

  it('emits nothing when the state hash is unchanged', async () => {
    const snap = await resolveSourceChanges(ports({
      since: { products: [row('p1', '2026-08-13T10:00:00Z', 'h1')] },
      known: { products: new Map([['p1', 'h1']]) },
    }), [PRODUCTS]);
    // A row can be re-read without having changed. That is not a change.
    expect(snap.changes).toHaveLength(0);
  });
});

// ── Late arrival and revision (§7) ──────────────────────────────────────────

describe('a revision of the past is not a new current event', () => {
  it('classifies a historical update to a known row as SOURCE_REVISED', async () => {
    const snap = await resolveSourceChanges(ports({
      since: { products: [row('p1', '2026-08-13T10:00:00Z', 'h2', { historical: true })] },
      known: { products: new Map([['p1', 'h1']]) },
    }), [PRODUCTS]);
    // A provider backfill must not read as a fresh SEO incident.
    expect(snap.changes[0].changeKind).toBe('SOURCE_REVISED');
    expect(snap.changes[0].historical).toBe(true);
  });

  it('still treats a first-ever historical row as CREATED', async () => {
    const snap = await resolveSourceChanges(ports({
      since: { products: [row('p1', '2026-08-13T10:00:00Z', 'h1', { historical: true })] },
    }), [PRODUCTS]);
    expect(snap.changes[0].changeKind).toBe('CREATED');
  });
});

// ── Deletion (§6) ───────────────────────────────────────────────────────────

describe('a disappeared source object does not leave immortal intelligence', () => {
  it('detects deletion by inventory diff where no tombstone exists', async () => {
    const snap = await resolveSourceChanges(ports({
      inventory: { categories: [row('/power', null, 'h1')] },
      known: { categories: new Map([['/power', 'h1'], ['/retired', 'h9']]) },
    }), [CATEGORIES]);

    const deleted = snap.changes.filter((c) => c.changeKind === 'DELETED');
    expect(deleted.map((d) => d.entityId)).toEqual(['/retired']);
  });

  it('reports the deletion coverage limit honestly rather than implying exactness', async () => {
    const snap = await resolveSourceChanges(ports(), [PRODUCTS]);
    // products has no deleted_at column; claiming exact coverage would be a lie.
    expect(snap.coverageLimits.join(' ')).toMatch(/INVENTORY_DIFF/);
  });

  it('reconcileInventory finds rows that vanished from a cursor-scanned source', async () => {
    const gone = await reconcileInventory(ports({
      inventory: { products: [row('p1', null, '')] },
      known: { products: new Map([['p1', 'h1'], ['p2', 'h2']]) },
    }), PRODUCTS);
    expect(gone.map((g) => g.entityId)).toEqual(['p2']);
  });
});

// ── Sources without a timestamp (§3) ────────────────────────────────────────

describe('a source with no timestamp column is still handled correctly', () => {
  it('detects change by state hash rather than pretending to have a cursor', async () => {
    const snap = await resolveSourceChanges(ports({
      inventory: { categories: [row('/power', null, 'NEW'), row('/audio', null, 'SAME')] },
      known: { categories: new Map([['/power', 'OLD'], ['/audio', 'SAME']]) },
    }), [CATEGORIES]);

    expect(snap.changes.map((c) => c.entityId)).toEqual(['/power']);
    expect(snap.usedFullScan).toBe(true);
  });

  it('leaves the cursor untouched for a hash-reconciled source', async () => {
    const snap = await resolveSourceChanges(ports({
      inventory: { categories: [row('/power', null, 'h')] },
    }), [CATEGORIES]);
    expect(snap.proposedCursors.categories).toEqual({ at: null, id: null });
  });
});

// ── Cursor advancement (§4) ─────────────────────────────────────────────────

describe('the proposed cursor never claims more than was actually read', () => {
  it('advances only to the last row processed, not to the upper bound', async () => {
    const snap = await resolveSourceChanges(ports({
      since: { products: [row('p1', '2026-08-13T09:00:00Z', 'h1'), row('p2', '2026-08-13T10:00:00Z', 'h2')] },
      now: '2026-08-13T12:00:00.000Z',
    }), [PRODUCTS]);
    // Advancing to the upper bound would silently swallow anything written
    // between the last row read and "now".
    expect(snap.proposedCursors.products).toEqual({ at: '2026-08-13T10:00:00Z', id: 'p2' });
  });

  it('leaves the cursor where it was when nothing changed', async () => {
    const start = { at: '2026-08-13T09:00:00Z', id: 'p1' };
    const snap = await resolveSourceChanges(ports({ cursors: { products: start } }), [PRODUCTS]);
    expect(snap.proposedCursors.products).toEqual(start);
  });

  it('returns proposed cursors rather than committing them', async () => {
    // Commitment belongs to the coordinator, after the whole run succeeds.
    const snap = await resolveSourceChanges(ports({
      since: { products: [row('p1', '2026-08-13T10:00:00Z', 'h1')] },
    }), [PRODUCTS]);
    expect(snap).toHaveProperty('proposedCursors');
    expect(snap).not.toHaveProperty('committed');
  });
});

// ── State hashing ───────────────────────────────────────────────────────────

describe('state hashing is stable and meaning-sensitive', () => {
  it('does not depend on key insertion order', () => {
    expect(stateHashOf({ b: 2, a: 1 })).toBe(stateHashOf({ a: 1, b: 2 }));
  });

  it('changes when a value changes', () => {
    expect(stateHashOf({ a: 1 })).not.toBe(stateHashOf({ a: 2 }));
  });

  it('distinguishes an absent value from zero', () => {
    // The evidence model depends on this: UNKNOWN is not a measurement of none.
    expect(stateHashOf({ stock: null })).not.toBe(stateHashOf({ stock: 0 }));
  });
});
