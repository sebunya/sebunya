import { describe, expect, it } from 'vitest';
import { galleryOrdinal, resolveGallery } from '../../packages/shared/src/media/resolveGallery';

const row = (slot: number | null, isPrimary: boolean, displayOrder: number, id: string) => ({ slot, isPrimary, displayOrder, id });

describe('resolveGallery — one cover authority', () => {
  it('a migrated product: slot order, cover = slot 1, legacy rows without a slot are hidden', () => {
    const rows = [row(3, false, 9, 'c'), row(1, false, 5, 'a'), row(null, true, 0, 'legacy'), row(4, false, 1, 'd')];
    const r = resolveGallery(rows);
    expect(r.migrated).toBe(true);
    expect(r.cover?.id).toBe('a');
    expect(r.ordered.map((x) => x.id)).toEqual(['a', 'c', 'd']);
    expect(r.missingCover).toBe(false);
  });
  it('slot 1 is the cover even when a legacy is_primary flag disagrees', () => {
    const r = resolveGallery([row(2, true, 0, 'flagged'), row(1, false, 1, 'slotted')]);
    expect(r.cover?.id).toBe('slotted');
  });
  it('slots without a slot 1 report a missing cover and never promote another image', () => {
    const r = resolveGallery([row(2, false, 0, 'b'), row(3, false, 1, 'c')]);
    expect(r.cover).toBeNull();
    expect(r.missingCover).toBe(true);
    expect(r.ordered.map((x) => x.id)).toEqual(['b', 'c']);
  });
  it('an unmigrated product falls back to is_primary DESC, display_order ASC and says so', () => {
    const r = resolveGallery([row(null, false, 0, 'first'), row(null, true, 3, 'primary'), row(null, false, 1, 'second')]);
    expect(r.migrated).toBe(false);
    expect(r.cover?.id).toBe('primary');
    expect(r.ordered.map((x) => x.id)).toEqual(['primary', 'first', 'second']);
  });
  it('no rows: no cover, no fallback claims', () => {
    expect(resolveGallery([])).toEqual({ cover: null, ordered: [], migrated: false, missingCover: false });
  });
  it('ordinal is the 1-based position in the available list: slots 1 and 4 give 1/2 and 2/2', () => {
    const rows = [row(4, false, 0, 'd'), row(1, false, 0, 'a')];
    const r = resolveGallery(rows);
    expect(galleryOrdinal(r.ordered, rows[0])).toBe(2);
    expect(galleryOrdinal(r.ordered, rows[1])).toBe(1);
  });
});
