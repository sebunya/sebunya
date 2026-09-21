import { describe, expect, it } from 'vitest';
import { activeMedia, canGoNext, canGoPrev, createGalleryState, ordinalOf, previews, reduce, type GalleryMedia, type GalleryState } from '../../apps/web/src/lib/productGalleryState';

const m = (id: string): GalleryMedia => ({ id, src: `/u/${id}/pdp.webp`, srcset: null, thumb: `/u/${id}/thumb.webp`, alt: id, width: 1024, height: 1024 });
const A = m('A'), B = m('B'), C = m('C'), D = m('D');

function run(state: GalleryState, ...intents: Parameters<typeof reduce>[1][]) {
  const effects: ReturnType<typeof reduce>[1][] = [];
  for (const i of intents) { const [s, e] = reduce(state, i); state = s; effects.push(e); }
  return { state, effects };
}

describe('gallery state — composition', () => {
  it('four assets: one active, exactly three previews in canonical order; ordinal is list position', () => {
    const s = createGalleryState([A, B, C, D]);
    expect(activeMedia(s)?.id).toBe('A');
    expect(previews(s).map((x) => x.id)).toEqual(['B', 'C', 'D']);
    const { state } = run(s, { type: 'SELECT', id: 'C' }, { type: 'LOADED', id: 'C', generation: 1 });
    expect(previews(state).map((x) => x.id)).toEqual(['A', 'B', 'D']);
    expect(ordinalOf(state, 'C')).toBe(3);
  });
  it('one image: no previews, both arrows disabled', () => {
    const s = createGalleryState([A]);
    expect(previews(s)).toEqual([]);
    expect(canGoPrev(s)).toBe(false);
    expect(canGoNext(s)).toBe(false);
  });
  it('finite navigation: no wrap at either end', () => {
    const s = createGalleryState([A, B]);
    expect(reduce(s, { type: 'PREV' })[1]).toEqual({});
    const { state } = run(s, { type: 'NEXT' }, { type: 'LOADED', id: 'B', generation: 1 });
    expect(canGoNext(state)).toBe(false);
    expect(reduce(state, { type: 'NEXT' })[1]).toEqual({});
  });
});

describe('gallery state — loading races (the brief\'s required intent tests)', () => {
  it('A displayed → B pending → A requested ends on A; a late B response must not commit', () => {
    const s = createGalleryState([A, B, C]);
    const { state, effects } = run(s, { type: 'SELECT', id: 'B' }, { type: 'SELECT', id: 'A' });
    expect(effects[0].load).toEqual({ id: 'B', generation: 1 });
    expect(state.pending).toBeNull();
    const [after] = reduce(state, { type: 'LOADED', id: 'B', generation: 1 });
    expect(after.activeId).toBe('A');
  });
  it('A → B pending → C pending → B fails: still ends on C', () => {
    const s = createGalleryState([A, B, C]);
    const { state } = run(s, { type: 'SELECT', id: 'B' }, { type: 'SELECT', id: 'C' }, { type: 'FAILED', id: 'B', generation: 1 }, { type: 'LOADED', id: 'C', generation: 2 });
    expect(state.activeId).toBe('C');
    expect(state.failedLarge.has('B')).toBe(false);
  });
  it('slow B then fast C ends on C (a slow earlier response never replaces a later selection)', () => {
    const s = createGalleryState([A, B, C]);
    const { state } = run(s, { type: 'SELECT', id: 'B' }, { type: 'SELECT', id: 'C' }, { type: 'LOADED', id: 'C', generation: 2 }, { type: 'LOADED', id: 'B', generation: 1 });
    expect(state.activeId).toBe('C');
  });
  it('failed C retains the prior image, keeps C in the list and offers retry', () => {
    const s = createGalleryState([A, B, C]);
    const { state } = run(s, { type: 'SELECT', id: 'C' }, { type: 'FAILED', id: 'C', generation: 1 });
    expect(state.activeId).toBe('A');
    expect(state.available).toHaveLength(3);
    expect(state.failedLarge.has('C')).toBe(true);
    const [retried, effect] = reduce(state, { type: 'RETRY' });
    expect(effect.load).toEqual({ id: 'C', generation: 2 });
    expect(retried.pending?.id).toBe('C');
  });
  it('requesting the displayed image is a no-op only when nothing is pending', () => {
    const s = createGalleryState([A, B]);
    expect(reduce(s, { type: 'SELECT', id: 'A' })[1]).toEqual({});
    const { state } = run(s, { type: 'SELECT', id: 'B' }, { type: 'SELECT', id: 'A' });
    expect(state.pending).toBeNull();
  });
  it('rapid arrows step from the latest requested target, not the displayed one', () => {
    const s = createGalleryState([A, B, C, D]);
    const { state, effects } = run(s, { type: 'NEXT' }, { type: 'NEXT' });
    expect(effects[1].load?.id).toBe('C');
    expect(state.pending?.id).toBe('C');
  });
  it('RESET after a product change discards a pending commit', () => {
    const s = createGalleryState([A, B]);
    const { state } = run(s, { type: 'SELECT', id: 'B' }, { type: 'RESET', available: [C, D], activeId: 'C' }, { type: 'LOADED', id: 'B', generation: 1 });
    expect(state.activeId).toBe('C');
  });
});

describe('gallery state — failure separation and authoritative removal', () => {
  it('a failed thumbnail does not block selecting its healthy full image', () => {
    const s = createGalleryState([A, B]);
    const { state, effects } = run(s, { type: 'THUMB_FAILED', id: 'B' }, { type: 'SELECT', id: 'B' }, { type: 'LOADED', id: 'B', generation: 1 });
    expect(state.failedThumb.has('B')).toBe(true);
    expect(effects[1].load?.id).toBe('B');
    expect(state.activeId).toBe('B');
  });
  it('a failed cover does not block inspecting a healthy secondary, and never changes what is available', () => {
    const s = createGalleryState([A, B]);
    const { state } = run(s, { type: 'SELECT', id: 'B' }, { type: 'LOADED', id: 'B', generation: 1 }, { type: 'SELECT', id: 'A' }, { type: 'FAILED', id: 'A', generation: 2 });
    expect(state.activeId).toBe('B');
    expect(state.available.map((x) => x.id)).toEqual(['A', 'B']);
  });
  it('only authoritative unavailability removes an item and reports the new count once', () => {
    const s = createGalleryState([A, B, C]);
    const [after, effect] = reduce(s, { type: 'REMOVE_UNAVAILABLE', id: 'B' });
    expect(after.available.map((x) => x.id)).toEqual(['A', 'C']);
    expect(effect.countChanged).toBe(2);
    expect(reduce(after, { type: 'REMOVE_UNAVAILABLE', id: 'B' })[1]).toEqual({});
  });
  it('a successful user commit sets exactly one announcement', () => {
    const s = createGalleryState([A, B]);
    const { state, effects } = run(s, { type: 'SELECT', id: 'B' }, { type: 'LOADED', id: 'B', generation: 1 });
    expect(state.announcement).toBe('Image 2 of 2');
    expect(effects[1].committed).toEqual({ id: 'B', ordinal: 2, count: 2 });
    expect(createGalleryState([A, B]).announcement).toBeNull();
  });
});
