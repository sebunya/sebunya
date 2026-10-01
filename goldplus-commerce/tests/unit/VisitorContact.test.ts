import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { QUOTE_LEAD_WINDOW_MS, quoteLeadContact, visitorAccount, withAccountContact } from '../../apps/api/src/infrastructure/advertising/VisitorContact';
import { buildAdRequest, hashEmail, hashPhone } from '../../apps/api/src/infrastructure/advertising/AdPlatforms';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');
const event: any = { event_name: 'add_to_cart', event_id: '11111111-1111-4111-8111-111111111111', event_time: 1790000000, source: 'browser', page_location: 'https://shopgoldplus.com/products/x',
  user_data: { fp_client_id: 'fp.1790841536221.11111111-1111-4111-8111-111111111111', user_agent: 'UA' }, ecommerce: { value: 45000, currency: 'UGX', items: [{ item_id: 'p1', price: 45000, quantity: 1 }] } };
const account = { userId: '22222222-2222-4222-8222-222222222222', email: ' Buyer@Example.com ', phone: '0772 123 456' };

describe('a signed-in customer\'s contact on Meta browsing events (owner decision 2026-10-01)', () => {
  it('the account is looked up by the visitor id; an event that already names a contact is left alone', async () => {
    const asked: string[] = [];
    const lookup = async (fp: string) => { asked.push(fp); return account; };
    expect(await visitorAccount(event, lookup)).toEqual(account);
    expect(asked).toEqual([event.user_data.fp_client_id]);
    expect(await visitorAccount({ ...event, user_data: { ...event.user_data, hashed_phone: 'd'.repeat(64) } }, lookup)).toBeNull();
    expect(await visitorAccount({ ...event, user_data: {} }, lookup)).toBeNull();
    expect(asked).toHaveLength(1);
  });
  it('email and phone are hashed as Meta specifies and sent as em and ph; an account with neither changes nothing', () => {
    const e = withAccountContact(event, account);
    expect(e.user_data).toMatchObject({ hashed_email: hashEmail('buyer@example.com'), hashed_phone: hashPhone('256772123456') });
    const sent = (buildAdRequest('meta', e, { datasetId: '1234567890123' }, 'T')!.body as any).data[0].user_data;
    expect(sent.em).toEqual([hashEmail('buyer@example.com')]);
    expect(sent.ph).toEqual([hashPhone('0772123456')]);
    expect(JSON.stringify(e)).not.toContain('Buyer@Example.com');
    expect(JSON.stringify(e)).not.toContain(account.userId);            // the account id itself never joins the event
    expect(withAccountContact(event, { userId: account.userId, email: null, phone: null })).toBe(event);
    expect(withAccountContact(event, null)).toBe(event);
  });
  it('Meta only, at send time, and the account\'s own advertising choice is asked', () => {
    const dispatch = read('apps/api/src/infrastructure/advertising/AdConversionDispatch.ts');
    expect(dispatch).toContain("if (platform === 'meta') account = await visitorAccount(event).catch(() => null);");
    expect(dispatch).toContain('advertisingRefused({ userId: event?.user_data?.user_id ?? account?.userId, fpClientId: event?.user_data?.fp_client_id })');
    expect(dispatch).toContain('withAccountContact(await withVisitorClickIds(event), quote ?? account)');
    expect(dispatch).toContain("const quote = platform === 'meta' ? await quoteLeadContact(event).catch(() => null) : null;");
    // The queue is written by the fan-out, which never sees the account.
    const fanOut = dispatch.slice(dispatch.indexOf('export async function fanOutAdConversions'), dispatch.indexOf('export async function processAdConversionBatch'));
    expect(fanOut).not.toMatch(/visitorAccount|withAccountContact|quoteLeadContact/);
  });
  it('a quote request made without signing in: its Lead carries the contact the request gave, only for a request just made', async () => {
    const lead: any = { ...event, event_name: 'generate_lead', ecommerce: undefined, lead: { method: 'quote_request', ref: 'BQ-7K3M9X' }, event_time: 1790000000 };
    const madeAt = new Date(1790000000 * 1000 - 20_000);
    const asked: string[] = [];
    const lookup = async (ref: string) => { asked.push(ref); return { email: 'Buyer@Example.com', phone: '0772 123 456', createdAt: madeAt }; };
    const c = await quoteLeadContact(lead, lookup);
    expect(c).toEqual({ userId: null, email: 'Buyer@Example.com', phone: '0772 123 456' });
    expect(asked).toEqual(['BQ-7K3M9X']);
    const sent = (buildAdRequest('meta', withAccountContact(lead, c), { datasetId: '1234567890123' }, 'T')!.body as any).data[0];
    expect(sent.event_name).toBe('Lead');
    expect(sent.user_data.em).toEqual([hashEmail('buyer@example.com')]);
    expect(sent.user_data.ph).toEqual([hashPhone('0772123456')]);
    // A reference from an old request (typed, or guessed) attaches nobody's details.
    expect(await quoteLeadContact(lead, async () => ({ email: 'x@example.com', phone: null, createdAt: new Date(1790000000 * 1000 - QUOTE_LEAD_WINDOW_MS - 1000) }))).toBeNull();
    expect(await quoteLeadContact(lead, async () => ({ email: 'x@example.com', phone: null, createdAt: new Date(1790000000 * 1000 + 5 * 60_000) }))).toBeNull();
    expect(await quoteLeadContact(lead, async () => null)).toBeNull();
    // Not a quote request, or no reference: nothing is looked up.
    const never = async () => { throw new Error('looked up'); };
    expect(await quoteLeadContact({ ...lead, lead: { method: 'whatsapp' } }, never)).toBeNull();
    expect(await quoteLeadContact({ ...lead, lead: { method: 'quote_request' } }, never)).toBeNull();
    expect(await quoteLeadContact(event, never)).toBeNull();
    expect(read('apps/web/src/lib/leadSignals.ts')).toContain("track('generate_lead', { lead: { method: 'quote_request', ref } });");
  });
});
