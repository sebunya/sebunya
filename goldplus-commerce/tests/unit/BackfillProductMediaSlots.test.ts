import { describe, expect, it } from 'vitest';
import { planBackfill, type BackfillRow } from '../../apps/api/src/domain/media/ProductMediaBackfill';

const row = (over: Partial<BackfillRow>): BackfillRow => ({ imageId: 'img', assetId: 'asset', slot: null, isPrimary: false, displayOrder: 0, altText: null, assetReady: true, ...over });
const fresh = { mediaRevision: 0 };

describe('planBackfill — migration cases the brief lists', () => {
  it('empty: nothing to do', () => {
    expect(planBackfill(fresh, [])).toEqual({ kind: 'SKIP_NO_ROWS' });
  });
  it('legacy: the flagged primary with a ready asset becomes slot 1 and ONLY slot 1', () => {
    const d = planBackfill(fresh, [row({ imageId: 'a', assetId: 'A', isPrimary: true, altText: 'front' }), row({ imageId: 'b', assetId: 'B', displayOrder: 1 })]);
    expect(d).toEqual({ kind: 'ASSIGN_COVER', sourceImageId: 'a', map: [{ slot: 1, assetId: 'A', altText: 'front' }] });
  });
  it('legacy without a primary flag: lowest display_order leads (the historical order)', () => {
    const d = planBackfill(fresh, [row({ imageId: 'b', assetId: 'B', displayOrder: 2 }), row({ imageId: 'a', assetId: 'A', displayOrder: 1 })]);
    expect(d).toMatchObject({ kind: 'ASSIGN_COVER', sourceImageId: 'a' });
  });
  it('partially migrated / rerun: any slotted row or a non-zero revision means hands off', () => {
    expect(planBackfill({ mediaRevision: 3 }, [row({ isPrimary: true })])).toMatchObject({ kind: 'SKIP_ALREADY_MIGRATED' });
    expect(planBackfill(fresh, [row({ slot: 1 })])).toMatchObject({ kind: 'SKIP_ALREADY_MIGRATED' });
  });
  it('concurrent operator edit: a revision bumped since the scan is a skip, never an overwrite (the use case enforces it; the planner refuses up front)', () => {
    expect(planBackfill({ mediaRevision: 1 }, [row({ isPrimary: true })])).toMatchObject({ kind: 'SKIP_ALREADY_MIGRATED' });
  });
  it('broken legacy: URL-only primary, unready asset, two primaries are conflicts, not guesses', () => {
    expect(planBackfill(fresh, [row({ assetId: null, isPrimary: true })])).toMatchObject({ kind: 'CONFLICT', code: 'LEGACY_URL_ONLY' });
    expect(planBackfill(fresh, [row({ isPrimary: true, assetReady: false })])).toMatchObject({ kind: 'CONFLICT', code: 'NO_READY_ASSET' });
    expect(planBackfill(fresh, [row({ imageId: 'a', isPrimary: true }), row({ imageId: 'b', assetId: 'B', isPrimary: true })])).toMatchObject({ kind: 'CONFLICT', code: 'MULTIPLE_PRIMARIES' });
  });
});
