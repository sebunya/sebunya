import { foldUgandanOrthography } from '@goldplus/shared';
import {
  AreaSearchHit,
  CustomerLocationContext,
  ILocationOrderDensityReader,
  ILocationSearchRepository,
  LocationSearchHit,
  PickupPointSearchHit,
} from '../../ports/ILocationSearch';

/**
 * The PART F search pipeline. Match layers in F.1 order, union, dedupe by
 * area (best provenance wins), rank by F.3, cap at 8. Every result carries its
 * match_type so the UI can render provenance and measurement can see which
 * layer does the work.
 *
 * Ranking (F.3):
 *  1. customer's saved-address areas
 *  2. areas the customer ordered to before
 *  3. delivery zone order Z1 → Z4 (unzoned last)
 *  4. order density (historical orders per area)
 *  5. match quality: exact > prefix > trigram score
 *  6. alphabetical tie-break
 */
export const LOCATION_SEARCH_RESULT_CAP = 8;
export const TRIGRAM_THRESHOLD = 0.35;

const MATCH_QUALITY: Record<string, number> = {
  alias_exact: 3,
  area_exact: 3,
  group_exact: 3,
  landmark: 2.5,
  prefix: 2,
  trigram: 1,
  pickup_point: 2,
};

const ZONE_ORDER: Record<string, number> = { Z1: 1, Z2: 2, Z3: 3, Z4: 4 };

export interface RankedLocationResult {
  hits: LocationSearchHit[];
  /** true when nothing matched at any layer — callers log a search miss */
  zeroResult: boolean;
}

export class LocationSearchService {
  constructor(
    private readonly repo: ILocationSearchRepository,
    private readonly density: ILocationOrderDensityReader,
  ) {}

  async search(rawQuery: string, ctx?: CustomerLocationContext): Promise<RankedLocationResult> {
    const folded = foldUgandanOrthography(rawQuery);
    if (folded.length < 2) return { hits: [], zeroResult: false };

    const [aliasExact, areaExact, groupExact, prefix, trigram, landmark, pickups, densityMap] =
      await Promise.all([
        this.repo.aliasExact(folded),
        this.repo.areaExact(folded),
        this.repo.groupExact(folded),
        this.repo.prefix(folded, LOCATION_SEARCH_RESULT_CAP * 3),
        this.repo.trigram(folded, TRIGRAM_THRESHOLD, LOCATION_SEARCH_RESULT_CAP * 3),
        this.repo.landmark(folded, LOCATION_SEARCH_RESULT_CAP),
        this.repo.pickupPoints(folded, LOCATION_SEARCH_RESULT_CAP),
        this.density.densityByArea(),
      ]);

    // Union in F.1 layer order; first (best) provenance per area wins. A group
    // hit REPLACES its member fragments: "nsambya" is one entry, not four.
    const byArea = new Map<string, AreaSearchHit>();
    const groupedAreas = new Set<string>();
    for (const g of groupExact) {
      if (g.groupId) groupedAreas.add(g.areaSlug);
    }
    const take = (hits: AreaSearchHit[]) => {
      for (const h of hits) {
        const key = h.groupId ? `group:${h.groupId}` : h.areaSlug;
        if (h.groupId === undefined && this.isGroupMemberShadowed(h, byArea)) continue;
        if (!byArea.has(key)) byArea.set(key, h);
      }
    };
    take(aliasExact);
    take(areaExact);
    take(groupExact);
    take(prefix);
    take(trigram);
    take(landmark);

    const areas = [...byArea.values()];
    const saved = ctx?.savedAreaSlugs ?? new Set<string>();
    const ordered = ctx?.orderedAreaSlugs ?? new Set<string>();

    const rankKey = (h: AreaSearchHit): number[] => [
      saved.has(h.areaSlug) ? 0 : 1,
      ordered.has(h.areaSlug) ? 0 : 1,
      ZONE_ORDER[h.deliveryZoneCode ?? ''] ?? 9,
      -(densityMap.get(h.areaSlug) ?? 0),
      -(MATCH_QUALITY[h.matchType] ?? 0),
      -h.score,
    ];
    areas.sort((a, b) => {
      const ka = rankKey(a);
      const kb = rankKey(b);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return ka[i] - kb[i];
      }
      return a.displayLabel.localeCompare(b.displayLabel);
    });

    const rankedPickups: PickupPointSearchHit[] = [...pickups].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    const hits: LocationSearchHit[] = [...areas, ...rankedPickups].slice(0, LOCATION_SEARCH_RESULT_CAP);
    return { hits, zeroResult: hits.length === 0 };
  }

  /** A bare area hit is shadowed when a group covering it already matched. */
  private isGroupMemberShadowed(h: AreaSearchHit, byArea: Map<string, AreaSearchHit>): boolean {
    for (const existing of byArea.values()) {
      if (existing.groupId && existing.groupName && h.areaSlug !== existing.areaSlug) {
        // group hits enumerate member slugs via groupMemberSlugs when provided
        const members = (existing as AreaSearchHit & { memberSlugs?: string[] }).memberSlugs;
        if (members?.includes(h.areaSlug)) return true;
      }
    }
    return false;
  }
}
