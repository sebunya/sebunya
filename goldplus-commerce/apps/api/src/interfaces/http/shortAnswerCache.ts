/**
 * A short-lived, bounded answer cache with in-flight sharing. Used in front of the
 * public PesaPal return-state lookup: every call ran a provider status round-trip
 * and a settlement transaction, so a polling page or a looping script burnt
 * provider quota and DB time. Repeats within the TTL (and concurrent repeats)
 * now share one answer.
 */
export class ShortAnswerCache<T> {
  private readonly entries = new Map<string, { at: number; value: Promise<T> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string, compute: () => Promise<T>): Promise<T> {
    const t = this.now();
    const hit = this.entries.get(key);
    if (hit && t - hit.at < this.ttlMs) return hit.value;
    if (hit) this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    const value = compute();
    this.entries.set(key, { at: t, value });
    // A failure is not remembered: the next caller tries again.
    value.catch(() => { if (this.entries.get(key)?.value === value) this.entries.delete(key); });
    return value;
  }
}
