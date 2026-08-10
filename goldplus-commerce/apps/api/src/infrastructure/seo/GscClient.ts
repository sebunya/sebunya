import { createSign } from 'node:crypto';

/**
 * GscClient — Google Search Console Search Analytics API client authenticated
 * with a service account (no OAuth consent flow; the SA is added as a user on
 * the Search Console property).
 *
 * Credentials come exclusively from the environment:
 *   GSC_SERVICE_ACCOUNT_JSON — the full service-account JSON key
 *   GSC_SITE_URL             — the verified property (e.g. sc-domain:shopgoldplus.com
 *                              or https://shopgoldplus.com/)
 *
 * The JWT grant (RS256) is signed with node:crypto — deliberately no new npm
 * dependency (googleapis / google-auth-library are not in package.json).
 * Access tokens are cached in-process until 60s before expiry.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

export interface GscQueryInput {
  startDate: string; // YYYY-MM-DD inclusive
  endDate: string;   // YYYY-MM-DD inclusive
  startRow: number;
  rowLimit: number;
}

export interface GscApiRow {
  keys: string[]; // [date, page, query]
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** Error carrying the upstream HTTP status so callers can decide retryability. */
export class GscApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'GscApiError';
  }
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');

export class GscClient {
  private readonly clientEmail: string;
  private readonly privateKey: string;
  private readonly siteUrl: string;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(serviceAccountJson: string, siteUrl: string) {
    let parsed: { client_email?: string; private_key?: string };
    try {
      parsed = JSON.parse(serviceAccountJson);
    } catch {
      throw new Error('GSC_SERVICE_ACCOUNT_JSON is not valid JSON.');
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('GSC_SERVICE_ACCOUNT_JSON must contain client_email and private_key.');
    }
    this.clientEmail = parsed.client_email;
    this.privateKey = parsed.private_key;
    this.siteUrl = siteUrl;
  }

  /** Build from env; returns null when credentials are absent (honest no-op path). */
  static fromEnv(env: Record<string, string | undefined> = process.env): GscClient | null {
    const json = env.GSC_SERVICE_ACCOUNT_JSON?.trim();
    const site = env.GSC_SITE_URL?.trim();
    if (!json || !site) return null;
    return new GscClient(json, site);
  }

  private signJwt(nowSec: number): string {
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({
      iss: this.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: nowSec,
      exp: nowSec + 3600,
    }));
    const unsigned = `${header}.${claims}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    const signature = signer.sign(this.privateKey).toString('base64url');
    return `${unsigned}.${signature}`;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt - 60_000 > now) {
      return this.cachedToken.token;
    }
    const assertion = this.signJwt(Math.floor(now / 1000));
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!res.ok) {
      throw new GscApiError(`Google token exchange failed (${res.status}).`, res.status);
    }
    const body = await res.json() as { access_token: string; expires_in: number };
    this.cachedToken = { token: body.access_token, expiresAt: now + body.expires_in * 1000 };
    return body.access_token;
  }

  /** searchanalytics.query — dimensions date/page/query, paged via startRow. */
  async query(input: GscQueryInput): Promise<{ rows: GscApiRow[] }> {
    const token = await this.getAccessToken();
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(this.siteUrl)}/searchAnalytics/query`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: ['date', 'page', 'query'],
        rowLimit: input.rowLimit,
        startRow: input.startRow,
        dataState: 'final',
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GscApiError(`GSC searchAnalytics.query failed (${res.status}): ${text.slice(0, 300)}`, res.status);
    }
    const body = await res.json() as { rows?: GscApiRow[] };
    return { rows: body.rows ?? [] };
  }
}
