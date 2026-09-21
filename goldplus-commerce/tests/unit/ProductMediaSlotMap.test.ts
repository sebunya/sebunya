import { describe, expect, it } from 'vitest';
import { applySlotAction, completeness, orderedAssignments, slotMapsEqual, validateSlotMap, type SlotMap } from '../../apps/api/src/domain/media/ProductMediaSlotMap';

const A = 'a1a1a1a1-0000-4000-8000-000000000001';
const B = 'b2b2b2b2-0000-4000-8000-000000000002';
const C = 'c3c3c3c3-0000-4000-8000-000000000003';
const D = 'd4d4d4d4-0000-4000-8000-000000000004';
const E = 'e5e5e5e5-0000-4000-8000-000000000005';

const full: SlotMap = [
  { slot: 1, assetId: A, altText: null },
  { slot: 2, assetId: B, altText: null },
  { slot: 3, assetId: C, altText: null },
  { slot: 4, assetId: D, altText: null },
];
const ready = new Set([A, B, C, D, E]);

function ok(result: ReturnType<typeof applySlotAction>) {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

describe('validateSlotMap — the constraints the brief lists', () => {
  it('accepts a legal sparse map and sorts it by slot', () => {
    const r = validateSlotMap([{ slot: 4, assetId: D, altText: ' x ' }, { slot: 1, assetId: A, altText: null }], ready);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.map.map((a) => a.slot)).toEqual([1, 4]);
    if (r.ok) expect(r.map[1].altText).toBe('x');
  });
  it('rejects slot 0 and slot 5', () => {
    expect(validateSlotMap([{ slot: 0 as never, assetId: A, altText: null }], ready)).toMatchObject({ ok: false, code: 'INVALID_SLOT' });
    expect(validateSlotMap([{ slot: 5 as never, assetId: A, altText: null }], ready)).toMatchObject({ ok: false, code: 'INVALID_SLOT' });
  });
  it('rejects a duplicate slot and a duplicate asset in one gallery', () => {
    expect(validateSlotMap([{ slot: 1, assetId: A, altText: null }, { slot: 1, assetId: B, altText: null }], ready)).toMatchObject({ ok: false, code: 'DUPLICATE_SLOT' });
    expect(validateSlotMap([{ slot: 1, assetId: A, altText: null }, { slot: 2, assetId: A, altText: null }], ready)).toMatchObject({ ok: false, code: 'DUPLICATE_ASSET' });
  });
  it('rejects an asset that is not ready (unauthorised, archived, no rendition)', () => {
    expect(validateSlotMap([{ slot: 1, assetId: 'not-in-library', altText: null }], ready)).toMatchObject({ ok: false, code: 'ASSET_NOT_READY' });
  });
  it('strips control characters and caps alt text', () => {
    const r = validateSlotMap([{ slot: 1, assetId: A, altText: 'front\u0000 of\n pack' + 'x'.repeat(300) }], ready);
    if (!r.ok) throw new Error(r.code);
    expect(r.map[0].altText).not.toMatch(/[\u0000\n]/);
    expect(r.map[0].altText!.length).toBe(255);
  });
});

describe('applySlotAction — exact admin mutation semantics', () => {
  it('SET_COVER swaps the chosen slot with slot 1: [A,B,C,D] choosing C → [C,B,A,D]', () => {
    const r = ok(applySlotAction(full, { type: 'SET_COVER', assetId: C }));
    expect(r.map.map((a) => a.assetId)).toEqual([C, B, A, D]);
    expect(r.coverChanged).toBe(true);
  });
  it('SET_COVER with slot 1 absent moves the chosen image into slot 1 and leaves its old slot empty', () => {
    const draft: SlotMap = [{ slot: 2, assetId: B, altText: null }, { slot: 3, assetId: C, altText: null }];
    const r = ok(applySlotAction(draft, { type: 'SET_COVER', assetId: C }));
    expect(r.map).toEqual([{ slot: 1, assetId: C, altText: null }, { slot: 2, assetId: B, altText: null }]);
  });
  it('SET_COVER refuses an asset that is not in the gallery, and is a no-op on the cover itself', () => {
    expect(applySlotAction(full, { type: 'SET_COVER', assetId: E })).toMatchObject({ ok: false, code: 'ASSET_NOT_IN_GALLERY' });
    expect(applySlotAction(full, { type: 'SET_COVER', assetId: A })).toMatchObject({ ok: false, code: 'NOTHING_TO_DO' });
  });
  it('REPLACE changes only the selected slot', () => {
    const r = ok(applySlotAction(full, { type: 'REPLACE', slot: 3, assetId: E }));
    expect(r.map.map((a) => a.assetId)).toEqual([A, B, E, D]);
    expect(r.coverChanged).toBe(false);
  });
  it('REPLACE refuses an empty slot and an asset already elsewhere', () => {
    expect(applySlotAction([{ slot: 1, assetId: A, altText: null }], { type: 'REPLACE', slot: 2, assetId: B })).toMatchObject({ ok: false, code: 'SLOT_EMPTY' });
    expect(applySlotAction(full, { type: 'REPLACE', slot: 3, assetId: B })).toMatchObject({ ok: false, code: 'DUPLICATE_ASSET' });
  });
  it('REMOVE of a secondary clears only that slot and never compacts', () => {
    const r = ok(applySlotAction(full, { type: 'REMOVE', slot: 2 }));
    expect(r.map.map((a) => a.slot)).toEqual([1, 3, 4]);
    expect(r.map.map((a) => a.assetId)).toEqual([A, C, D]);
  });
  it('REMOVE of the cover requires an atomic replacement and never silently promotes', () => {
    expect(applySlotAction(full, { type: 'REMOVE', slot: 1 })).toMatchObject({ ok: false, code: 'COVER_REQUIRES_REPLACEMENT' });
    const r = ok(applySlotAction(full, { type: 'REMOVE', slot: 1, replacementAssetId: E }));
    expect(r.map.map((a) => a.assetId)).toEqual([E, B, C, D]);
    expect(applySlotAction(full, { type: 'REMOVE', slot: 1, replacementAssetId: B })).toMatchObject({ ok: false, code: 'DUPLICATE_ASSET' });
  });
  it('clearing the last cover is allowed only through the explicit draft flag', () => {
    const solo: SlotMap = [{ slot: 1, assetId: A, altText: null }];
    expect(applySlotAction(solo, { type: 'REMOVE', slot: 1 })).toMatchObject({ ok: false, code: 'COVER_REQUIRES_REPLACEMENT' });
    expect(ok(applySlotAction(solo, { type: 'REMOVE', slot: 1, allowClearLastCover: true })).map).toEqual([]);
  });
  it('MOVE swaps when the target is occupied and moves when it is empty; crossing slot 1 reports a cover change', () => {
    const swap = ok(applySlotAction(full, { type: 'MOVE', from: 4, to: 2 }));
    expect(swap.map.map((a) => a.assetId)).toEqual([A, D, C, B]);
    expect(swap.coverChanged).toBe(false);
    const sparse: SlotMap = [{ slot: 1, assetId: A, altText: null }, { slot: 3, assetId: C, altText: null }];
    const move = ok(applySlotAction(sparse, { type: 'MOVE', from: 3, to: 4 }));
    expect(move.map.map((a) => a.slot)).toEqual([1, 4]);
    const cross = ok(applySlotAction(full, { type: 'MOVE', from: 3, to: 1 }));
    expect(cross.coverChanged).toBe(true);
    expect(cross.map.map((a) => a.assetId)).toEqual([C, B, A, D]);
  });
  it('ASSIGN fills an empty slot and refuses an occupied one or a duplicate asset', () => {
    const sparse: SlotMap = [{ slot: 1, assetId: A, altText: null }];
    expect(ok(applySlotAction(sparse, { type: 'ASSIGN', slot: 3, assetId: C })).map.map((a) => a.slot)).toEqual([1, 3]);
    expect(applySlotAction(sparse, { type: 'ASSIGN', slot: 1, assetId: C })).toMatchObject({ ok: false, code: 'SLOT_OCCUPIED' });
    expect(applySlotAction(sparse, { type: 'ASSIGN', slot: 2, assetId: A })).toMatchObject({ ok: false, code: 'DUPLICATE_ASSET' });
  });
  it('RESTORE proposes the recorded map verbatim (undo is a new write, validated by the caller)', () => {
    const r = ok(applySlotAction([{ slot: 1, assetId: E, altText: null }], { type: 'RESTORE', map: full }));
    expect(slotMapsEqual(r.map, full)).toBe(true);
    expect(r.coverChanged).toBe(true);
  });
});

describe('ordering and completeness', () => {
  it('customer ordinal is the position in the available list, not the slot: slots 1 and 4 → 1/2, 2/2', () => {
    const sparse: SlotMap = [{ slot: 4, assetId: D, altText: null }, { slot: 1, assetId: A, altText: null }];
    const ordered = orderedAssignments(sparse);
    expect(ordered.map((a) => a.slot)).toEqual([1, 4]);
    expect(ordered.findIndex((a) => a.slot === 4) + 1).toBe(2);
  });
  it('completeness counts assignments and reports a missing cover separately', () => {
    expect(completeness(full)).toEqual({ assigned: 4, label: '4/4', hasCover: true });
    expect(completeness([{ slot: 2, assetId: B, altText: null }])).toEqual({ assigned: 1, label: '1/4', hasCover: false });
    expect(completeness([])).toEqual({ assigned: 0, label: '0/4', hasCover: false });
  });
});
