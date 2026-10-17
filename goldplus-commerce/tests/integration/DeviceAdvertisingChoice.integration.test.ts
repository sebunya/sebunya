import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

/**
 * "Advertising on this device" end to end (2026-10-17): the cookies page's switch, through the REAL consent routes
 * on REAL PostgreSQL, is the refusal every ad sender checks right before it sends (AdvertisingConsentGate).
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('advertising on this device (real PostgreSQL, real app)', () => {
  let app: any; let raw: any; let gate: any; let choice: any;
  const fp = `fp.1790000000000.it-${Date.now().toString(36)}`;
  const viaApp = (async (url: string, init: any) => app.request(String(url).replace('http://api.test', ''), init)) as unknown as typeof fetch;

  beforeAll(async () => {
    raw = createRequire(import.meta.url)('postgres')(URL as string, { max: 2, onnotice: () => undefined });
    app = (await import('../../apps/api/src/interfaces/http/app')).default;
    gate = await import('../../apps/api/src/infrastructure/measurement/AdvertisingConsentGate');
    choice = await import('../../apps/web/src/lib/deviceAdChoice');
  }, 60_000);
  afterAll(async () => {
    if (!raw) return;
    await raw`delete from consent_current_state where fp_client_id = ${fp}`.catch(() => undefined);
    await raw`delete from consent_records where fp_client_id = ${fp}`.catch(() => undefined);
    await raw.end({ timeout: 5 });
  });

  it('off: every ad sender sees this device as refused; on again: it is not', async () => {
    expect(await gate.advertisingRefused({ fpClientId: fp })).toBe(false);
    expect(await choice.setDeviceAdvertising(false, { apiBase: 'http://api.test', fpClientId: fp, sessionToken: null, fetchImpl: viaApp })).toEqual({ ok: true });
    expect(await gate.advertisingRefused({ fpClientId: fp })).toBe(true);
    expect(await choice.setDeviceAdvertising(true, { apiBase: 'http://api.test', fpClientId: fp, sessionToken: null, fetchImpl: viaApp })).toEqual({ ok: true });
    expect(await gate.advertisingRefused({ fpClientId: fp })).toBe(false);
  });

  it('refuses without a usable visitor id and changes nothing', async () => {
    const r = await choice.setDeviceAdvertising(false, { apiBase: 'http://api.test', fpClientId: undefined, sessionToken: null, fetchImpl: viaApp });
    expect(r.ok).toBe(false);
  });
});
