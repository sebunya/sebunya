import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { REF_CLICK_MAX_AGE_MS, hasMatchKey, offlineSaleErrors, refClickIds } from '../../apps/api/src/domain/advertising/OfflineConversionPolicy';
import { offlineRequest } from '../../apps/api/src/infrastructure/advertising/AdvertisingGateways';
import { OfflineConversionUseCases } from '../../apps/api/src/application/use-cases/advertising/OfflineConversionUseCases';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');
const now = new Date('2026-10-01T12:00:00Z');
const sale = { channel: 'WHATSAPP', occurredAt: '2026-10-01T10:00:00Z', valueUgx: 150000 };

describe('WhatsApp sales credited to the advert without the WhatsApp Business Platform', () => {
  it('the reference code alone is enough to record a sale; a mistyped one is named, not silently dropped', () => {
    expect(offlineSaleErrors({ ...sale, whatsappRef: 'GP-7K3M9X' }, now)).toEqual([]);
    expect(offlineSaleErrors({ ...sale, whatsappRef: ' gp-7k3m9x ' }, now)).toEqual([]);
    expect(offlineSaleErrors({ ...sale, whatsappRef: 'GP-123' }, now).join(' ')).toMatch(/reference code is "GP-" and six characters/);
    expect(offlineSaleErrors({ ...sale }, now).join(' ')).toMatch(/phone or email, the order number, or the reference code/);
    expect(offlineSaleErrors({ ...sale, phone: '0772123456', whatsappRef: '' }, now)).toEqual([]);
  });
  it('the click that counts happened before the sale and within 30 days of it', () => {
    const saleAt = new Date('2026-10-01T10:00:00Z');
    const ids = { fbc: 'fb.1.1.abc', gclid: 'G1', ttclid: null, twclid: '' };
    expect(refClickIds({ clickedAt: '2026-09-29T10:00:00Z', ids }, saleAt)).toEqual({ fbc: 'fb.1.1.abc', gclid: 'G1' });
    expect(refClickIds({ clickedAt: '2026-10-01T10:00:01Z', ids }, saleAt)).toEqual({});                     // clicked after buying
    expect(refClickIds({ clickedAt: new Date(saleAt.getTime() - REF_CLICK_MAX_AGE_MS - 1000), ids }, saleAt)).toEqual({});
    expect(refClickIds({ clickedAt: null, ids }, saleAt)).toEqual({});
    expect(refClickIds(null, saleAt)).toEqual({});
    expect(hasMatchKey('meta', { clickIds: { fbc: 'fb.1.1.abc' }, hashes: { emailSha256: null, emailGoogleSha256: null, phoneDigitsSha256: null, phonePlusSha256: null } })).toBe(true);
  });
  it('recording: the code names its visitor, whose advertising choice is checked at send time; an unknown code is refused', async () => {
    const saved: any[] = [];
    const repo: any = {
      findOrder: async () => null, consentSubjectsForContact: async () => ({ userIds: [], fpClientIds: [] }),
      whatsAppRefVisitor: async (code: string) => (code === 'GP-7K3M9X' ? { visitorId: 'fp.1.visitor', issuedAt: now } : null),
      recordSale: async (s: unknown) => { saved.push(s); return 'sale-1'; },
    };
    const audits: any[] = [];
    const uc = new OfflineConversionUseCases(repo, {} as never, async () => null, async () => ({}) as never, { execute: async (e: unknown) => { audits.push(e); } } as never, () => now);
    expect(await uc.recordSale('admin', { ...sale, whatsappRef: 'gp7k3m9x' })).toEqual({ ok: true, value: { id: 'sale-1' } });
    expect(saved[0]).toMatchObject({ whatsappRef: 'GP-7K3M9X', subjects: { fpClientIds: ['fp.1.visitor'] } });
    expect(audits[0].newState).toMatchObject({ hasWhatsAppRef: true });
    expect(JSON.stringify(audits[0])).not.toContain('fp.1.visitor');     // the audit says a code was used, not whose
    expect(await uc.recordSale('admin', { ...sale, whatsappRef: 'GP-222222' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(saved).toHaveLength(1);
  });
  it('what Meta receives: the advert click, and the same visitor ids the browsing events carried', () => {
    const ctx: any = { row: { platform: 'meta', source: 'ADMIN_SALE', sourceRef: '11111111-2222-4333-8444-555555555555', eventId: 'ev-1', occurredAt: '2026-10-01T10:00:00Z' }, valueUgx: 150000, orderId: null, orderNumber: null, channel: 'WHATSAPP',
      hashes: { emailSha256: null, emailGoogleSha256: null, phoneDigitsSha256: null, phonePlusSha256: null }, clickIds: { fbc: 'fb.1.1790841538888.IwAR_x' },
      visitorId: 'fp.1790841536221.11111111-1111-4111-8111-111111111111', subjects: { userIds: [], fpClientIds: [] } };
    const req: any = offlineRequest(ctx, { config: {}, secret: '', destinationConfig: { datasetId: '1234567890123' }, destinationSecret: 'T', testMode: false, usdRate: 3750 });
    const ev = req.body.data[0];
    // US dollars only (owner decision 2026-10-06): 150,000 shillings at 3,750 = 40 dollars.
    expect(ev).toMatchObject({ event_name: 'Purchase', action_source: 'chat', custom_data: { currency: 'USD', value: 40 } });
    expect(ev.user_data.fbc).toBe('fb.1.1790841538888.IwAR_x');
    expect(ev.user_data.external_id).toHaveLength(1);
    expect(ev.user_data.fbp).toMatch(/^fb\.1\.1790841536221\.[1-9]\d{9}$/);
    // A sale with no reference keeps exactly what it sent before.
    const plain: any = offlineRequest({ ...ctx, visitorId: null, clickIds: {}, hashes: { ...ctx.hashes, phoneDigitsSha256: 'd'.repeat(64) } }, { config: {}, secret: '', destinationConfig: { datasetId: '1234567890123' }, destinationSecret: 'T', testMode: false });
    expect(Object.keys(JSON.parse(JSON.stringify(plain.body.data[0].user_data)))).toEqual(['ph']);
  });
  it('the advert landing page opens a chat only when tapped, on every page taps get a reference, and staff have somewhere to type it', () => {
    const wa = read('apps/web/src/pages/wa.astro');
    expect(wa).toContain('robotsMeta="noindex,follow"');
    expect(wa).toContain('data-wa-bridge');
    expect(wa).not.toMatch(/location\.(href|replace|assign)|http-equiv="refresh"|Astro\.redirect/);     // never a redirect by itself
    expect(read('apps/web/src/layouts/BaseLayout.astro')).toContain('installWhatsAppClicks();');
    expect(read('apps/web/src/pages/admin/advertising/offline.astro')).toContain('name="whatsappRef"');
    expect(read('apps/api/src/infrastructure/db/migrations/0167_offline_sale_whatsapp_ref.sql')).toMatch(/ADD COLUMN IF NOT EXISTS whatsapp_ref/);
  });
});
