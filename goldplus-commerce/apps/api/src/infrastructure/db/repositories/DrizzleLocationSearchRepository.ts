import { sql } from 'drizzle-orm';
import { db } from '../client';
import {
  AreaSearchHit,
  ILocationOrderDensityReader,
  ILocationSearchRepository,
  ISearchMissRecorder,
  LocationMatchType,
  PickupPointSearchHit,
} from '../../../application/ports/ILocationSearch';
import { ugSearchMiss } from '../schema/locations';

/**
 * SQL backing for the PART F pipeline. Every layer filters selectable=true —
 * the two non-selectable source records (brief D.2) can never surface here.
 * The trigram layer leans on the GIN gin_trgm_ops index created in 0084.
 */

type AreaRowRaw = {
  area_slug: string;
  display_label: string;
  parish_or_area_clean: string;
  current_district: string;
  delivery_zone_code: string | null;
  postcode: string | null;
  is_metro: boolean;
  score: number;
  via_landmark?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  member_slugs?: string[] | null;
};

function toHit(matchType: LocationMatchType) {
  return (r: AreaRowRaw): AreaSearchHit => ({
    kind: 'area',
    areaSlug: r.area_slug,
    displayLabel: r.group_name ? r.group_name : r.display_label,
    areaName: r.parish_or_area_clean,
    currentDistrict: r.current_district,
    deliveryZoneCode: r.delivery_zone_code,
    postcode: r.postcode,
    isMetro: r.is_metro,
    matchType,
    score: Number(r.score ?? 1),
    ...(r.group_id ? { groupId: r.group_id, groupName: r.group_name ?? undefined } : {}),
    ...(r.member_slugs ? ({ memberSlugs: r.member_slugs } as object) : {}),
    ...(r.via_landmark ? { viaLandmark: r.via_landmark } : {}),
  });
}

const AREA_COLS = sql`a.area_slug, a.display_label, a.parish_or_area_clean, a.current_district, a.delivery_zone_code, a.postcode, a.is_metro`;

export class DrizzleLocationSearchRepository implements ILocationSearchRepository {
  async aliasExact(folded: string): Promise<AreaSearchHit[]> {
    const rows = (await db.execute(sql`
      select ${AREA_COLS}, 1::float as score
      from ug_area_alias al
      join ug_area a on a.area_slug = al.area_slug
      where al.normalised_alias = ${folded} and a.selectable = true
      limit 8`)) as unknown as AreaRowRaw[];
    return rows.map(toHit('alias_exact'));
  }

  async areaExact(folded: string): Promise<AreaSearchHit[]> {
    // search_text begins with the folded clean name; exact = first token(s) equal.
    const rows = (await db.execute(sql`
      select ${AREA_COLS}, 1::float as score
      from ug_area a
      where a.selectable = true
        and (split_part(a.search_text, ' ', 1) = ${folded}
             or a.search_text = ${folded}
             or a.search_text like ${folded + ' %'})
      limit 16`)) as unknown as AreaRowRaw[];
    return rows.map(toHit('area_exact'));
  }

  async groupExact(folded: string): Promise<AreaSearchHit[]> {
    const rows = (await db.execute(sql`
      select ${AREA_COLS}, 1::float as score,
             g.id as group_id, g.group_name,
             (select array_agg(m2.area_slug) from ug_area_group_member m2 where m2.group_id = g.id) as member_slugs
      from ug_area_group g
      join ug_area_group_member m on m.group_id = g.id
      join ug_area a on a.area_slug = m.area_slug and a.selectable = true
      where g.normalised_name = ${folded}
      order by a.area_slug
      limit 1`)) as unknown as AreaRowRaw[];
    return rows.map(toHit('group_exact'));
  }

  async prefix(folded: string, limit: number): Promise<AreaSearchHit[]> {
    // Matching only the START of search_text made every term after the area
    // name unreachable — "Entebbe" lives in the municipality field, so it sat
    // in the text and could never be found. The second pattern matches at any
    // WORD boundary, which is what makes a town or sub-county name searchable.
    // Still a prefix match per word, so it does not degrade into substring
    // soup: "bunga" cannot reach "Busanga".
    const rows = (await db.execute(sql`
      select ${AREA_COLS}, 0.9::float as score
      from ug_area a
      where a.selectable = true
        and (a.search_text like ${folded + '%'} or a.search_text like ${'% ' + folded + '%'})
      union
      select ${AREA_COLS}, 0.9::float as score
      from ug_area_alias al join ug_area a on a.area_slug = al.area_slug
      where a.selectable = true and al.normalised_alias like ${folded + '%'}
      limit ${limit}`)) as unknown as AreaRowRaw[];
    return rows.map(toHit('prefix'));
  }

  async trigram(folded: string, threshold: number, limit: number): Promise<AreaSearchHit[]> {
    const rows = (await db.execute(sql`
      select ${AREA_COLS}, similarity(a.search_text, ${folded})::float as score
      from ug_area a
      where a.selectable = true and similarity(a.search_text, ${folded}) > ${threshold}
      order by score desc
      limit ${limit}`)) as unknown as AreaRowRaw[];
    return rows.map(toHit('trigram'));
  }

  async landmark(folded: string, limit: number): Promise<AreaSearchHit[]> {
    const rows = (await db.execute(sql`
      select ${AREA_COLS}, 0.95::float as score, l.name as via_landmark
      from ug_landmark l
      join ug_area a on a.area_slug = l.area_slug and a.selectable = true
      where lower(l.name) like ${'%' + folded + '%'}
      order by l.usage_count desc
      limit ${limit}`)) as unknown as AreaRowRaw[];
    return rows.map(toHit('landmark'));
  }

  async pickupPoints(folded: string, limit: number): Promise<PickupPointSearchHit[]> {
    const rows = (await db.execute(sql`
      select p.id, p.name, p.operator, p.area_slug, a.current_district
      from ug_pickup_point p
      left join ug_area a on a.area_slug = p.area_slug
      where p.active = true and lower(p.name) like ${'%' + folded + '%'}
      limit ${limit}`)) as unknown as Array<{
      id: string; name: string; operator: string; area_slug: string | null; current_district: string | null;
    }>;
    return rows.map((r) => ({
      kind: 'pickup_point' as const,
      pickupPointId: r.id,
      name: r.name,
      operator: r.operator,
      areaSlug: r.area_slug,
      district: r.current_district,
      matchType: 'pickup_point' as const,
      score: 0.9,
    }));
  }
}

/** How long one replica reuses the density map. Ranking, not money: minutes of staleness are fine. */
export const DENSITY_CACHE_MS = 10 * 60 * 1000;

export class DrizzleLocationOrderDensityReader implements ILocationOrderDensityReader {
  private cached: { at: number; value: ReadonlyMap<string, number> } | null = null;
  private inflight: Promise<ReadonlyMap<string, number>> | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Orders per area, from the STRUCTURED link every quoted order carries
   * (delivery_quote_capture.area_slug: one row per order, indexed on area_slug).
   *
   * It used to join every order to every saved address with a leading-wildcard
   * LIKE on the free-text label, on every keystroke: a nested loop no index could
   * help (34 s at 20k orders x 3k addresses), counting each order once per
   * matching address across all customers, with substrings matching other areas
   * ('Kira' in 'Kirabo'). Now: one grouped index-assisted query, cached per replica.
   * Orders quoted before the delivery module (no capture row) count 0, as before.
   */
  async densityByArea(): Promise<ReadonlyMap<string, number>> {
    const now = this.now();
    if (this.cached && now - this.cached.at < DENSITY_CACHE_MS) return this.cached.value;
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const rows = (await db.execute(sql`
          select q.area_slug, count(*)::int as n
          from delivery_quote_capture q
          join orders o on o.id = q.order_id
          where q.area_slug is not null and o.status not in ('cancelled', 'failed')
          group by q.area_slug`)) as unknown as Array<{ area_slug: string; n: number }>;
        const value: ReadonlyMap<string, number> = new Map(rows.map((r) => [r.area_slug, Number(r.n)]));
        this.cached = { at: this.now(), value };
        return value;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}

export class DrizzleSearchMissRecorder implements ISearchMissRecorder {
  async record(input: {
    rawQuery: string;
    normalisedQuery: string;
    sessionId?: string | null;
    customerId?: string | null;
    resultCount: number;
    deviceHint?: string | null;
    resolvedAreaSlug?: string | null;
    resolvedVia?: string | null;
  }): Promise<void> {
    await db.insert(ugSearchMiss).values({
      rawQuery: input.rawQuery.slice(0, 200),
      normalisedQuery: input.normalisedQuery.slice(0, 200),
      sessionId: input.sessionId ?? null,
      customerId: input.customerId ?? null,
      resultCount: input.resultCount,
      deviceHint: input.deviceHint?.slice(0, 120) ?? null,
      resolvedAreaSlug: input.resolvedAreaSlug ?? null,
      resolvedVia: input.resolvedVia ?? null,
    });
  }
}

export class DrizzleCustomerLocationContextReader {
  /**
   * Personalised ranking context (F.3 ranks 1–2): the caller's own saved-address
   * areas and areas they have ordered to. Own-user only — customerId comes from
   * a verified token, never a query param.
   */
  async forCustomer(customerId: string): Promise<{
    savedAreaSlugs: ReadonlySet<string>;
    orderedAreaSlugs: ReadonlySet<string>;
  }> {
    const saved = (await db.execute(sql`
      select area_slug from addresses
      where user_id = ${customerId} and area_slug is not null and deleted_at is null`)) as unknown as Array<{ area_slug: string }>;
    const ordered = (await db.execute(sql`
      select distinct ad.area_slug
      from orders o
      join addresses ad on ad.user_id = o.user_id and ad.area_slug is not null
      where o.user_id = ${customerId} and o.status not in ('cancelled','failed')`)) as unknown as Array<{ area_slug: string }>;
    return {
      savedAreaSlugs: new Set(saved.map((r) => r.area_slug)),
      orderedAreaSlugs: new Set(ordered.map((r) => r.area_slug)),
    };
  }
}
