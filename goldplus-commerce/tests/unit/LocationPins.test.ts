import { describe, expect, it } from 'vitest';
import {
  buttonTitle,
  matchNumberedReply,
  numberedFallback,
  parsePinButton,
  pinButton,
  pinDisagreementKm,
  pinSanity,
  purgeDate,
} from '../../apps/api/src/domain/delivery/DeliveryPins';
import {
  ILocationPinRepository,
  LocationPinUseCases,
  OpenOrderForPin,
  PendingLocation,
} from '../../apps/api/src/application/use-cases/delivery/LocationPinUseCases';
import { LOCATION_PLACEHOLDER, parseInboundTexts } from '../../apps/api/src/domain/assistant/WhatsAppGoldie';

/**
 * 0190: a WhatsApp location pin becomes a delivery point only after the
 * customer confirms, never reaches the model, and a rider's phone is a
 * handover, not a customer pin.
 */
const ORDER = '2d0b6c9e-6a2e-4b9d-9f1c-1234567890ab';
const ORDER2 = '3e1c7daf-7b3f-4cae-af2d-234567890abc';
const TASK = '4f2d8eb0-8c40-4dbf-b03e-34567890abcd';
const WAMID = 'wamid.HBgLMjU2NzcyMTIzNDU2FQIAEhggQUJD';
const HUB = { lat: 0.31422, lng: 32.57792 };
const NTINDA = { lat: 0.3467, lng: 32.6181 };

function repoWith(opts: { orders?: OpenOrderForPin[]; rider?: { id: string; name: string } | null; stops?: Array<{ taskId: string; orderId: string; orderNumber: string }> } = {}) {
  const pending = new Map<string, PendingLocation>();
  const attached: any[] = [];
  const captures: any[] = [];
  const saved: string[] = [];
  const flags: any[] = [];
  const repo: ILocationPinRepository = {
    openOrdersForPhone: async () => opts.orders ?? [],
    areaPoint: async () => ({ lat: NTINDA.lat, lng: NTINDA.lng, expectedErrorM: 587 }),
    activeOrigin: async () => HUB,
    savePending: async (p) => {
      pending.set(p.wamid, p);
    },
    pending: async (w) => pending.get(w) ?? null,
    attachPin: async (p) => {
      attached.push(p);
    },
    markCapturePinned: async (orderId, source) => {
      captures.push([orderId, source]);
    },
    savePinToAddress: async (orderId) => {
      saved.push(orderId);
      return 'saved';
    },
    riderByPhone: async () => opts.rider ?? null,
    openStopsForRider: async () => (opts.stops ?? []).map((s) => ({ ...s, areaSlug: 'kampala-ntinda', areaLabel: 'Ntinda', attemptsSoFar: 0 })),
    copy: async () => null,
    retentionDays: async () => 180,
    flagDisagreement: async (f) => {
      flags.push(f);
    },
  };
  return { repo, pending, attached, captures, saved, flags };
}
const order = (id: string, n: string, customerId: string | null = 'u1'): OpenOrderForPin => ({ id, orderNumber: n, areaSlug: 'kampala-ntinda', areaLabel: 'Ntinda', customerId, createdAt: new Date() });

describe('pin rules', () => {
  it('refuses a pin outside Uganda or at the shop, and measures disagreement with the area', () => {
    expect(pinSanity({ lat: -1.29, lng: 36.82 }, HUB)).toBe('outside_uganda');
    expect(pinSanity({ lat: 0.3143, lng: 32.5780 }, HUB)).toBe('at_shop');
    expect(pinSanity(NTINDA, HUB)).toBeNull();
    expect(pinDisagreementKm(NTINDA, NTINDA)).toBe(0);
    expect(pinDisagreementKm(HUB, NTINDA)).toBeGreaterThan(5);
    expect(pinDisagreementKm(HUB, null)).toBeNull();
  });
  it('button ids round-trip and a typed word is never an answer', () => {
    expect(parsePinButton(pinButton.confirm(WAMID, ORDER, true))).toEqual({ kind: 'confirm', wamid: WAMID, orderId: ORDER, yes: true });
    expect(parsePinButton(pinButton.whichOrder(WAMID, ORDER))).toEqual({ kind: 'which_order', wamid: WAMID, orderId: ORDER });
    expect(parsePinButton(pinButton.save(ORDER, false))).toEqual({ kind: 'save', orderId: ORDER, yes: false });
    expect(parsePinButton(pinButton.handover(WAMID, TASK, 'notfound'))).toEqual({ kind: 'handover', wamid: WAMID, taskId: TASK, outcome: 'notfound' });
    expect(parsePinButton(pinButton.findDifficulty(TASK, 'hard'))).toEqual({ kind: 'find_difficulty', taskId: TASK, difficulty: 'hard' });
    expect(parsePinButton('Delivered')).toBeNull();
    expect(parsePinButton('locok:x:y:z')).toBeNull();
  });
  it('titles fit the Cloud API and the numbered fallback maps back', () => {
    expect(buttonTitle('Customer not there').length).toBeLessThanOrEqual(20);
    const buttons = [{ id: 'a', title: 'Yes' }, { id: 'b', title: 'No' }];
    expect(numberedFallback('Deliver here?', buttons)).toContain('2. No');
    expect(matchNumberedReply(' 2 ', buttons)?.id).toBe('b');
    expect(matchNumberedReply('3', buttons)).toBeNull();
  });
  it('purge date respects the 30–365 day bounds', () => {
    const t = new Date('2026-10-15T00:00:00Z');
    expect(purgeDate(t, 180).toISOString()).toBe('2027-04-13T00:00:00.000Z');
    expect(purgeDate(t, 5).getTime() - t.getTime()).toBe(30 * 86_400_000);
    expect(purgeDate(t, Number.NaN).getTime() - t.getTime()).toBe(180 * 86_400_000);
  });
});

describe('the WhatsApp parser carries a location structured, with a placeholder as the words', () => {
  const payload = (msg: Record<string, unknown>) => ({
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA1', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '12345' }, messages: [{ from: '256772123456', id: WAMID, timestamp: '1760000000', ...msg }] } }] }],
  });
  it('a location message', () => {
    const [m] = parseInboundTexts(payload({ type: 'location', location: { latitude: 0.3467, longitude: 32.6181, name: 'Home', address: 'Plot 5' }, context: { forwarded: true } }), 'WABA1', new Date(1760000100000));
    expect(m.text).toBe(LOCATION_PLACEHOLDER);
    expect(m.location).toEqual({ lat: 0.3467, lng: 32.6181, forwarded: true });
    expect(JSON.stringify(m)).not.toContain('Plot 5');
  });
  it('a reply-button tap keeps the id', () => {
    const [m] = parseInboundTexts(payload({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: pinButton.confirm(WAMID, ORDER, true), title: 'Yes, deliver here' } } }), 'WABA1', new Date(1760000100000));
    expect(m.button?.id).toBe(pinButton.confirm(WAMID, ORDER, true));
    expect(m.text).toBe('Yes, deliver here');
  });
});

describe('a customer pin', () => {
  it('is refused with nothing stored when it is at the shop', async () => {
    const h = repoWith({ orders: [order(ORDER, 'GP-1001')] });
    const r = await new LocationPinUseCases(h.repo).handleLocation({ fromDigits: '256772123456', wamid: WAMID, lat: HUB.lat, lng: HUB.lng, forwarded: false });
    expect(r.outcome).toBe('rejected');
    expect(h.pending.size).toBe(0);
  });
  it('with no open order: told, nothing stored', async () => {
    const h = repoWith();
    const r = await new LocationPinUseCases(h.repo).handleLocation({ fromDigits: '256772123456', wamid: WAMID, ...NTINDA, forwarded: false });
    expect(r.outcome).toBe('no_order');
    expect(h.attached).toEqual([]);
  });
  it('with one open order: asks "deliver here?", and only Yes attaches the pin, marks the capture PIN and offers to save', async () => {
    const h = repoWith({ orders: [order(ORDER, 'GP-1001')] });
    const uc = new LocationPinUseCases(h.repo);
    const asked = await uc.handleLocation({ fromDigits: '256772123456', wamid: WAMID, ...NTINDA, forwarded: false });
    expect(asked.outcome).toBe('asked_confirm');
    expect(asked.reply.text).toContain('GP-1001');
    expect(asked.reply.buttons?.map((b) => b.title)).toEqual(['Yes, deliver here', "No, it's elsewhere"]);
    expect(h.attached).toEqual([]);
    const no = await uc.handleButton({ fromDigits: '256772123456', buttonId: pinButton.confirm(WAMID, ORDER, false) });
    expect(no.outcome).toBe('declined');
    expect(h.attached).toEqual([]);
    const yes = await uc.handleButton({ fromDigits: '256772123456', buttonId: pinButton.confirm(WAMID, ORDER, true) });
    expect(yes.outcome).toBe('attached');
    expect(h.attached[0]).toMatchObject({ orderId: ORDER, source: 'whatsapp', sourceRef: WAMID, lat: NTINDA.lat });
    expect(h.attached[0].confirmedAt).toBeInstanceOf(Date);
    expect(h.captures).toEqual([[ORDER, 'whatsapp']]);
    expect(yes.reply?.buttons?.map((b) => b.title)).toEqual(['Save for next time', "Don't save"]);
    expect(h.saved).toEqual([]);
    const save = await uc.handleButton({ fromDigits: '256772123456', buttonId: pinButton.save(ORDER, true) });
    expect(save.outcome).toBe('saved');
    expect(h.saved).toEqual([ORDER]);
  });
  it('a guest (no account) is never asked to save', async () => {
    const h = repoWith({ orders: [order(ORDER, 'GP-1001', null)] });
    const uc = new LocationPinUseCases(h.repo);
    await uc.handleLocation({ fromDigits: '256772123456', wamid: WAMID, ...NTINDA, forwarded: false });
    const yes = await uc.handleButton({ fromDigits: '256772123456', buttonId: pinButton.confirm(WAMID, ORDER, true) });
    expect(yes.outcome).toBe('attached');
    expect(yes.reply?.buttons).toBeUndefined();
  });
  it('a tap from another phone, or on a stale question, changes nothing', async () => {
    const h = repoWith({ orders: [order(ORDER, 'GP-1001')] });
    const uc = new LocationPinUseCases(h.repo, null, () => new Date('2026-10-15T10:00:00Z'));
    await uc.handleLocation({ fromDigits: '256772123456', wamid: WAMID, ...NTINDA, forwarded: false });
    expect((await uc.handleButton({ fromDigits: '256700000000', buttonId: pinButton.confirm(WAMID, ORDER, true) })).outcome).toBe('wrong_phone');
    const late = new LocationPinUseCases(h.repo, null, () => new Date('2026-10-17T10:00:00Z'));
    expect((await late.handleButton({ fromDigits: '256772123456', buttonId: pinButton.confirm(WAMID, ORDER, true) })).outcome).toBe('expired');
    expect(h.attached).toEqual([]);
  });
  it('with two open orders: asks which, then confirms that one', async () => {
    const h = repoWith({ orders: [order(ORDER, 'GP-1001'), order(ORDER2, 'GP-1002')] });
    const uc = new LocationPinUseCases(h.repo);
    const which = await uc.handleLocation({ fromDigits: '256772123456', wamid: WAMID, ...NTINDA, forwarded: false });
    expect(which.outcome).toBe('asked_which');
    expect(which.reply.buttons?.map((b) => b.title)).toEqual(['GP-1001', 'GP-1002']);
    const pick = await uc.handleButton({ fromDigits: '256772123456', buttonId: pinButton.whichOrder(WAMID, ORDER2) });
    expect(pick.outcome).toBe('asked_confirm');
    expect(pick.reply?.text).toContain('GP-1002');
  });
  it('a pin far from the chosen area is flagged for a person, and the fee is not touched', async () => {
    const h = repoWith({ orders: [order(ORDER, 'GP-1001')] });
    const uc = new LocationPinUseCases(h.repo);
    const far = { lat: 0.05, lng: 32.45 }; // Entebbe side, ~20 km from Ntinda
    await uc.handleLocation({ fromDigits: '256772123456', wamid: WAMID, ...far, forwarded: false });
    const yes = await uc.handleButton({ fromDigits: '256772123456', buttonId: pinButton.confirm(WAMID, ORDER, true) });
    expect(yes.outcome).toBe('attached');
    expect(h.flags[0]).toMatchObject({ orderId: ORDER, orderNumber: 'GP-1001' });
    expect(h.flags[0].km).toBeGreaterThan(5);
    expect(yes.reply?.text).toMatch(/some way from Ntinda/);
  });
});

describe('a rider pin', () => {
  const rider = { id: '5a3e9fc1-9d51-4ec0-c14f-4567890abcde', name: 'Musa' };
  it('with one stop out: asks how it went; Delivered records the attempt with the point, attaches the pin and asks about finding it', async () => {
    const h = repoWith({ rider, stops: [{ taskId: TASK, orderId: ORDER, orderNumber: 'GP-1001' }] });
    const recorded: any[] = [];
    const difficulties: any[] = [];
    const uc = new LocationPinUseCases(h.repo, {
      record: async (i) => {
        recorded.push(i);
        return { ok: true };
      },
      setFindDifficulty: async (t, d) => {
        difficulties.push([t, d]);
      },
    });
    const asked = await uc.handleLocation({ fromDigits: '256700000001', wamid: WAMID, ...NTINDA, forwarded: false });
    expect(asked.outcome).toBe('rider_asked');
    expect(asked.reply.buttons?.map((b) => b.title)).toEqual(['Delivered', 'Customer not there', "Couldn't find it"]);
    const done = await uc.handleButton({ fromDigits: '256700000001', buttonId: pinButton.handover(WAMID, TASK, 'delivered') });
    expect(done.outcome).toBe('handover_recorded');
    expect(recorded[0]).toMatchObject({ taskId: TASK, outcome: 'delivered', point: NTINDA });
    expect(h.attached[0]).toMatchObject({ orderId: ORDER, source: 'rider' });
    expect(h.captures).toEqual([[ORDER, 'rider']]);
    expect(done.reply?.buttons?.map((b) => b.title)).toEqual(['Easy to find', 'Hard to find']);
    await uc.handleButton({ fromDigits: '256700000001', buttonId: pinButton.findDifficulty(TASK, 'hard') });
    expect(difficulties).toEqual([[TASK, 'hard']]);
  });
  it('a failed attempt records no pin', async () => {
    const h = repoWith({ rider, stops: [{ taskId: TASK, orderId: ORDER, orderNumber: 'GP-1001' }] });
    const uc = new LocationPinUseCases(h.repo, { record: async () => ({ ok: true }), setFindDifficulty: async () => undefined });
    await uc.handleLocation({ fromDigits: '256700000001', wamid: WAMID, ...NTINDA, forwarded: false });
    const r = await uc.handleButton({ fromDigits: '256700000001', buttonId: pinButton.handover(WAMID, TASK, 'absent') });
    expect(r.outcome).toBe('handover_recorded');
    expect(h.attached).toEqual([]);
  });
  it('with no stop out: told, nothing stored; a rider at the hub is refused like anyone', async () => {
    const h = repoWith({ rider, stops: [] });
    const uc = new LocationPinUseCases(h.repo);
    expect((await uc.handleLocation({ fromDigits: '256700000001', wamid: WAMID, ...NTINDA, forwarded: false })).outcome).toBe('rider_no_stop');
    expect((await uc.handleLocation({ fromDigits: '256700000001', wamid: WAMID, ...HUB, forwarded: false })).outcome).toBe('rejected');
  });
});
