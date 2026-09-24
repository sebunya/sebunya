import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kampalaCutoff } from '@goldplus/shared';
import { businessCutoffCountdown } from '../../apps/api/src/domain/delivery/DeliveryPresentation';

/**
 * Sunday 14:00 EAT (closed per business_info): checkout said "Closed today" while
 * the quote panel under it said "Order within 3 hours 0 min for dispatch today",
 * because the panel read a second cutoff authority that ignored closed days.
 */
const SUNDAY_1400_EAT = new Date('2026-09-27T11:00:00Z');
const MONDAY_1400_EAT = new Date('2026-09-28T11:00:00Z');

describe('the quote cutoff comes from business info', () => {
  it('never promises dispatch today on a closed day, agreeing with the header', () => {
    const c = businessCutoffCountdown({ now: SUNDAY_1400_EAT, cutoffHour: 17, closedDays: [0] });
    expect(c?.beforeCutoff).toBe(false);
    expect(c?.sentence).not.toMatch(/for dispatch today|Order within/);
    expect(c?.sentence).toContain('next dispatch day');
    expect(kampalaCutoff(SUNDAY_1400_EAT, { cutoffHour: 17, closedDays: [0] }).closed).toBe(true);
  });

  it('counts down to the business cutoff hour on an open day', () => {
    const c = businessCutoffCountdown({ now: MONDAY_1400_EAT, cutoffHour: 17, closedDays: [0] });
    expect(c).toMatchObject({ cutoffClock: '17:00', beforeCutoff: true, minutesRemaining: 180 });
    expect(c?.sentence).not.toMatch(/[–—]/);
  });

  it('the public quote route reads business info, not the retired config key', () => {
    const route = readFileSync(join(__dirname, '../../apps/api/src/interfaces/http/routes/delivery.ts'), 'utf8');
    expect(route).toContain('businessCutoffCountdown({ now, cutoffHour: biz.sameDayCutoffHour, closedDays: biz.closedDays })');
    expect(route).not.toContain('raw.same_day_cutoff_eat');
  });
});
