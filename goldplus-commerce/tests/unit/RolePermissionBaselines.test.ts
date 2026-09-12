import { describe, expect, it } from 'vitest';
import {
  FULL_ACCESS_ROLES,
  GOVERNANCE_ROLES,
  PERMISSIONS,
  PLATFORM_ADMINISTRATOR_ROLE,
  ROLE_DESCRIPTIONS,
  ROLE_NAME_PATTERN,
  ROLE_PERMISSION_BASELINES,
} from '@goldplus/shared';

/**
 * The role baselines (2026-09-12) are what a governance role holds the first
 * time it is seen empty. They must be complete, honest and safe: every role
 * has one, every code is real, read-only roles carry no write, and the
 * access-management rights sit only where a person is meant to manage access.
 */
const registry = new Set<string>(Object.values(PERMISSIONS));
// Exports hand data out; they change nothing, so they count as read here.
const isWrite = (code: string) => !/\.(read|view|read_private|export)$/.test(code);

describe('role permission baselines', () => {
  it('every governance role has a baseline, and every baseline code is in the registry', () => {
    for (const role of GOVERNANCE_ROLES) {
      const codes = ROLE_PERMISSION_BASELINES[role];
      expect(Array.isArray(codes), role).toBe(true);
      for (const code of codes) expect(registry.has(code), `${role}: ${code}`).toBe(true);
      expect(new Set(codes).size, `${role} duplicates`).toBe(codes.length);
    }
  });

  it('PLATFORM_ADMINISTRATOR is the whole registry; nobody else is', () => {
    expect(new Set(ROLE_PERMISSION_BASELINES[PLATFORM_ADMINISTRATOR_ROLE])).toEqual(registry);
    for (const role of GOVERNANCE_ROLES) {
      if (role === PLATFORM_ADMINISTRATOR_ROLE) continue;
      expect(ROLE_PERMISSION_BASELINES[role].length, role).toBeLessThan(registry.size);
      expect(ROLE_PERMISSION_BASELINES[role].length, role).toBeGreaterThan(0);
    }
  });

  it('READ_ONLY_AUDITOR and ANALYST carry no write right', () => {
    for (const role of ['READ_ONLY_AUDITOR', 'ANALYST'] as const) {
      const writes = ROLE_PERMISSION_BASELINES[role].filter(isWrite);
      expect(writes, role).toEqual([]);
    }
  });

  it('auth.manage and roles.manage sit only with the platform administrator and the security administrator', () => {
    for (const role of GOVERNANCE_ROLES) {
      const has = ROLE_PERMISSION_BASELINES[role].some((c) => c === PERMISSIONS.AUTH_MANAGE || c === PERMISSIONS.ROLES_MANAGE);
      expect(has, role).toBe(role === PLATFORM_ADMINISTRATOR_ROLE || role === 'SECURITY_ADMIN');
    }
  });

  it('supplier cost never reaches a role that is not commercial or full-access', () => {
    for (const role of GOVERNANCE_ROLES) {
      const sees = ROLE_PERMISSION_BASELINES[role].includes(PERMISSIONS.PRODUCT_COSTS_READ);
      expect(sees, role).toBe(['PLATFORM_ADMINISTRATOR', 'COMMERCIAL_MANAGER', 'READ_ONLY_AUDITOR'].includes(role));
    }
  });

  it('refunds and payment confirmation stay with full access only in the baselines', () => {
    for (const role of GOVERNANCE_ROLES) {
      if (role === PLATFORM_ADMINISTRATOR_ROLE) continue;
      expect(ROLE_PERMISSION_BASELINES[role]).not.toContain(PERMISSIONS.PAYMENTS_REFUND);
      expect(ROLE_PERMISSION_BASELINES[role]).not.toContain(PERMISSIONS.PAYMENTS_CONFIRM);
    }
  });

  it('every role, including the legacy Owner, has a description; system roles are the two full-access roles; names follow the pattern', () => {
    for (const role of GOVERNANCE_ROLES) expect(ROLE_DESCRIPTIONS[role], role).toBeTruthy();
    expect(ROLE_DESCRIPTIONS.Owner).toBeTruthy();
    expect([...FULL_ACCESS_ROLES]).toEqual([PLATFORM_ADMINISTRATOR_ROLE, 'Owner']);
    for (const role of GOVERNANCE_ROLES) expect(ROLE_NAME_PATTERN.test(role), role).toBe(true);
    expect(ROLE_NAME_PATTERN.test('support lead')).toBe(false);
    expect(ROLE_NAME_PATTERN.test('1ROLE')).toBe(false);
  });
});
