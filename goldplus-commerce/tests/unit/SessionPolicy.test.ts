import { describe, it, expect } from 'vitest';
import {
  decideRefresh,
  sessionExpiries,
  isInvalidatedByCutoff,
  SESSION_LIFETIMES,
  type SessionRow,
} from '../../apps/api/src/domain/identity/SessionPolicy';

const base = (over: Partial<SessionRow> = {}): SessionRow => ({
  id: 's1',
  userId: 'u1',
  familyId: 'f1',
  rotatedAt: null,
  revokedAt: null,
  refreshExpiresAt: new Date('2999-01-01'),
  ...over,
});

describe('decideRefresh — refresh rotation state machine', () => {
  const now = new Date('2026-08-02T12:00:00Z');

  it('rotates a fresh, live credential', () => {
    expect(decideRefresh(base(), now).action).toBe('ROTATE');
  });

  it('treats an unknown hash as reuse (already rotated away, or never issued)', () => {
    expect(decideRefresh(null, now).action).toBe('REUSE_DETECTED');
  });

  it('treats a consumed credential as reuse', () => {
    expect(decideRefresh(base({ rotatedAt: new Date('2026-08-02T11:00:00Z') }), now).action).toBe(
      'REUSE_DETECTED',
    );
  });

  it('reports revoked before reuse so the reason is accurate', () => {
    const row = base({ revokedAt: new Date('2026-08-01'), rotatedAt: new Date('2026-08-01') });
    expect(decideRefresh(row, now).action).toBe('REVOKED');
  });

  it('reports expired before reuse', () => {
    const row = base({
      refreshExpiresAt: new Date('2026-08-01T00:00:00Z'),
      rotatedAt: new Date('2026-08-01'),
    });
    expect(decideRefresh(row, now).action).toBe('EXPIRED');
  });

  it('expires exactly at the boundary (<= now)', () => {
    expect(decideRefresh(base({ refreshExpiresAt: now }), now).action).toBe('EXPIRED');
  });
});

describe('sessionExpiries', () => {
  it('derives short access and long refresh windows from now', () => {
    const now = new Date('2026-08-02T12:00:00Z');
    const { accessExpiresAt, refreshExpiresAt } = sessionExpiries(now);
    expect(accessExpiresAt.getTime() - now.getTime()).toBe(SESSION_LIFETIMES.accessTtlMs);
    expect(refreshExpiresAt.getTime() - now.getTime()).toBe(SESSION_LIFETIMES.refreshTtlMs);
    expect(accessExpiresAt.getTime()).toBeLessThan(refreshExpiresAt.getTime());
  });
});

describe('isInvalidatedByCutoff — immediate hard revocation', () => {
  const issued = new Date('2026-08-02T12:00:00Z');
  it('kills a token issued at or before the cutoff', () => {
    expect(isInvalidatedByCutoff(issued, new Date('2026-08-02T12:00:00Z'))).toBe(true);
    expect(isInvalidatedByCutoff(issued, new Date('2026-08-02T12:00:01Z'))).toBe(true);
  });
  it('spares a token issued after the cutoff', () => {
    expect(isInvalidatedByCutoff(issued, new Date('2026-08-02T11:59:59Z'))).toBe(false);
  });
  it('no cutoff means no invalidation', () => {
    expect(isInvalidatedByCutoff(issued, null)).toBe(false);
    expect(isInvalidatedByCutoff(issued, undefined)).toBe(false);
  });
});
