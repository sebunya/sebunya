import { sql } from 'drizzle-orm';
import { foldUgandanOrthography, normalizeUgandaDistrict } from '@goldplus/shared';
import { db } from '../db/client';
import { AreaInput, DistanceBand, isDistanceBand } from '../../domain/delivery/DeliveryModel';
import type { IAreaResolverPort, ResolvedArea } from '../../application/use-cases/delivery/DeliveryQuotingUseCase';

/**
 * Turn whatever an order actually carries into the `AreaInput` the model needs.
 *
 * There are three qualities of input in the wild, and the resolver must not
 * flatten them into one:
 *
 *  1. an `area_slug` from the location picker — exact, and the common case for
 *     anything placed after the location module shipped;
 *  2. free text plus a district, which is what every historical order has;
 *  3. a district and nothing more, which resolves CORRECTLY and is still not
 *     priceable, because corridor and band exist only at area granularity. That
 *     is `districtOnly`, and it becomes AREA_TOO_COARSE rather than a refusal.
 *
 * The district-probe rule is the one that matters: a bare query matching a
 * district name resolves INSIDE that district. Without it "Kampala" matched a
 * parish literally called Kampala in Sembabule — a silent 200 km mis-route on a
 * real order (PART 8, name collisions).
 */

interface CorridorRow {
  area_slug: string;
  area: string;
  district: string;
  corridor: string;
  distance_band: string;
  access_mode: string;
  serviceable: boolean;
  centroid_lat: string | null;
  centroid_lng: string | null;
  centroid_source: string | null;
  centroid_sample_size: number;
}

/** Re-exported for existing callers; the shape is owned by the application. */
export type { ResolvedArea } from '../../application/use-cases/delivery/DeliveryQuotingUseCase';

export class DeliveryAreaResolver implements IAreaResolverPort {
  /**
   * Corridor data for an exact slug. Returns null when the slug is not in the
   * 362-area metro set — which is a fact about the area, not a failure to
   * resolve, and the caller turns it into AREA_NOT_METRO.
   */
  private async corridorFor(areaSlug: string): Promise<CorridorRow | null> {
    const rows = (await db.execute(sql`
      select area_slug, area, district, corridor, distance_band, access_mode, serviceable,
             centroid_lat, centroid_lng, centroid_source, centroid_sample_size
      from delivery_corridor where area_slug = ${areaSlug} limit 1`)) as unknown as CorridorRow[];
    return rows[0] ?? null;
  }

  private toInput(slug: string, row: CorridorRow | null, district: string | null): AreaInput {
    if (!row) {
      // Resolved, but outside the metro corridor set: no corridor row means no
      // band, no access mode and no serviceability flag. Claiming any of them
      // would invent a fact, so they stay null and `serviceable` stays true —
      // the refusal that fires is AREA_NOT_METRO, which is the true one.
      return {
        areaSlug: slug,
        district,
        corridor: null,
        band: null,
        accessMode: null,
        serviceable: true,
        measuredKm: null,
        centroidSource: null,
      };
    }
    const band = isDistanceBand(row.distance_band) ? (row.distance_band as DistanceBand) : null;
    return {
      areaSlug: row.area_slug,
      district: row.district,
      corridor: row.corridor,
      band,
      accessMode: row.access_mode === 'water' ? 'water' : 'road',
      serviceable: row.serviceable,
      // A measured centroid beats a band midpoint — but only once it exists.
      // Distance from the origin is computed by the caller, which holds the
      // origin; this carries the raw fact of whether one is available.
      measuredKm: null,
      centroidSource:
        row.centroid_source === 'delivered_pins' || row.centroid_source === 'manual'
          ? (row.centroid_source as 'delivered_pins' | 'manual')
          : null,
    };
  }

  async bySlug(areaSlug: string): Promise<ResolvedArea | null> {
    const row = await this.corridorFor(areaSlug);
    if (row) {
      return { input: this.toInput(areaSlug, row, row.district), label: `${row.area}, ${row.district}`, via: 'area_slug', aliasUsed: null };
    }
    // Not in the corridor set. It may still be a real gazetteer area.
    const gaz = (await db.execute(sql`
      select area_slug, display_label, current_district from ug_area where area_slug = ${areaSlug} limit 1`)) as unknown as Array<{
      area_slug: string;
      display_label: string;
      current_district: string;
    }>;
    if (!gaz[0]) return null;
    return {
      input: this.toInput(areaSlug, null, gaz[0].current_district),
      label: gaz[0].display_label,
      via: 'area_slug',
      aliasUsed: null,
    };
  }

  /**
   * Free text, optionally narrowed by a district. Mirrors the live search
   * pipeline order: district probe → alias → exact → trigram → cross-district.
   */
  async byText(raw: string, district: string | null): Promise<ResolvedArea | null> {
    const folded = foldUgandanOrthography(raw ?? '');
    if (folded.length < 2) return null;

    const asDistrict = normalizeUgandaDistrict(raw);
    if (asDistrict) {
      // The probe IS a district name. That resolution is correct and is not
      // precise enough to price — never silently pick an area inside it.
      const exists = (await db.execute(sql`
        select 1 from ug_area where selectable = true and upper(current_district) = upper(${asDistrict}) limit 1`)) as unknown as unknown[];
      if (exists.length > 0) {
        return {
          input: {
            areaSlug: '',
            districtOnly: true,
            district: asDistrict,
            corridor: null,
            band: null,
            accessMode: null,
            serviceable: true,
            measuredKm: null,
            centroidSource: null,
          },
          label: asDistrict,
          via: 'district_only',
          aliasUsed: null,
        };
      }
    }

    const districtFilter = district ?? null;
    const alias = (await db.execute(sql`
      select a.area_slug, a.display_label, al.normalised_alias
      from ug_area_alias al join ug_area a on a.area_slug = al.area_slug
      where al.normalised_alias = ${folded} and a.selectable = true
        and (${districtFilter}::text is null or upper(a.current_district) = upper(${districtFilter}))
      limit 1`)) as unknown as Array<{ area_slug: string; display_label: string; normalised_alias: string }>;
    if (alias[0]) return this.finish(alias[0].area_slug, alias[0].display_label, 'alias', alias[0].normalised_alias);

    const exact = (await db.execute(sql`
      select area_slug, display_label from ug_area where selectable = true
        and (split_part(search_text, ' ', 1) = ${folded} or search_text like ${folded + ' %'})
        and (${districtFilter}::text is null or upper(current_district) = upper(${districtFilter}))
      limit 1`)) as unknown as Array<{ area_slug: string; display_label: string }>;
    if (exact[0]) return this.finish(exact[0].area_slug, exact[0].display_label, 'exact', null);

    const trigram = (await db.execute(sql`
      select area_slug, display_label, similarity(search_text, ${folded}) as score
      from ug_area where selectable = true and similarity(search_text, ${folded}) > 0.5
        and (${districtFilter}::text is null or upper(current_district) = upper(${districtFilter}))
      order by score desc limit 1`)) as unknown as Array<{ area_slug: string; display_label: string }>;
    if (trigram[0]) return this.finish(trigram[0].area_slug, trigram[0].display_label, 'trigram', null);

    // The stored district may itself be wrong — GP-202608-DBF2 is recorded as
    // "Kira, Mukono" and Kira is in Wakiso. Retry unfiltered and flag it.
    if (districtFilter) {
      const cross = (await db.execute(sql`
        select area_slug, display_label from ug_area where selectable = true
          and (split_part(search_text, ' ', 1) = ${folded} or search_text like ${folded + ' %'})
        order by is_metro desc, area_slug limit 1`)) as unknown as Array<{ area_slug: string; display_label: string }>;
      if (cross[0]) return this.finish(cross[0].area_slug, cross[0].display_label, 'cross_district_correction', null);
    }
    return null;
  }

  private async finish(
    slug: string,
    label: string,
    via: ResolvedArea['via'],
    aliasUsed: string | null,
  ): Promise<ResolvedArea> {
    const row = await this.corridorFor(slug);
    return { input: this.toInput(slug, row, row?.district ?? null), label, via, aliasUsed };
  }

  /**
   * What an order carries, in precedence order. A saved address with a slug is
   * always better than the free text that was typed to find it.
   */
  async forOrderLocation(input: {
    areaSlug?: string | null;
    deliveryArea?: string | null;
    district?: string | null;
  }): Promise<ResolvedArea | null> {
    if (input.areaSlug) {
      const bySlug = await this.bySlug(input.areaSlug);
      if (bySlug) return bySlug;
    }
    // The text often reads "Najjera, Wakiso" — the leading token is the area.
    const raw = (input.deliveryArea ?? '').split(/[,|·]/)[0]?.trim() ?? '';
    if (raw) {
      const byText = await this.byText(raw, input.district ?? null);
      if (byText) return byText;
    }
    if (input.district) {
      const asDistrict = await this.byText(input.district, null);
      if (asDistrict) return asDistrict;
    }
    return null;
  }
}

/**
 * Area search for the setup wizard.
 *
 * Restricted to areas that actually carry a band, because the wizard's whole
 * arithmetic hangs off one: offering an operator a place with no band would let
 * them answer every question and then be told at the end that their choice
 * cannot anchor anything.
 *
 * Alias-aware, so someone can type Najjera — the aliases are exactly the names
 * people use rather than the names the gazetteer uses.
 */
export class DeliveryWizardAreaReader {
  async searchQuotableAreas(query: string, limit: number) {
    const folded = foldUgandanOrthography(query ?? '');
    if (folded.length < 2) return [];
    const rows = (await db.execute(sql`
      with matched as (
        select a.area_slug, al.normalised_alias as matched_on, 1 as rank
        from ug_area_alias al join ug_area a on a.area_slug = al.area_slug
        where a.selectable = true and al.normalised_alias like ${folded + '%'}
        union all
        select area_slug, search_text as matched_on, 2 as rank
        from ug_area
        where selectable = true
          and (search_text like ${folded + '%'} or search_text like ${'% ' + folded + '%'})
      )
      select c.area_slug, c.area, c.district, c.corridor, c.distance_band, min(m.rank) as rank
      from matched m
      join delivery_corridor c on c.area_slug = m.area_slug
      where c.serviceable = true and c.access_mode = 'road'
      group by c.area_slug, c.area, c.district, c.corridor, c.distance_band
      order by rank, c.area
      limit ${limit}`)) as unknown as Array<{
      area_slug: string;
      area: string;
      district: string;
      corridor: string;
      distance_band: string;
    }>;
    return rows
      .filter((r) => isDistanceBand(r.distance_band))
      .map((r) => ({
        areaSlug: r.area_slug,
        label: `${r.area}, ${r.district}`,
        band: r.distance_band as DistanceBand,
        corridor: r.corridor,
        district: r.district,
      }));
  }

  async bandFor(areaSlug: string) {
    const rows = (await db.execute(sql`
      select area, district, corridor, distance_band from delivery_corridor
      where area_slug = ${areaSlug} and serviceable = true and access_mode = 'road' limit 1`)) as unknown as Array<{
      area: string;
      district: string;
      corridor: string;
      distance_band: string;
    }>;
    const r = rows[0];
    if (!r || !isDistanceBand(r.distance_band)) return null;
    return { label: `${r.area}, ${r.district}`, band: r.distance_band as DistanceBand, corridor: r.corridor, district: r.district };
  }
}
