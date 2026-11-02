import { describe, expect, it } from 'vitest';
import { pinButton } from '../../../apps/api/src/domain/delivery/DeliveryPins';
import { ILocationPinRepository, LocationPinUseCases, PendingLocation } from '../../../apps/api/src/application/use-cases/delivery/LocationPinUseCases';

const ORDER = '2d0b6c9e-6a2e-4b9d-9f1c-1234567890ab';
const TASK = '4f2d8eb0-8c40-4dbf-b03e-34567890abcd';
const WAMID = 'wamid.ABC';
const OWNER = '+256772123456';
const RIDER = { id: 'r1', name: 'Musa' };
const NTINDA = { lat: 0.3467, lng: 32.6181 };

function harness() {
  const pending = new Map<string, PendingLocation>();
  const attached: any[] = [];
  const saved: string[] = [];
  const difficulty: any[] = [];
  const recorded: any[] = [];
  const repo: ILocationPinRepository = {
    openOrdersForPhone: async (phone) => (phone === OWNER ? [{ id: ORDER, orderNumber: 'GP-1', areaSlug: 'kampala-ntinda', areaLabel: 'Ntinda', customerId: 'u1', createdAt: new Date() }] : []),
    areaPoint: async () => ({ ...NTINDA, expectedErrorM: 500 }),
    activeOrigin: async () => ({ lat: 0.31422, lng: 32.57792 }),
    savePending: async (p) => void pending.set(p.wamid, p),
    pending: async (w) => pending.get(w) ?? null,
    consumePending: async (w) => pending.delete(w),
    riderOwnsTask: async (r, t) => r === RIDER.id && t === TASK,
    attachPin: async (p) => void attached.push(p),
    markCapturePinned: async () => undefined,
    savePinToAddress: async (o) => { saved.push(o); return 'saved'; },
    riderByPhone: async (p) => (p === '+256700000001' ? RIDER : null),
    openStopsForRider: async () => [{ taskId: TASK, orderId: ORDER, orderNumber: 'GP-1', areaSlug: null, areaLabel: null, attemptsSoFar: 0 }],
    copy: async () => null,
    retentionDays: async () => 180,
    flagDisagreement: async () => undefined,
  };
  const uc = new LocationPinUseCases(repo, {
    record: async (i) => { recorded.push(i); return { ok: true }; },
    setFindDifficulty: async (t, d) => void difficulty.push([t, d]),
  });
  return { uc, attached, saved, difficulty, recorded };
}

describe('WhatsApp pin buttons check who is tapping', () => {
  it('save: another phone cannot write the pin to the order owner address', async () => {
    const h = harness();
    expect((await h.uc.handleButton({ fromDigits: '256700000999', buttonId: pinButton.save(ORDER, true) })).outcome).toBe('wrong_phone');
    expect(h.saved).toEqual([]);
    expect((await h.uc.handleButton({ fromDigits: '256772123456', buttonId: pinButton.save(ORDER, true) })).outcome).toBe('saved');
  });

  it('find_difficulty: only the rider the stop was dispatched to', async () => {
    const h = harness();
    expect((await h.uc.handleButton({ fromDigits: '256772123456', buttonId: pinButton.findDifficulty(TASK, 'hard') })).outcome).toBe('wrong_phone');
    expect(h.difficulty).toEqual([]);
    expect((await h.uc.handleButton({ fromDigits: '256700000001', buttonId: pinButton.findDifficulty(TASK, 'easy') })).outcome).toBe('difficulty_recorded');
  });

  it('a confirm attaches once; a replayed tap finds the pending pin gone', async () => {
    const h = harness();
    await h.uc.handleLocation({ fromDigits: '256772123456', wamid: WAMID, ...NTINDA, forwarded: false });
    const id = pinButton.confirm(WAMID, ORDER, true);
    expect((await h.uc.handleButton({ fromDigits: '256772123456', buttonId: id })).outcome).toBe('attached');
    expect((await h.uc.handleButton({ fromDigits: '256772123456', buttonId: id })).outcome).toBe('expired');
    expect(h.attached).toHaveLength(1);
  });

  it('a handover records once', async () => {
    const h = harness();
    await h.uc.handleLocation({ fromDigits: '256700000001', wamid: WAMID, ...NTINDA, forwarded: false });
    const id = pinButton.handover(WAMID, TASK, 'delivered');
    expect((await h.uc.handleButton({ fromDigits: '256700000001', buttonId: id })).outcome).toBe('handover_recorded');
    expect((await h.uc.handleButton({ fromDigits: '256700000001', buttonId: id })).outcome).toBe('expired');
    expect(h.recorded).toHaveLength(1);
  });

  it('a forwarded location is never kept as a delivery point', async () => {
    const h = harness();
    const r = await h.uc.handleLocation({ fromDigits: '256772123456', wamid: WAMID, ...NTINDA, forwarded: true });
    expect(r.outcome).toBe('forwarded');
    expect((await h.uc.handleButton({ fromDigits: '256772123456', buttonId: pinButton.confirm(WAMID, ORDER, true) })).outcome).toBe('expired');
    expect(h.attached).toEqual([]);
  });
});
