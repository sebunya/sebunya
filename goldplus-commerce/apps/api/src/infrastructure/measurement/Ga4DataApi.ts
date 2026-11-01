import { logger } from '../logging/logger';
import { getServiceAccountToken, parseServiceAccountJson } from '../seo/adapters/GoogleServiceAccountAuth';
import { IntegrationCredentialVault } from '../seo/IntegrationCredentialVault';

/**
 * GA4 Data API (v1beta runReport) with the shop's service account: credential from the vault connection
 * google-analytics-4 first, then GA4_SERVICE_ACCOUNT_JSON / GA4_PROPERTY_ID. Shared by the nightly GA4
 * reconciliation and the GA4 daily series pull. Pages through results (the API caps a call at 100,000 rows;
 * a year of landing pages can exceed that) and never throws for a missing or refused credential: it says so,
 * so a nightly step can record "unavailable" instead of failing.
 */
export interface SeoRepo { findConnectionWithActiveCredential(providerId: string): Promise<any>; getActiveCredential(connectionId: string): Promise<any> }
export interface Ga4ReportRequest { dateRanges: Array<{ startDate: string; endDate: string }>; dimensions: Array<{ name: string }>; metrics: Array<{ name: string }>; keepEmptyRows?: boolean }
export interface Ga4ReportRow { dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }
export type Ga4ReportResult = { rows: Ga4ReportRow[]; propertyId: string } | { unavailable: string };
export interface Ga4Reporter { runReport(request: Ga4ReportRequest): Promise<Ga4ReportResult> }

const PAGE = 100_000;
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

export class Ga4DataApi implements Ga4Reporter {
  constructor(private readonly seoRepo: SeoRepo, private readonly fetchImpl: typeof fetch = fetch) {}

  async credential(): Promise<{ json: string; propertyId: string } | { unavailable: string }> {
    let json: string | null = null; let propertyId = '';
    try {
      const connection = await this.seoRepo.findConnectionWithActiveCredential('google-analytics-4');
      if (connection) {
        const credential = await this.seoRepo.getActiveCredential(connection.id);
        const vault = IntegrationCredentialVault.fromEnv();
        if (credential && vault) {
          const secret = vault.decrypt<Record<string, unknown>>(credential.ciphertext);
          json = typeof secret.serviceAccountJson === 'string' ? secret.serviceAccountJson : secret.serviceAccountJson ? JSON.stringify(secret.serviceAccountJson) : null;
          propertyId = String((connection.config ?? {}).propertyId ?? connection.property_ref ?? connection.propertyRef ?? '');
        }
      }
    } catch (err) { logger.warn({ err: (err as Error).message }, '[ga4-data-api] vault credential unavailable; trying env'); }
    if (!json) json = (process.env.GA4_SERVICE_ACCOUNT_JSON ?? '').trim() || null;
    if (!propertyId) propertyId = (process.env.GA4_PROPERTY_ID ?? '').trim();
    propertyId = propertyId.replace(/^properties\//, '');
    if (!json) return { unavailable: 'No GA4 service-account credential (vault connection google-analytics-4 or GA4_SERVICE_ACCOUNT_JSON).' };
    if (!propertyId) return { unavailable: 'No GA4 property id (connection config propertyId or GA4_PROPERTY_ID).' };
    return { json, propertyId };
  }

  async runReport(request: Ga4ReportRequest): Promise<Ga4ReportResult> {
    const cred = await this.credential();
    if ('unavailable' in cred) return cred;
    let token: string;
    try { token = await getServiceAccountToken(parseServiceAccountJson(cred.json), SCOPE); }
    catch (err) { return { unavailable: `GA4 credential refused: ${(err as Error).message}`.slice(0, 300) }; }
    const rows: Ga4ReportRow[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const res = await this.fetchImpl(`https://analyticsdata.googleapis.com/v1beta/properties/${cred.propertyId}:runReport`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({ ...request, limit: PAGE, offset }),
      });
      if (!res.ok) return { unavailable: `GA4 runReport failed (HTTP ${res.status}). Is the service account a Viewer on property ${cred.propertyId}?` };
      const body = await res.json() as { rows?: Ga4ReportRow[]; rowCount?: number };
      rows.push(...(body.rows ?? []));
      if (!body.rows?.length || rows.length >= Number(body.rowCount ?? 0)) break;
    }
    return { rows, propertyId: cred.propertyId };
  }
}
