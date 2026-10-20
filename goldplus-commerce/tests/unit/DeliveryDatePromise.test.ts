import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deliveryHoursEndMinutes, deliveryPromise } from '../../apps/api/src/domain/delivery/DeliveryPresentation';

// Kampala is UTC+3: 10:00 EAT = 07:00Z.
const at = (eat: string) => new Date(`${eat.replace(' ', 'T')}:00+03:00`);
const HOURS = '8:30am to 8:00pm';
const measured = { kind: 'hours' as const, lowMinutes: 45, highMinutes: 120, sampleSize: 40 };

describe('dated delivery promise (gap #4)', () => {
  it('before the cut-off: dispatched today with the time left, and a measured arrival window on the clock', () => {
    const p = deliveryPromise({ now: at('2026-10-20 14:50'), cutoffHour: 17, closedDays: [], window: measured, deliveryHoursText: HOURS })!;
    expect(p.dispatchToday).toBe(true);
    expect(p.dispatchSentence).toBe('Order within 2 hours 10 min and it is dispatched today, Tue 20 Oct.');
    // Earliest 14:50 + 45 = 15:35 -> 15:30; latest 17:00 + 120 = 19:00.
    expect(p.arrivalSentence).toBe('Arrives today, usually between 3:30pm and 7:00pm.');
  });

  it('no arrival window without a measured one: the contract never invents a range', () => {
    const p = deliveryPromise({ now: at('2026-10-20 10:00'), cutoffHour: 17, closedDays: [], window: { kind: 'day', note: 'insufficient_sample' }, deliveryHoursText: HOURS })!;
    expect(p.dispatchSentence).toContain('dispatched today, Tue 20 Oct');
    expect(p.arrivalSentence).toBeNull();
  });

  it('no arrival window when the slowest measured trip would end after delivery hours', () => {
    const slow = { ...measured, highMinutes: 240 };
    expect(deliveryPromise({ now: at('2026-10-20 10:00'), cutoffHour: 17, closedDays: [], window: slow, deliveryHoursText: HOURS })!.arrivalSentence).toBeNull();
  });

  it('after the cut-off, or on a closed day: the next dispatch day by date, and no clock window', () => {
    const late = deliveryPromise({ now: at('2026-10-20 18:30'), cutoffHour: 17, closedDays: [], window: measured, deliveryHoursText: HOURS })!;
    expect(late).toMatchObject({ dispatchDay: '2026-10-21', dispatchToday: false, arrivalSentence: null });
    expect(late.dispatchSentence).toBe('Order now and it is dispatched tomorrow (Wed 21 Oct).');
    // Saturday evening with Sundays closed: Monday.
    const weekend = deliveryPromise({ now: at('2026-10-24 18:00'), cutoffHour: 17, closedDays: [0], window: measured, deliveryHoursText: HOURS })!;
    expect(weekend.dispatchSentence).toBe('Order now and it is dispatched on Mon 26 Oct.');
  });

  it('nothing without a cut-off, and delivery hours are read from the owner-set words', () => {
    expect(deliveryPromise({ now: at('2026-10-20 10:00'), cutoffHour: null, closedDays: [], window: measured, deliveryHoursText: HOURS })).toBeNull();
    expect(deliveryHoursEndMinutes('8:30am to 8:00pm')).toBe(1200);
    expect(deliveryHoursEndMinutes('8am to 6pm')).toBe(1080);
    expect(deliveryHoursEndMinutes('All day')).toBeNull();
  });

  it('the quote returns it and the panel shows it, with no dash in the customer sentences', () => {
    expect(readFileSync(new URL('../../apps/api/src/interfaces/http/routes/delivery.ts', import.meta.url), 'utf8')).toContain('promise: biz');
    expect(readFileSync(new URL('../../apps/web/src/lib/deliveryQuotePanel.ts', import.meta.url), 'utf8')).toContain('data-arrival-window');
    const p = deliveryPromise({ now: at('2026-10-20 14:50'), cutoffHour: 17, closedDays: [], window: measured, deliveryHoursText: HOURS })!;
    expect(`${p.dispatchSentence}${p.arrivalSentence}`).not.toMatch(/[–—]/);
  });
});
