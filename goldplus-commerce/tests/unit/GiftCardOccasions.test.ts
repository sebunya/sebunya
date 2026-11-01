import { describe, expect, it } from 'vitest';
import {
  GIFT_CARD_OCCASIONS, checkOccasionSettings, easterSunday, kampalaDay, orderOccasions,
} from '../../apps/api/src/domain/credit/GiftCardOccasions';
import { GiftCardOccasionUseCases } from '../../apps/api/src/application/use-cases/credit/GiftCardOccasionUseCases';

const EVERYDAY = ['gold', 'birthday', 'thanks', 'celebrate', 'love', 'anniversary'];
const all = (o: ReturnType<typeof orderOccasions>) => [...o.featured, ...o.more];

describe('gift card occasions: what comes first (Kampala calendar)', () => {
  it('an ordinary day (21 October): the everyday six; Father’s Day and Valentine’s wait under View all', () => {
    const o = orderOccasions('2026-10-21');
    expect(o.featured).toEqual(EVERYDAY);
    expect(o.more).toEqual(expect.arrayContaining(['fathers_day', 'valentine', 'christmas']));
    expect(o.labels).toEqual({});
  });

  it('every occasion stays selectable on every day of the year, exactly once', () => {
    for (let d = new Date('2026-01-01T00:00:00Z'); d < new Date('2028-01-01T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
      const o = orderOccasions(d.toISOString().slice(0, 10));
      expect(all(o).slice().sort()).toEqual([...GIFT_CARD_OCCASIONS].sort());
      expect(o.featured).toHaveLength(6);
      expect(o.featured).toEqual(expect.arrayContaining(['gold', 'birthday']));
      expect(o.featured.filter((id) => !EVERYDAY.includes(id)).length).toBeLessThanOrEqual(2);
    }
  });

  it('Christmas comes forward on 27 November, not the day before, and leaves after Christmas Day', () => {
    expect(orderOccasions('2026-11-26').featured).not.toContain('christmas');
    const start = orderOccasions('2026-11-27');
    expect(start.featured[0]).toBe('christmas');
    expect(start.labels.christmas).toBe('Coming up');
    expect(orderOccasions('2026-12-25').labels.christmas).toBe('Today');
    expect(orderOccasions('2026-12-26').featured).not.toContain('christmas');
  });

  it('the year-end overlap never fills the first view: two seasonal at most, Birthday and Thank you stay', () => {
    expect(orderOccasions('2026-12-20').featured).toEqual(['christmas', 'festive', 'gold', 'birthday', 'thanks', 'celebrate']);
    // Christmas is nearer than New Year; Season's greetings (no single day) gives way to both.
    expect(orderOccasions('2026-12-23').featured.slice(0, 2)).toEqual(['christmas', 'new_year']);
    const xmas = orderOccasions('2026-12-25');
    expect(xmas.featured.slice(0, 2)).toEqual(['christmas', 'new_year']);
    expect(xmas.labels).toEqual({ christmas: 'Today', new_year: 'Coming up' });
    expect(orderOccasions('2026-12-25').featured).toEqual(expect.arrayContaining(['birthday', 'thanks']));
  });

  it('December to January: New Year is "Today" on 1 January, Season’s greetings runs to 3 January, then the everyday six', () => {
    expect(orderOccasions('2026-12-31').featured.slice(0, 2)).toEqual(['new_year', 'festive']);
    const ny = orderOccasions('2027-01-01');
    expect(ny.featured.slice(0, 2)).toEqual(['new_year', 'festive']);
    expect(ny.labels.new_year).toBe('Today');
    expect(ny.labels.festive).toBeUndefined(); // a period has no single day: no label
    expect(orderOccasions('2027-01-03').featured[0]).toBe('festive');
    expect(orderOccasions('2027-01-04').featured).toEqual(EVERYDAY);
  });

  it('Valentine’s from 24 January (21 days) through 14 February; Mother’s and Father’s Day on Uganda’s Sundays', () => {
    expect(orderOccasions('2027-01-23').featured).not.toContain('valentine');
    expect(orderOccasions('2027-01-24').featured[0]).toBe('valentine');
    expect(orderOccasions('2027-02-14').labels.valentine).toBe('Today');
    expect(orderOccasions('2027-02-15').featured).not.toContain('valentine');
    expect(orderOccasions('2027-05-09').labels.mothers_day).toBe('Today'); // second Sunday of May 2027
    expect(orderOccasions('2027-04-24').featured).not.toContain('mothers_day');
    expect(orderOccasions('2027-04-25').featured).toContain('mothers_day'); // 14 days before
    expect(orderOccasions('2027-06-20').labels.fathers_day).toBe('Today'); // third Sunday of June 2027
  });

  it('Easter is computed exactly (Good Friday to Easter Monday) and is "Today" across the weekend', () => {
    expect([easterSunday(2026), easterSunday(2027), easterSunday(2028)]).toEqual(['2026-04-05', '2027-03-28', '2028-04-16']);
    expect(orderOccasions('2027-03-11').featured).not.toContain('easter');
    expect(orderOccasions('2027-03-12').labels.easter).toBe('Coming up'); // 14 days before Good Friday 26 March
    expect(orderOccasions('2027-03-27').labels.easter).toBe('Today');
    expect(orderOccasions('2027-03-29').labels.easter).toBe('Today'); // Easter Monday
    expect(orderOccasions('2027-03-30').featured).not.toContain('easter');
  });

  it('Eid is never promoted without verified dates; with them it comes forward 14 days before', () => {
    for (const day of ['2027-03-01', '2027-03-09', '2027-05-16']) expect(orderOccasions(day).featured).not.toContain('eid');
    const settings = { dates: [{ occasion: 'eid' as const, start: '2027-03-10', end: '2027-03-11', label: 'Eid al-Fitr' }] };
    expect(orderOccasions('2027-02-23', settings).featured).not.toContain('eid');
    expect(orderOccasions('2027-02-24', settings).featured[0]).toBe('eid');
    expect(orderOccasions('2027-03-10', settings).labels.eid).toBe('Today');
    expect(orderOccasions('2027-03-12', settings).featured).not.toContain('eid');
  });

  it('several at once: today first, then the nearest, then the fixed priority; the rest wait under View all', () => {
    // Eid on Easter weekend (a constructed overlap): both "Today", Easter wins the tie on priority order only if equal…
    const s = { dates: [{ occasion: 'eid' as const, start: '2027-03-27', end: '2027-03-28' }] };
    const o = orderOccasions('2027-03-27', s);
    expect(o.featured.slice(0, 2).sort()).toEqual(['easter', 'eid']);
    expect(o.labels).toEqual({ easter: 'Today', eid: 'Today' });
    // An occasion happening today beats one coming up sooner than another.
    const s2 = { dates: [{ occasion: 'eid' as const, start: '2027-03-14', end: '2027-03-15' }] };
    const o2 = orderOccasions('2027-03-14', s2);
    expect(o2.featured[0]).toBe('eid'); // today
    expect(o2.featured[1]).toBe('easter'); // coming up
    // Same day, same distance: the fixed priority decides, never chance.
    expect(orderOccasions('2027-03-14', s2)).toEqual(o2);
  });

  it('an owner adjustment features an occasion early or stops featuring it, only between its dates; it never removes it', () => {
    const early = { overrides: [{ occasion: 'christmas' as const, mode: 'feature' as const, from: '2026-11-01', to: '2026-12-25' }] };
    expect(orderOccasions('2026-11-10', early).featured[0]).toBe('christmas');
    expect(orderOccasions('2026-11-10', early).labels.christmas).toBeUndefined(); // not in its dated window yet
    const expired = { overrides: [{ occasion: 'christmas' as const, mode: 'feature' as const, from: '2026-10-01', to: '2026-10-20' }] };
    expect(orderOccasions('2026-10-21', expired).featured).toEqual(EVERYDAY);
    const hidden = { overrides: [{ occasion: 'christmas' as const, mode: 'hide' as const, from: '2026-12-01', to: '2026-12-10' }] };
    expect(orderOccasions('2026-12-05', hidden).featured).not.toContain('christmas');
    expect(all(orderOccasions('2026-12-05', hidden))).toContain('christmas');
    expect(orderOccasions('2026-12-11', hidden).featured).toContain('christmas'); // the hide ended
  });

  it('the settings are checked: no endless adjustments, no Eid dates without both days, windows within reason', () => {
    expect(checkOccasionSettings({ overrides: [{ occasion: 'christmas', mode: 'feature', from: '2026-01-01', to: '2026-12-31' }] }).ok).toBe(false);
    expect(checkOccasionSettings({ overrides: [{ occasion: 'christmas', mode: 'boost', from: '2026-11-01', to: '2026-11-02' }] }).ok).toBe(false);
    expect(checkOccasionSettings({ dates: [{ occasion: 'eid', start: '2027-03-10' }] }).ok).toBe(false);
    expect(checkOccasionSettings({ dates: [{ occasion: 'christmas', start: '2026-12-25', end: '2026-12-25' }] }).ok).toBe(false);
    expect(checkOccasionSettings({ windowDays: { christmas: 400 } }).ok).toBe(false);
    expect(checkOccasionSettings({ festivePeriod: { from: '12-10', to: '01-06' } }).ok).toBe(true);
    expect(orderOccasions('2027-01-05', { festivePeriod: { from: '12-10', to: '01-06' } }).featured[0]).toBe('festive');
  });

  it('Kampala days: 21:00 UTC on 26 November is already 27 November in Kampala', () => {
    expect(kampalaDay(new Date('2026-11-26T20:59:00Z'))).toBe('2026-11-26');
    expect(kampalaDay(new Date('2026-11-26T21:00:00Z'))).toBe('2026-11-27');
  });

  it('the order is read when the page opens: a settings change applies without a deploy (cached 30 s)', async () => {
    let stored: unknown = {};
    const uc = new GiftCardOccasionUseCases({ read: async () => stored, write: async (s) => { stored = s; } });
    expect((await uc.orderFor(new Date('2026-11-10T08:00:00Z'))).featured[0]).toBe('gold');
    expect((await uc.save({ overrides: [{ occasion: 'christmas', mode: 'feature', from: '2026-11-01', to: '2026-12-25' }] }, 'staff')).ok).toBe(true);
    expect((await uc.orderFor(new Date('2026-11-10T08:00:00Z'))).featured[0]).toBe('christmas');
  });
});
