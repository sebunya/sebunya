/**
 * What the ambassadors section needs from the media library: resolve a chosen
 * photo (by the address the editor holds) to its asset and renditions, and keep
 * the usage graph true so a portrait on the live home page can never be deleted
 * from the library out from under it.
 */
export interface ResolvedPortrait {
  assetId: string;
  original: { url: string; width: number | null; height: number | null };
  variants: Array<{ purpose: string; format: string; width: number | null; height: number | null; url: string }>;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface IAmbassadorMedia {
  /** The asset whose original OR one of whose renditions has this address; null if the library has no such image. */
  resolveByUrl(url: string): Promise<ResolvedPortrait | null>;
  /**
   * Records these usages (adds only; never removes). Called BEFORE the section is
   * written, so a new portrait is protected from deletion the moment it can go live.
   */
  protect(current: Array<{ personId: string; assetId: string }>): Promise<void>;
  /** Makes the recorded usages exactly `current` (person id → asset id), removing stale ones. */
  syncUsages(current: Array<{ personId: string; assetId: string }>): Promise<void>;
}
