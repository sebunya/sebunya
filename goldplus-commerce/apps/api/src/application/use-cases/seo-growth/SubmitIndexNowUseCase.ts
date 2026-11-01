/**
 * SubmitIndexNowUseCase — pings IndexNow-participating search engines with
 * changed URLs (slug changes, operator-submitted URLs).
 *
 * Honest-integration contract: when INDEXNOW_KEY is absent this is a no-op
 * returning { status: 'READY_FOR_CREDENTIALS' } — nothing is faked, nothing is
 * sent. Every URL must live on the storefront host; anything else is rejected
 * so this can never be used to ping arbitrary hosts.
 */

export interface IndexNowSubmitPort {
  submit(payload: { host: string; key: string; keyLocation: string; urlList: string[] }): Promise<{ status: number }>;
}

export const INDEXNOW_HOST = 'shopgoldplus.com';
const MAX_URLS = 100;

export type IndexNowResult =
  | { status: 'READY_FOR_CREDENTIALS' }
  | { status: 'REJECTED'; reason: string }
  | { status: 'SUBMITTED'; submitted: number; httpStatus: number }
  | { status: 'FAILED'; error: string };

/** True only for absolute https URLs on the storefront host (www accepted). */
export function isAllowedIndexNowUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return u.hostname === INDEXNOW_HOST || u.hostname === `www.${INDEXNOW_HOST}`;
  } catch {
    return false;
  }
}

export class SubmitIndexNowUseCase {
  constructor(
    private readonly submitter: IndexNowSubmitPort,
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  async execute(urls: string[]): Promise<IndexNowResult> {
    const key = this.env.INDEXNOW_KEY?.trim();
    if (!key) return { status: 'READY_FOR_CREDENTIALS' };

    const unique = [...new Set(urls.map((u) => String(u).trim()).filter((u) => u !== ''))];
    if (unique.length === 0) return { status: 'REJECTED', reason: 'No URLs provided.' };
    const offending = unique.find((u) => !isAllowedIndexNowUrl(u));
    if (offending) {
      return { status: 'REJECTED', reason: `URL not on ${INDEXNOW_HOST}: ${offending}` };
    }

    const urlList = unique.slice(0, MAX_URLS);
    try {
      const { status } = await this.submitter.submit({
        host: INDEXNOW_HOST,
        key,
        keyLocation: `https://${INDEXNOW_HOST}/${key}.txt`,
        urlList,
      });
      if (status >= 200 && status < 300) {
        return { status: 'SUBMITTED', submitted: urlList.length, httpStatus: status };
      }
      return { status: 'FAILED', error: `IndexNow responded ${status}.` };
    } catch (err: any) {
      return { status: 'FAILED', error: String(err?.message ?? err).slice(0, 300) };
    }
  }
}
