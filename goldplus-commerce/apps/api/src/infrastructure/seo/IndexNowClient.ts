/**
 * IndexNowClient — thin HTTP adapter for the IndexNow protocol
 * (https://www.indexnow.org/documentation). The key comes exclusively from the
 * INDEXNOW_KEY env var; per protocol the key is NOT a secret — it is published
 * at https://<host>/<key>.txt (served by the storefront) so search engines can
 * verify ownership.
 */

import type { IndexNowSubmitPort } from '../../application/use-cases/seo-growth/SubmitIndexNowUseCase';

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

export class IndexNowClient implements IndexNowSubmitPort {
  async submit(payload: { host: string; key: string; keyLocation: string; urlList: string[] }): Promise<{ status: number }> {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      // A hung provider must not hold this request open forever.
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });
    return { status: res.status };
  }
}
