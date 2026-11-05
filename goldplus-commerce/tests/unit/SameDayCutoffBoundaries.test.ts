import { describe, it, expect } from 'vitest';
import { kampalaCutoff } from '@goldplus/shared';
import { sameDayCutoffCopy } from '../../apps/web/src/lib/checkout';

// Brief WP3 item 2: the same-day line just before, at and after the cut-off, on Saturday and on
// Sunday, in Kampala time (UTC+3). Defaults: cut-off 17:00, closed Sunday (business_info overrides).
// 2026-11-02 is a Monday, 2026-11-07 a Saturday, 2026-11-08 a Sunday.
const at = (iso: string) => new Date(`${iso}+03:00`);
const cfg = { cutoffHour: 17, closedDays: [0] };
const line = (iso: string) => {
  const now = at(iso);
  const c = kampalaCutoff(now, cfg);
  return { c, copy: sameDayCutoffCopy(c, { now, closedDays: cfg.closedDays }) };
};

describe('same-day cut-off boundaries (Africa/Kampala)', () => {
  it('one minute before the cut-off still makes today\'s run', () => {
    const { c, copy } = line('2026-11-02T16:59:00');
    expect(c.beforeCutoff).toBe(true);
    expect(c.minsToCutoff).toBe(1);
    expect(copy.inArea).toContain('go out today');
  });
  it('at the cut-off the run has left and the next day is named', () => {
    const { c, copy } = line('2026-11-02T17:00:00');
    expect(c.beforeCutoff).toBe(false);
    expect(copy.inArea).toBe("Today's run has left. This goes out tomorrow morning");
  });
  it('after the cut-off the same', () => {
    expect(line('2026-11-02T17:01:00').c.beforeCutoff).toBe(false);
  });
  it('Saturday before the cut-off dispatches today', () => {
    const { c } = line('2026-11-07T10:00:00');
    expect(c.closed).toBe(false);
    expect(c.beforeCutoff).toBe(true);
    expect(c.tomorrowClosed).toBe(true);
  });
  it('Saturday after the cut-off names Monday, never "tomorrow"', () => {
    expect(line('2026-11-07T17:30:00').copy.inArea).toBe("Today's run has left. This goes out on Monday morning");
  });
  it('Sunday is closed and names Monday', () => {
    const { c, copy } = line('2026-11-08T10:00:00');
    expect(c.closed).toBe(true);
    expect(c.beforeCutoff).toBe(false);
    expect(copy.inArea).toBe('Closed today. This goes out tomorrow morning');
  });
  it('no line promises arrival: dispatch only (delivery contract #10)', () => {
    for (const iso of ['2026-11-02T16:00:00', '2026-11-02T16:30:00', '2026-11-07T12:00:00']) {
      const { copy } = line(iso);
      for (const s of Object.values(copy)) expect(s).not.toMatch(/arrives today|delivered today|same-day delivery/i);
    }
  });
});
