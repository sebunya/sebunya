/** Paid orders by place (0193): which products customers in an area, a district or Greater Kampala actually bought. */
export type NearbyScope = { kind: 'area'; areaSlug: string } | { kind: 'district'; district: string } | { kind: 'districts'; districts: readonly string[] };

export interface INearbyDemandReader {
  /** Products bought by at least `minBuyers` different customers in the scope, most buyers first. */
  topProducts(scope: NearbyScope, input: { sinceDays: number; minBuyers: number; limit: number }): Promise<Array<{ productId: string; buyers: number }>>;
}
