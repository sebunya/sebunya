import { describe, it, expect, vi } from 'vitest';
import { ConsentService } from '../../apps/api/src/application/use-cases/measurement/ConsentService';

/**
 * Owner decision (2026-08-07): first-party ON-SITE personalisation is always on;
 * data is never shared with a third party. Because EVERY measurement destination
 * is third-party (ga4/gtm_web = Google, meta/tiktok/… = ad platforms), the
 * default grants `personalization` but keeps `analytics` and `advertising`
 * denied. These lock that posture in.
 */

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
const repoWith = (row: any) => ({ getCurrentState: vi.fn().mockResolvedValue({ row }) } as any);

describe('default consent posture', () => {
  it('grants on-site personalisation and denies third-party purposes when nothing is stored', async () => {
    const svc = new ConsentService(repoWith(null), logger);
    const state = await svc.getCurrentState('fp1', 'user1');
    expect(state.personalization).toBe(true);   // on-site: always on
    expect(state.analytics).toBe(false);         // gates GA4/GTM (third-party): off
    expect(state.advertising).toBe(false);       // gates Meta/TikTok/etc.: off
    expect(state.essential).toBe(true);
  });

  it('never dispatches to a third-party destination by default', async () => {
    const svc = new ConsentService(repoWith(null), logger);
    expect((await svc.checkDestinationPermission('ga4', 'fp1')).allowed).toBe(false);        // Google
    expect((await svc.checkDestinationPermission('meta_capi', 'fp1')).allowed).toBe(false);   // Meta
    expect((await svc.checkDestinationPermission('gtm_web', 'fp1')).allowed).toBe(false);      // Google
  });

  it('applies the owner default when a stored grant has expired', async () => {
    const expired = { analyticsGranted: true, advertisingGranted: true, personalizationGranted: false, expiresAt: new Date('2000-01-01') };
    const state = await new ConsentService(repoWith(expired), logger).getCurrentState('fp1', 'user1');
    expect(state.personalization).toBe(true);
    expect(state.advertising).toBe(false);
  });

  it('honours an explicit, unexpired stored consent verbatim', async () => {
    const row = { analyticsGranted: true, advertisingGranted: true, personalizationGranted: true, expiresAt: null };
    const state = await new ConsentService(repoWith(row), logger).getCurrentState('fp1', 'user1');
    expect(state.analytics).toBe(true);
    expect(state.advertising).toBe(true);
    expect(state.personalization).toBe(true);
  });
});
