export type GallerySlot = 1 | 2 | 3 | 4;

const isSlot = (n: unknown): n is GallerySlot => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 4;

/**
 * Proposed slot for each uploaded file, in file order. A file with a legal explicit slot keeps it; every other file
 * takes the next EMPTY slot that no explicit file has claimed. Indexing the free list by the file's position in the
 * whole batch gave an unslotted file a slot another file had asked for (DUPLICATE_SLOT although a slot was empty), or
 * ran off the end of the list (INVALID_SLOT). Returns null for a file left without a slot; the caller refuses it.
 */
export function proposeUploadSlots(fileCount: number, requested: readonly unknown[], taken: ReadonlySet<number>): Array<GallerySlot | null> {
  const explicit = Array.from({ length: fileCount }, (_, i) => (isSlot(requested[i]) ? requested[i] : null));
  const claimed = new Set<number>(explicit.filter((s): s is GallerySlot => s !== null));
  const free = ([1, 2, 3, 4] as const).filter((s) => !taken.has(s) && !claimed.has(s));
  let next = 0;
  return explicit.map((s) => s ?? free[next++] ?? null);
}
