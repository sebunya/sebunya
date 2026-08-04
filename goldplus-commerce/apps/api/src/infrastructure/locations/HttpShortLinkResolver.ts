import { IShortLinkResolver } from '../../application/use-cases/locations/LocationUseCases';

/**
 * Server-side resolution of maps shortener links (goo.gl / maps.app.goo.gl).
 * SSRF-contained: only the known Google shortener hosts are ever fetched, only
 * with redirect:manual, and only the Location header is read — the body is
 * never consumed, no other host is ever contacted from user input.
 */
const ALLOWED_HOSTS = new Set(['goo.gl', 'maps.app.goo.gl', 'g.co']);
const MAX_HOPS = 4;

export class HttpShortLinkResolver implements IShortLinkResolver {
  async resolve(url: string): Promise<string | null> {
    let current = url;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(current);
      } catch {
        return null;
      }
      const isShortener = ALLOWED_HOSTS.has(parsed.hostname.toLowerCase());
      if (!isShortener) return current; // reached the expanded URL — parse client-side of this class
      try {
        const res = await fetch(current, {
          method: 'HEAD',
          redirect: 'manual',
          signal: AbortSignal.timeout(4000),
        });
        const next = res.headers.get('location');
        if (!next) return null;
        current = new URL(next, current).toString();
      } catch {
        return null;
      }
    }
    return null;
  }
}
