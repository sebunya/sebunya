/**
 * A product that is not for sale right now but once was: enough to tell a
 * visitor on an old link what it was and where its range lives, nothing
 * else (no price, no stock, no images). A product that was never published
 * is not reported, so a draft import stays private.
 */
export interface UnlistedProductNotice {
  name: string;
  categorySlug: string | null;
  categoryName: string | null;
}

export interface IUnlistedProductReader {
  findUnlistedBySlug(slug: string): Promise<UnlistedProductNotice | null>;
}
