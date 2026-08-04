import { foldUgandanOrthography } from '@goldplus/shared';
import {
  CustomerLocationContext,
  ISearchMissRecorder,
  LocationSearchHit,
} from '../../ports/ILocationSearch';
import { LocationSearchService } from '../../services/locations/LocationSearchService';

/**
 * Location module public use cases (brief PARTs F & H).
 */

export class SearchLocationsUseCase {
  constructor(
    private readonly service: LocationSearchService,
    private readonly misses: ISearchMissRecorder,
  ) {}

  async execute(input: {
    query: string;
    sessionId?: string | null;
    customerId?: string | null;
    deviceHint?: string | null;
    context?: CustomerLocationContext;
  }): Promise<{ hits: LocationSearchHit[]; zeroResult: boolean }> {
    const query = input.query.trim().slice(0, 120);
    const { hits, zeroResult } = await this.service.search(query, input.context);
    if (zeroResult) {
      // Zero results are the coverage signal the whole learning loop runs on —
      // logged fire-and-forget so a metrics write can never fail a search.
      void this.misses
        .record({
          rawQuery: query,
          normalisedQuery: foldUgandanOrthography(query),
          sessionId: input.sessionId ?? null,
          customerId: input.customerId ?? null,
          resultCount: 0,
          deviceHint: input.deviceHint ?? null,
        })
        .catch(() => undefined);
    }
    return { hits, zeroResult };
  }
}

export type SearchResolutionVia =
  | 'alias'
  | 'group'
  | 'landmark'
  | 'manual_entry'
  | 'pickup_point'
  | 'abandoned';

export class RecordLocationSearchEventUseCase {
  constructor(private readonly misses: ISearchMissRecorder) {}

  /**
   * Records what a search that had already missed eventually became — the
   * customer picked something via another layer, fell through to manual entry,
   * or abandoned. One row per event; grouped by normalised query in admin.
   */
  async execute(input: {
    rawQuery: string;
    resolvedAreaSlug?: string | null;
    resolvedVia: SearchResolutionVia;
    sessionId?: string | null;
    customerId?: string | null;
    deviceHint?: string | null;
  }): Promise<void> {
    const query = input.rawQuery.trim().slice(0, 120);
    if (!query) return;
    await this.misses.record({
      rawQuery: query,
      normalisedQuery: foldUgandanOrthography(query),
      sessionId: input.sessionId ?? null,
      customerId: input.customerId ?? null,
      resultCount: 0,
      deviceHint: input.deviceHint ?? null,
      resolvedAreaSlug: input.resolvedAreaSlug ?? null,
      resolvedVia: input.resolvedVia,
    });
  }
}

/**
 * PART G.1 pasted-link parsing. Pure for the common shapes; short links
 * (goo.gl / maps.app.goo.gl) need a server-side resolve via the fetch port so
 * the customer's browser never chases redirects itself.
 */
export interface IShortLinkResolver {
  /** Follow redirects for a known-shortener URL and return the final URL, or null. */
  resolve(url: string): Promise<string | null>;
}

export interface ParsedPin {
  lat: number;
  lng: number;
  source: 'pasted_link';
}

const COORD = /(-?\d{1,2}(?:\.\d{1,10})?)\s*,\s*(-?\d{1,3}(?:\.\d{1,10})?)/;

export function parseCoordinatesFromUrl(raw: string): ParsedPin | null {
  const text = raw.trim();
  if (!text) return null;

  // bare "lat,lng"
  if (!/^https?:\/\//i.test(text)) {
    const m = text.match(COORD);
    if (m) return validPin(Number(m[1]), Number(m[2]));
    return null;
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  // google.com/maps/@lat,lng,z
  const at = url.pathname.match(/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if (at) return validPin(Number(at[1]), Number(at[2]));

  // maps.google.com/?q=lat,lng  |  ?query=lat,lng  |  ?ll=lat,lng
  for (const key of ['q', 'query', 'll', 'destination']) {
    const v = url.searchParams.get(key);
    if (v) {
      const m = v.match(COORD);
      if (m) return validPin(Number(m[1]), Number(m[2]));
    }
  }

  // /maps/place/.../data=!3d<lat>!4d<lng>
  const data = text.match(/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
  if (data) return validPin(Number(data[1]), Number(data[2]));

  return null;
}

function validPin(lat: number, lng: number): ParsedPin | null {
  // Uganda bounding box with generous margin — a pin far outside East Africa is
  // a parse artefact, not a delivery point.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -2.5 || lat > 5.5 || lng < 28 || lng > 36.5) return null;
  return { lat, lng, source: 'pasted_link' };
}

const SHORTENER_HOSTS = new Set(['goo.gl', 'maps.app.goo.gl', 'g.co']);

export class ResolveMapLinkUseCase {
  constructor(private readonly shortLinks: IShortLinkResolver) {}

  async execute(raw: string): Promise<ParsedPin | null> {
    const direct = parseCoordinatesFromUrl(raw);
    if (direct) return direct;
    try {
      const url = new URL(raw.trim());
      if (SHORTENER_HOSTS.has(url.hostname.toLowerCase())) {
        const resolved = await this.shortLinks.resolve(url.toString());
        if (resolved) return parseCoordinatesFromUrl(resolved);
      }
    } catch {
      return null;
    }
    return null;
  }
}
