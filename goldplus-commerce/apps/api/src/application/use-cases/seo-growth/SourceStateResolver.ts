/**
 * Source-state reconciliation: the missing input that makes incremental
 * materialisation possible.
 *
 * AffectedEntityPlanner already knows how to answer "given these changes, what
 * must be recomputed?". It could not become authoritative because nothing
 * could answer the question before it: WHAT CHANGED since the last successful
 * materialisation?
 *
 * This module answers that, and it is deliberately NOT a queue, a scheduler or
 * an event bus. It reads the state the commerce tables already hold and
 * derives a transient ChangeSet. Nothing is enqueued, nothing is scheduled,
 * and nothing needs draining.
 *
 * The honest part is that GoldPlus's sources do NOT all support the same
 * change evidence, and pretending otherwise is how incremental pipelines
 * silently drop updates. Actual capability, verified against the production
 * schema:
 *
 *   products            updated_at + id        -> exact cursor
 *   categories          id, name, slug only    -> NO timestamp at all, so a
 *                                                 cursor is impossible and
 *                                                 state hashing is the only
 *                                                 correct answer
 *   seo_change_ledger   occurred_at + id       -> exact cursor (operator SEO
 *                                                 changes: URL/TEMPLATE/etc)
 *   seo_queries         last_observed_at + id  -> exact cursor, provider data
 *
 * Neither products nor categories has a deleted_at column, so hard deletion
 * leaves no trace in a cursor scan. That is reported as a capability limit
 * (INVENTORY_DIFF required), never papered over — a deleted product whose
 * opportunity lives forever is exactly the failure this must prevent.
 *
 * Pure and deterministic; all I/O goes through ports.
 */

import { createHash } from 'node:crypto';
import type { ChangeSource, SourceChange } from './AffectedEntityPlanner';

/** How much change evidence a source can actually provide. */
export const CURSOR_CAPABILITIES = [
  /** Monotonic (timestamp, id) — exact, lossless, replayable. */
  'CURSOR_EXACT',
  /** No usable cursor; correctness comes from hashing observed state. */
  'STATE_HASH',
  /** Neither; the source must be fully reconciled every time. */
  'FULL_ONLY',
] as const;
export type CursorCapability = (typeof CURSOR_CAPABILITIES)[number];

export const DELETE_DETECTIONS = [
  /** An explicit tombstone/soft-delete column exists. */
  'TOMBSTONE',
  /** Deletion is only observable by diffing the full id inventory. */
  'INVENTORY_DIFF',
  /** Deletion cannot be detected at all — must never be claimed silently. */
  'NONE',
] as const;
export type DeleteDetection = (typeof DELETE_DETECTIONS)[number];

/**
 * A lossless cursor. Timestamp alone is unsafe: several rows routinely share
 * a millisecond, and a `> timestamp` scan would skip every row after the first
 * at that instant. The stable id breaks the tie deterministically.
 */
export interface SourceCursor {
  /** ISO timestamp of the last committed row, or null before bootstrap. */
  at: string | null;
  /** Stable id of that row; disambiguates equal timestamps. */
  id: string | null;
}

export interface SourceDescriptor {
  key: string;
  changeSource: ChangeSource;
  entityType: 'PRODUCT' | 'CATEGORY' | 'URL' | 'QUERY' | 'FACT';
  capability: CursorCapability;
  deleteDetection: DeleteDetection;
  /** Why this source has the capability it has — surfaced to operators. */
  note: string;
}

/**
 * The verified capability map. Derived from the live production schema, not
 * from assumption: categories genuinely has no timestamp column.
 */
export const SOURCE_DESCRIPTORS: SourceDescriptor[] = [
  {
    key: 'provider_enrichment', changeSource: 'PROVIDER_CONNECTED', entityType: 'QUERY',
    capability: 'STATE_HASH', deleteDetection: 'NONE',
    note: 'A provider connection that has reached an operational state but whose initial enrichment is not COMPLETE. Derived from durable connection state, so a crash between connecting and emitting cannot lose the requirement.',
  },
  {
    key: 'products', changeSource: 'PRODUCT', entityType: 'PRODUCT',
    capability: 'CURSOR_EXACT', deleteDetection: 'INVENTORY_DIFF',
    note: 'products.updated_at + products.id gives an exact cursor. There is no deleted_at, so removal is only visible by diffing the id inventory.',
  },
  {
    key: 'categories', changeSource: 'CATEGORY', entityType: 'CATEGORY',
    capability: 'STATE_HASH', deleteDetection: 'INVENTORY_DIFF',
    note: 'categories has no updated_at or created_at column, so no cursor is possible. Change is detected by hashing observed row state.',
  },
  {
    key: 'seo_change_ledger', changeSource: 'CONTENT', entityType: 'URL',
    capability: 'CURSOR_EXACT', deleteDetection: 'NONE',
    note: 'The operator SEO change ledger is append-only: occurred_at + id is exact, and entries are never deleted.',
  },
  {
    key: 'gsc_performance', changeSource: 'CATEGORY', entityType: 'CATEGORY',
    capability: 'STATE_HASH', deleteDetection: 'NONE',
    note: 'Observed Search Console demand, digested per attributed entity. gsc_performance has no updated_at, and a per-entity digest is what actually matters: it changes exactly when that entity\'s demand changes, so the affected entity is named directly rather than inferred from query text.',
  },
  {
    key: 'seo_queries', changeSource: 'GSC_QUERY', entityType: 'QUERY',
    capability: 'CURSOR_EXACT', deleteDetection: 'INVENTORY_DIFF',
    note: 'Provider query evidence carries last_observed_at + id. Historical revisions arrive as updates to existing rows.',
  },
];

/** One observed source row, reduced to what change detection needs. */
export interface SourceRow {
  id: string;
  /** Null for STATE_HASH sources, which have no timestamp. */
  at: string | null;
  /** Deterministic digest of the semantically relevant columns. */
  stateHash: string;
  /** True when the row is a tombstone rather than live state. */
  tombstoned?: boolean;
  /**
   * When the source itself says this record describes an earlier period —
   * a provider backfill, a historical import. Used to separate "new current
   * change" from "revision of the past".
   */
  historical?: boolean;
}

export interface SourceStatePorts {
  /** Rows strictly after the cursor, up to and including the upper bound. */
  readSince(descriptor: SourceDescriptor, lower: SourceCursor, upperBound: string): Promise<SourceRow[]>;
  /** Every current row id + state hash, for STATE_HASH and inventory diffing. */
  readInventory(descriptor: SourceDescriptor): Promise<SourceRow[]>;
  /** The state hashes this pipeline last committed, by source key. */
  readKnownState(sourceKey: string): Promise<Map<string, string>>;
  /** The last successfully committed cursor for a source. */
  readCursor(sourceKey: string): Promise<SourceCursor>;
  /** A single monotonic instant used as the upper bound for all sources. */
  now(): Promise<string>;
}

/** A change, carrying the provenance the planner and history both need. */
export interface CanonicalChange extends SourceChange {
  sourceKey: string;
  changeKind: 'CREATED' | 'UPDATED' | 'DELETED' | 'TOMBSTONED' | 'SOURCE_REVISED' | 'PROVIDER_ENRICHED';
  stateHash: string;
  observedAt: string | null;
  /** True when this reflects a revision of the past, not a new current event. */
  historical: boolean;
}

export interface SourceSnapshot {
  /**
   * Identifies the exact source boundary this materialisation reasoned from.
   * Two runs may only be compared for semantic parity if they carry the same
   * id — otherwise a difference proves nothing about the algorithm.
   */
  snapshotId: string;
  upperBound: string;
  /** Per-source lower cursor at capture time. */
  watermarks: Record<string, SourceCursor>;
  changes: CanonicalChange[];
  /** Cursors to commit ONLY after the whole materialisation succeeds. */
  proposedCursors: Record<string, SourceCursor>;
  /** State hashes to commit on success, for STATE_HASH sources. */
  proposedState: Record<string, Map<string, string>>;
  /** Sources whose deletion coverage is not exact, and why. */
  coverageLimits: string[];
  /** True when at least one source needed a full scan. */
  usedFullScan: boolean;
}

const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);

/** Deterministic digest of the columns that carry meaning for SEO. */
export function stateHashOf(fields: Record<string, unknown>): string {
  // Stable key ordering: a JS object's insertion order must not change the
  // hash, or every run would look like a change.
  const ordered = Object.keys(fields).sort().map((k) => [k, fields[k] ?? null]);
  return digest(ordered);
}

/** Strictly-after comparison on (at, id). Equal timestamps fall back to id. */
export function isAfter(row: SourceRow, cursor: SourceCursor): boolean {
  if (cursor.at === null) return true;          // bootstrap: everything is new
  if (row.at === null) return true;             // no timestamp: hashing decides
  if (row.at > cursor.at) return true;
  if (row.at < cursor.at) return false;
  // Same instant: the stable id is the tie-breaker, so no row is skipped.
  return cursor.id === null ? true : row.id > cursor.id;
}

/**
 * Resolve everything that changed since the last committed cursor.
 *
 * The upper bound is captured ONCE and applied to every source, so the
 * resulting snapshot describes a single coherent boundary rather than a smear
 * of per-source read times.
 */
export async function resolveSourceChanges(
  ports: SourceStatePorts,
  descriptors: SourceDescriptor[] = SOURCE_DESCRIPTORS,
): Promise<SourceSnapshot> {
  const upperBound = await ports.now();
  const watermarks: Record<string, SourceCursor> = {};
  const proposedCursors: Record<string, SourceCursor> = {};
  const proposedState: Record<string, Map<string, string>> = {};
  const coverageLimits: string[] = [];
  const changes: CanonicalChange[] = [];
  let usedFullScan = false;

  for (const d of descriptors) {
    const lower = await ports.readCursor(d.key);
    watermarks[d.key] = lower;

    if (d.capability === 'CURSOR_EXACT') {
      const rows = (await ports.readSince(d, lower, upperBound)).filter((r) => isAfter(r, lower));
      const known = await ports.readKnownState(d.key);

      for (const row of rows) {
        const prior = known.get(row.id);
        const kind: CanonicalChange['changeKind'] =
          row.tombstoned ? 'TOMBSTONED'
          : prior === undefined ? 'CREATED'
          // A historical row that we already knew about is a revision of the
          // past, not a new current event. Conflating them would turn a
          // provider backfill into a fresh SEO incident.
          : row.historical ? 'SOURCE_REVISED'
          : 'UPDATED';

        if (prior !== undefined && prior === row.stateHash && !row.tombstoned) continue;

        changes.push({
          sourceKey: d.key, source: d.changeSource, entityId: row.id,
          changeType: kind, changeKind: kind, stateHash: row.stateHash,
          observedAt: row.at, historical: Boolean(row.historical),
          changeVersion: `${row.at ?? ''}|${row.id}`,
        });
      }

      // Advance only to the last row actually processed — never to the upper
      // bound, which would silently claim rows we never read.
      const last = rows.length > 0 ? rows[rows.length - 1] : null;
      proposedCursors[d.key] = last ? { at: last.at, id: last.id } : lower;
      proposedState[d.key] = new Map([
        ...(await ports.readKnownState(d.key)),
        ...rows.map((r) => [r.id, r.stateHash] as [string, string]),
      ]);
    } else {
      // STATE_HASH / FULL_ONLY: no cursor exists, so correctness comes from
      // comparing the full observed state against what we last committed.
      usedFullScan = true;
      const rows = await ports.readInventory(d);
      const known = await ports.readKnownState(d.key);
      const seen = new Set<string>();

      for (const row of rows) {
        seen.add(row.id);
        const prior = known.get(row.id);
        // Matching hash means this revision has already been fully processed
        // and committed. For provider enrichment that is precisely the
        // idempotency guarantee: the same connection revision never enriches
        // twice, and a run that failed never committed, so it retries.
        if (prior === row.stateHash) continue;
        const kind: CanonicalChange['changeKind'] =
          d.changeSource === 'PROVIDER_CONNECTED' ? 'PROVIDER_ENRICHED'
          : prior === undefined ? 'CREATED'
          : 'UPDATED';
        changes.push({
          sourceKey: d.key, source: d.changeSource, entityId: row.id,
          changeType: kind, changeKind: kind,
          stateHash: row.stateHash, observedAt: row.at,
          historical: Boolean(row.historical), changeVersion: row.stateHash,
        });
      }

      // Inventory diff: anything we knew about that is no longer present has
      // been deleted. This is the only deletion evidence these sources have.
      //
      // Skipped where deletion is genuinely undetectable. A provider going
      // away is a DISCONNECT, not a deletion: the evidence it already
      // contributed stays, ages under the freshness policy, and must never be
      // rewritten to zero.
      if (d.deleteDetection !== 'NONE') {
        for (const [id] of known) {
          if (seen.has(id)) continue;
          changes.push({
            sourceKey: d.key, source: d.changeSource, entityId: id,
            changeType: 'DELETED', changeKind: 'DELETED', stateHash: '',
            observedAt: null, historical: false, changeVersion: 'deleted',
          });
        }
      }

      proposedCursors[d.key] = lower;
      proposedState[d.key] = d.deleteDetection === 'NONE'
        // The inventory here lists outstanding work, not the whole world, so
        // previously-completed revisions must be carried forward rather than
        // pruned — otherwise every completed enrichment would look new again.
        ? new Map([...known, ...rows.map((r) => [r.id, r.stateHash] as [string, string])])
        : new Map(rows.map((r) => [r.id, r.stateHash]));
    }

    if (d.deleteDetection !== 'TOMBSTONE') {
      coverageLimits.push(`${d.key}: deletion detected by ${d.deleteDetection} — ${d.note}`);
    }
  }

  // The snapshot id is derived from the boundary itself, so the same boundary
  // always produces the same id and a parity comparison can prove it read the
  // same source truth.
  const snapshotId = digest({ upperBound, watermarks });

  return {
    snapshotId, upperBound, watermarks, changes,
    proposedCursors, proposedState, coverageLimits, usedFullScan,
  };
}

/**
 * For CURSOR_EXACT sources whose deletion is INVENTORY_DIFF, a cursor scan can
 * never see a removal. This closes that hole on a bounded cadence rather than
 * pretending the cursor was sufficient.
 *
 * Correctness is eventual here, and saying so plainly is the point: the
 * alternative is derived intelligence that outlives the product it describes.
 */
export async function reconcileInventory(
  ports: SourceStatePorts,
  descriptor: SourceDescriptor,
): Promise<CanonicalChange[]> {
  if (descriptor.deleteDetection === 'NONE') return [];
  const rows = await ports.readInventory(descriptor);
  const known = await ports.readKnownState(descriptor.key);
  const present = new Set(rows.map((r) => r.id));

  return [...known.keys()]
    .filter((id) => !present.has(id))
    .map((id) => ({
      sourceKey: descriptor.key, source: descriptor.changeSource, entityId: id,
      changeType: 'DELETED', changeKind: 'DELETED' as const, stateHash: '',
      observedAt: null, historical: false, changeVersion: 'inventory-diff',
    }));
}
