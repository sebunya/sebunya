import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { issueBasketStopToken, readBasketStopToken } from '../../apps/api/src/infrastructure/abandonment/BasketStopToken';
import { GuestBasketContactUseCases } from '../../apps/api/src/application/use-cases/abandonment/GuestBasketContactUseCases';
import { classifyPublicEndpoint } from '../../apps/api/src/domain/security/PublicEndpointPolicy';
import { smsText } from '../../apps/api/src/application/notifications/CustomerMessages';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** Basket reminders for guests (0214, owner decision 2026-11-03): the number typed at checkout, a signed stop link, STOP wins. */
describe('guest basket reminders (0214)', () => {
  it('the stop token names one Ugandan number, signed; a tampered or foreign token reads as nothing', () => {
    const t = issueBasketStopToken('+256772123456', 'secret-a');
    expect(readBasketStopToken(t, 'secret-a')).toBe('+256772123456');
    expect(readBasketStopToken(t, 'secret-b')).toBeNull();
    expect(readBasketStopToken(`${t}x`, 'secret-a')).toBeNull();
    expect(readBasketStopToken('', 'secret-a')).toBeNull();
    expect(readBasketStopToken(issueBasketStopToken('+1555', 'secret-a'), 'secret-a')).toBeNull();
  });

  it('records a guest number only in Ugandan shape, answers the gate from the STOP alone, and one tap records a dated STOP', async () => {
    const upserts: any[] = []; const suppressions: any[] = [];
    let stopped = false;
    const uc = new GuestBasketContactUseCases(
      { upsert: async (i) => { upserts.push(i); } },
      { hasActiveChannelSuppression: async () => stopped, recordChannelSuppression: async (w: any) => { suppressions.push(w); return { suppression_id: 's' }; } } as never,
      { issue: (p) => issueBasketStopToken(p, 'k'), read: (t) => readBasketStopToken(t, 'k') },
    );
    expect(await uc.record({ ownerId: 'g1', phone: '0772 123 456', name: ' Amina ' })).toEqual({ recorded: true });
    expect(upserts[0]).toMatchObject({ ownerId: 'g1', phoneE164: '+256772123456', name: 'Amina' });
    expect(await uc.record({ ownerId: 'g1', phone: '12345' })).toEqual({ recorded: false });
    expect(await uc.record({ ownerId: '', phone: '0772123456' })).toEqual({ recorded: false });
    expect(await uc.mayRemindGuest('+256772123456')).toEqual({ allowed: true, reason: 'ON_BY_DEFAULT' });
    const url = uc.stopUrlFor('+256772123456', 'https://shopgoldplus.com');
    expect(url).toMatch(/^https:\/\/shopgoldplus\.com\/stop-texts\?t=/);
    const token = decodeURIComponent(url.split('t=')[1]);
    expect(uc.describeStopToken(token)).toEqual({ phoneMasked: '+256•••••3456' });
    expect(uc.describeStopToken('nope')).toBeNull();
    expect(await uc.stop({ token, correlationId: 'c' })).toMatchObject({ ok: true });
    expect(suppressions[0]).toMatchObject({ endpoint_ref: 'phone:+256772123456', channel_key: 'sms', purpose_key: 'basket_reminders', scope: 'purpose', source_surface: 'basket_reminder_stop_link' });
    expect(suppressions[0].idempotency_key).toMatch(/^basket-stop:\+256772123456:\d{4}-\d{2}-\d{2}$/);
    stopped = true;
    expect(await uc.mayRemindGuest('+256772123456')).toEqual({ allowed: false, reason: 'SUPPRESSED' });
    expect(await uc.stop({ token: 'bad', correlationId: 'c' })).toEqual({ ok: false, code: 'BAD_TOKEN' });
  });

  it('the guest text says the basket is on the device used and carries the signed stop link; the account text is unchanged', () => {
    const guest = smsText('BASKET_REMINDER', { basketItems: 'A', basketUrl: 'https://s/cart?ch=s.basket', guest: true, stopUrl: 'https://s/stop-texts?t=x' } as never);
    expect(guest).toContain('on the phone or computer you used: https://s/cart?ch=s.basket');
    expect(guest).toContain('To stop these texts: https://s/stop-texts?t=x');
    expect(guest).not.toContain('account');
    const user = smsText('BASKET_REMINDER', { basketItems: 'A', basketUrl: 'https://s/cart', preferencesUrl: 'https://s/account/preferences' } as never);
    expect(user).toContain('saved on your account');
    expect(user).toContain('To stop these texts: https://s/account/preferences');
  });

  it('the capture is the telemetry budget and the stop link the order-lookup one; the router rechecks a guest by STOP only', () => {
    expect(classifyPublicEndpoint('POST', '/commerce/cart/contact')).toBe('telemetry');
    expect(classifyPublicEndpoint('POST', '/commerce/basket-reminders/stop')).toBe('order-lookup');
    expect(classifyPublicEndpoint('GET', '/commerce/basket-reminders/stop')).toBe('order-lookup');
    const router = read('apps/api/src/infrastructure/notifications/NotificationRouter.ts');
    expect(router).toContain("if (!userId && payload.guest !== true) refusal =");
    const registry = read('apps/api/src/infrastructure/Registry.ts');
    expect(registry).toContain('if (!userId) return (await this.guestBasketContactUseCases.mayRemindGuest(phoneE164)).allowed;');
    expect(registry).toContain("? { guest: true, stopUrl: this.guestBasketContactUseCases.stopUrlFor(phoneE164, publicBaseUrl()) }");
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleAbandonmentRepository.ts');
    expect(repo).toContain("left join guest_basket_contacts g on g.owner_id = a.owner_id and a.owner_kind = 'GUEST'");
    expect(repo).toContain("((a.owner_kind = 'USER') or (a.owner_kind = 'GUEST' and g.phone_e164 is not null))");
  });

  it('the storefront captures a guest number on every checkout post and on leaving the field, never for a signed-in customer', () => {
    const checkout = read('apps/web/src/pages/checkout.astro');
    expect(checkout).toContain('rememberGuestBasketContact(values.phone, values.name, cartCredential?.token);');
    expect(checkout).toContain('if (authenticatedUserId || !token || !normaliseCheckoutPhone(phone)) return;');
    expect(checkout).toContain("navigator.sendBeacon('/api/basket-contact', body)");
    expect(checkout).toMatch(/\{!authenticatedUserId && \(\s*<script is:inline nonce=\{Astro\.locals\.cspNonce\}>/);
    const relay = read('apps/web/src/pages/api/basket-contact.ts');
    expect(relay).toContain('if (readSessionToken(request)) return new Response(null, { status: 204 });');
    expect(relay).toContain('[CART_CREDENTIAL_HEADER]: token');
    const stop = read('apps/web/src/pages/stop-texts.astro');
    expect(stop).toContain('robotsMeta="noindex,nofollow"');
    expect(stop).toContain("Astro.response.headers.set('Cache-Control', 'no-store')");
    expect(stop).toContain('Stop these texts');
  });
});
