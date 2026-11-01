import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Nav telemetry guard rails (§10) with the DB stubbed. Two guarantees:
 *  1. capture() sanitises-or-rejects at the boundary — a bad event never reaches
 *     the insert (the DB is never called for it).
 *  2. capture() NEVER throws — telemetry must not break a page interaction, even
 *     when the database itself is down.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../apps/api/src/infrastructure/db/client', () => ({ db: { execute }, client: {} }));

import { NavTelemetryService } from '../../apps/api/src/infrastructure/nav/NavTelemetryService';

const svc = new NavTelemetryService();
const base = { eventType: 'NBA_CLICK', itemKey: 'welcome', position: 0, segment: 'new', term: null, profileId: null };

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([]);
});

describe('capture — sanitise or reject at the boundary', () => {
  it('records a valid event and hits the DB exactly once', async () => {
    expect(await svc.capture({ ...base })).toEqual({ recorded: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('records the keyless events (empty item key is allowed)', async () => {
    expect(await svc.capture({ ...base, eventType: 'MINICART_OPEN', itemKey: '' })).toEqual({ recorded: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown event type without touching the DB', async () => {
    expect(await svc.capture({ ...base, eventType: 'DROP_TABLE' })).toEqual({ recorded: false });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['uppercase', 'Welcome'],
    ['leading digit', '1welcome'],
    ['a space', 'wel come'],
    ['too long', 'a'.repeat(33)],
  ])('rejects an item key with %s without touching the DB', async (_label, itemKey) => {
    expect(await svc.capture({ ...base, itemKey })).toEqual({ recorded: false });
    expect(execute).not.toHaveBeenCalled();
  });

  it('accepts (does not reject) an unknown segment — it is normalised, not refused', async () => {
    expect(await svc.capture({ ...base, segment: 'martian' })).toEqual({ recorded: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('accepts an out-of-range position — it is clamped, not refused', async () => {
    expect(await svc.capture({ ...base, position: 9999 })).toEqual({ recorded: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('capture — never throws', () => {
  it('swallows a database failure and reports not-recorded', async () => {
    execute.mockRejectedValueOnce(new Error('connection refused'));
    await expect(svc.capture({ ...base })).resolves.toEqual({ recorded: false });
  });
});
