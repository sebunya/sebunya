/**
 * Offset paging for admin lists whose API takes `limit` / `offset` and answers
 * a full `total`. The fulfilment queue used to request the API's default 50
 * with no way to see row 51 while its badge read "showing {total}".
 */
export interface Paging {
  limit: number;
  offset: number;
}

export function readPaging(params: URLSearchParams, opts: { defaultLimit?: number; maxLimit?: number } = {}): Paging {
  const defaultLimit = opts.defaultLimit ?? 50;
  const maxLimit = opts.maxLimit ?? 200;
  const rawLimit = Number.parseInt(params.get('limit') ?? '', 10);
  const rawOffset = Number.parseInt(params.get('offset') ?? '', 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(maxLimit, Math.max(1, rawLimit)) : defaultLimit;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;
  return { limit, offset };
}

/** "Showing 51–63 of 63", or "Showing 0 of 0". */
export function pagingLabel(p: Paging, shown: number, total: number): string {
  if (shown === 0) return `Showing 0 of ${total}`;
  return `Showing ${p.offset + 1}–${p.offset + shown} of ${total}`;
}

/** Previous / next hrefs that keep every other query parameter (the status filter). */
export function pagingHrefs(base: URL, p: Paging, shown: number, total: number): { prev: string | null; next: string | null } {
  const at = (offset: number) => {
    const u = new URL(base.toString());
    u.searchParams.set('offset', String(offset));
    u.searchParams.set('limit', String(p.limit));
    return `${u.pathname}?${u.searchParams.toString()}`;
  };
  return {
    prev: p.offset > 0 ? at(Math.max(0, p.offset - p.limit)) : null,
    next: p.offset + shown < total ? at(p.offset + p.limit) : null,
  };
}
