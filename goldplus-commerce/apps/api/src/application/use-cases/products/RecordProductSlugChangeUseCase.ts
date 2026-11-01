/**
 * U6 (AC6) — when an admin edit changes a product's slug, record a 301 from the
 * old public URL to the new one so inbound links and search results keep
 * resolving. Pure application logic over a narrow repository port; the route
 * stays thin and the SEO repository stays the only writer of redirects.
 */
export interface SlugChangeRecorder {
  recordSlugChange(input: { oldSlug: string; newSlug: string; createdBy: string | null; now: Date }): Promise<{ fromPath: string; toPath: string }>;
}

export class RecordProductSlugChangeUseCase {
  constructor(private readonly seoRepo: SlugChangeRecorder) {}

  /**
   * Returns the recorded redirect, or null when the slug did not actually
   * change (no-op edits must not create self-redirects).
   */
  async execute(input: { oldSlug: string; newSlug: string; actorId: string | null; now?: Date }): Promise<{ fromPath: string; toPath: string } | null> {
    const oldSlug = input.oldSlug.trim().toLowerCase();
    const newSlug = input.newSlug.trim().toLowerCase();
    if (!oldSlug || !newSlug || oldSlug === newSlug) return null;
    return this.seoRepo.recordSlugChange({ oldSlug, newSlug, createdBy: input.actorId, now: input.now ?? new Date() });
  }
}
