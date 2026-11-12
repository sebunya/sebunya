import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Checkout's prefill loads (account addresses and contact, loyalty programme and
 * points, pickup points) start together rather than one after another, so a slow
 * API costs the shopper the slowest load, not the sum of all of them (2026-11).
 *
 * This runs the page's REAL frontmatter section, lifted from checkout.astro and
 * compiled, against a fetch the test controls: it checks the order the requests
 * start in, that the points balance still waits for the programme it depends on,
 * that the section waits for every load, and the values the page renders from.
 */
const page = readFileSync(resolve(__dirname, '../../apps/web/src/pages/checkout.astro'), 'utf8');
const START = "const sessionToken = Astro.cookies.get('goldplus_session')?.value ?? null;";
const END = 'const defaultAddress = savedAddresses.find((a) => a.isDefault) ?? savedAddresses[0] ?? null;';
const section = page.slice(page.indexOf(START), page.indexOf(END) + END.length);
const js = ts.transpileModule(section, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const runSection = new AsyncFunction(
  'Astro', 'apiBase', 'authenticatedUserId', 'fetch',
  `${js}\nreturn { savedAddresses, accountEmail, accountPhone, defaultAddress, loyaltyProgramme, loyaltyAvailablePoints, pickupPoints };`,
);

const API = 'http://api.test';
type Reply = { ok?: boolean; body?: unknown; fail?: boolean };

/** A fetch whose every request stays open until the test answers it. */
function fakeApi() {
  const started: string[] = [];
  const open = new Map<string, (r: Reply) => void>();
  const fetch = (url: string) => {
    const path = url.slice(API.length);
    started.push(path);
    return new Promise((res, rej) =>
      open.set(path, (r) => (r.fail ? rej(new Error('timeout')) : res({ ok: r.ok ?? true, json: async () => r.body }))),
    );
  };
  const answer = async (path: string, r: Reply) => {
    const reply = open.get(path);
    if (!reply) throw new Error(`${path} was never requested`);
    reply(r);
    await settle();
  };
  return { fetch, started, answer };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const astro = (session: string | null) => ({ cookies: { get: (k: string) => (k === 'goldplus_session' && session ? { value: session } : undefined) } });

const ADDRESSES = [
  { id: 'a1', label: 'Work', isDefault: false },
  { id: 'a2', label: 'Home', isDefault: true },
];
const PROGRAMME = { active: true, earnRatePer1000Ugx: '2', redemption: { configured: true, pointValueUgx: 10, minPoints: 100, maxShareBps: 2000 } };
const PICKUP = [{ id: 'pp1', name: 'GoldPlus shop', operator: 'GoldPlus', physicalAddress: 'Kampala Road' }];

describe('checkout prefill loads', () => {
  it('starts the independent loads together, and asks for points only once the programme says they can be redeemed', async () => {
    const api = fakeApi();
    let done = false;
    const run = runSection(astro('tok'), API, 'user-1', api.fetch).then((v: unknown) => { done = true; return v; });
    await settle();
    expect(api.started).toEqual(['/account/addresses', '/account/me', '/commerce/loyalty-programme', '/locations/pickup-points']);

    await api.answer('/commerce/loyalty-programme', { body: { success: true, data: PROGRAMME } });
    expect(api.started.at(-1)).toBe('/account/loyalty');

    await api.answer('/locations/pickup-points', { body: { success: true, data: PICKUP } });
    await api.answer('/account/loyalty', { body: { success: true, data: { balance: { available: 540 } } } });
    await api.answer('/account/addresses', { body: { success: true, data: ADDRESSES } });
    expect(done).toBe(false); // the page waits for the last load
    await api.answer('/account/me', { body: { success: true, data: { email: 'amina@example.com', phone: '+256772000111' } } });

    await expect(run).resolves.toEqual({
      savedAddresses: ADDRESSES,
      accountEmail: 'amina@example.com',
      accountPhone: '+256772000111',
      defaultAddress: ADDRESSES[1],
      loyaltyProgramme: { active: true, earnRatePer1000Ugx: 2, redemption: PROGRAMME.redemption },
      loyaltyAvailablePoints: 540,
      pickupPoints: PICKUP,
    });
    expect(api.started).toHaveLength(5);
  });

  it('a guest loads only the public data, and each failure degrades to the blank answer on its own', async () => {
    const api = fakeApi();
    const run = runSection(astro(null), API, null, api.fetch);
    await settle();
    expect(api.started).toEqual(['/commerce/loyalty-programme', '/locations/pickup-points']);
    await api.answer('/commerce/loyalty-programme', { fail: true });
    await api.answer('/locations/pickup-points', { ok: false, body: { success: true, data: PICKUP } });
    await expect(run).resolves.toEqual({
      savedAddresses: [],
      accountEmail: '',
      accountPhone: '',
      defaultAddress: null,
      loyaltyProgramme: { active: false, earnRatePer1000Ugx: 0, redemption: { configured: false } },
      loyaltyAvailablePoints: 0,
      pickupPoints: [],
    });
  });

  it('a failed account load leaves the loyalty and pickup answers intact, and skips points when redemption is off', async () => {
    const api = fakeApi();
    const run = runSection(astro('tok'), API, 'user-1', api.fetch);
    await settle();
    await api.answer('/account/addresses', { fail: true });
    await api.answer('/account/me', { body: { success: true, data: {} } });
    await api.answer('/commerce/loyalty-programme', { body: { success: true, data: { ...PROGRAMME, redemption: undefined } } });
    await api.answer('/locations/pickup-points', { body: { success: true, data: PICKUP } });
    const v = await run;
    expect(v).toMatchObject({ savedAddresses: [], accountEmail: '', defaultAddress: null, loyaltyAvailablePoints: 0, pickupPoints: PICKUP });
    expect(v.loyaltyProgramme).toEqual({ active: true, earnRatePer1000Ugx: 2, redemption: { configured: false } });
    expect(api.started).not.toContain('/account/loyalty');
  });
});
