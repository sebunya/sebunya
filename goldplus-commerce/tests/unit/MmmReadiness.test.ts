import { describe, expect, it } from 'vitest';
import { readiness, toWeekly, type MmmDailyRow } from '../../apps/api/src/domain/measurement/MmmReadiness';
import { calendarControls, easterSunday, inSchoolTerm, publicHolidays } from '../../apps/api/src/domain/measurement/UgandaCalendar';

function days(from: string, n: number): string[] {
  const out: string[] = [];
  const t = new Date(`${from}T00:00:00Z`).getTime();
  for (let i = 0; i < n; i++) out.push(new Date(t + i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

describe('weekly aggregation', () => {
  it('drops incomplete first and last weeks and sums per ISO week', () => {
    // 2026-10-21 is a Wednesday: the first full week starts Monday 2026-10-26.
    const rows: MmmDailyRow[] = days('2026-10-21', 20).flatMap((day, i) => [
      { day, channel: 'direct', spendMinor: 0, orders: 1, revenueMinor: 1000 },
      { day, channel: 'meta', spendMinor: i % 2 ? 500 : 0, orders: 0, revenueMinor: 0 },
    ]);
    const weekly = toWeekly(rows);
    expect(weekly.map((w) => w.weekStart)).toEqual(['2026-10-26', '2026-11-02']);
    expect(weekly[0].orders).toBe(7);
    expect(weekly[0].revenueMinor).toBe(7000);
    expect(weekly[0].spendByChannel.meta).toBeGreaterThan(0);
    expect(weekly[0].spendByChannel.direct).toBeUndefined();
  });
});

describe('readiness', () => {
  const week = (i: number, spend: number, orders = 20) => ({ weekStart: `w${i}`, revenueMinor: orders * 50_000, orders, spendByChannel: spend > 0 ? { meta: spend } : {} });
  it('names zero paid spend as the reason, as GoldPlus stands today', () => {
    const r = readiness(Array.from({ length: 60 }, (_, i) => week(i, 0)));
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('No media channel has ever had spend'))).toBe(true);
  });
  it('too few weeks is a hard stop; 26 to 51 weeks is a warning only', () => {
    expect(readiness(Array.from({ length: 10 }, (_, i) => week(i, 100 + (i % 3) * 100))).ok).toBe(false);
    const r = readiness(Array.from({ length: 30 }, (_, i) => week(i, 100 + (i % 3) * 100)));
    expect(r.ok).toBe(true);
    expect(r.reasons.some((x) => x.includes('results will be weak'))).toBe(true);
  });
  it('flat spend has no variation to learn from', () => {
    const r = readiness(Array.from({ length: 60 }, (_, i) => week(i, 1000)));
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('variation'))).toBe(true);
  });
  it('thin orders and a single burst each fail', () => {
    expect(readiness(Array.from({ length: 60 }, (_, i) => week(i, 100 + (i % 3) * 100, 3))).reasons.some((x) => x.includes('Mean weekly orders'))).toBe(true);
    const burst = Array.from({ length: 60 }, (_, i) => week(i, i === 5 ? 100_000 : 100 + (i % 3) * 100));
    expect(readiness(burst).reasons.some((x) => x.includes('One week holds'))).toBe(true);
  });
  it('a varied, long, busy series passes', () => {
    const r = readiness(Array.from({ length: 80 }, (_, i) => week(i, 100 + (i % 5) * 150, 25)));
    expect(r.ok).toBe(true);
    expect(r.stats.mediaChannels).toEqual(['meta']);
  });
});

describe('Uganda calendar', () => {
  it('computes Easter and the moving holidays', () => {
    expect(easterSunday(2026).toISOString().slice(0, 10)).toBe('2026-04-05');
    const h = publicHolidays(2026);
    expect(h.get('2026-04-03')).toBe('Good Friday');
    expect(h.get('2026-04-06')).toBe('Easter Monday');
    expect(h.get('2026-10-09')).toBe('Independence Day');
    expect(h.get('2026-03-20')).toBe('Eid al-Fitr');
  });
  it('school terms have the three-term shape', () => {
    expect(inSchoolTerm('2026-01-10')).toBe(false);
    expect(inSchoolTerm('2026-03-10')).toBe(true);
    expect(inSchoolTerm('2026-05-15')).toBe(false);
    expect(inSchoolTerm('2026-07-01')).toBe(true);
    expect(inSchoolTerm('2026-12-20')).toBe(false);
    expect(calendarControls('2026-12-25')).toEqual({ holiday: 1, school_term: 0, holiday_name: 'Christmas Day' });
  });
});
