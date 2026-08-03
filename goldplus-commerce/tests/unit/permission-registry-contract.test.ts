import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '../../packages/shared/src/permissions';
import {
  GOVERNANCE_ROLES,
  PLATFORM_ADMINISTRATOR_ROLE,
  registryPermissionRows,
  splitPermissionCode,
} from '../../apps/api/src/infrastructure/security/permissionRegistryContract';

/**
 * Guards the exact translation between permission codes and stored rows. A reversed or
 * last-dot split silently grants codes nothing checks for — the defect class behind the
 * 2026-08-03 recovery's hand-SQL incident (do-not-break ledger #11).
 */
describe('permission registry contract', () => {
  it('splits on the FIRST dot so multi-segment resources survive', () => {
    expect(splitPermissionCode('products.read')).toEqual({ action: 'products', resource: 'read' });
    expect(splitPermissionCode('analytics.alerts.manage')).toEqual({ action: 'analytics', resource: 'alerts.manage' });
  });

  it('rejects malformed codes instead of storing garbage', () => {
    expect(() => splitPermissionCode('nodot')).toThrow();
    expect(() => splitPermissionCode('.leading')).toThrow();
    expect(() => splitPermissionCode('trailing.')).toThrow();
  });

  it('reassembles every registry code exactly (round trip through action.resource)', () => {
    const rows = registryPermissionRows();
    const reassembled = rows.map((r) => `${r.action}.${r.resource}`).sort();
    const registry = [...new Set(Object.values(PERMISSIONS))].sort();
    expect(reassembled).toEqual(registry);
    // Column-width safety: every segment fits varchar(50).
    for (const r of rows) {
      expect(r.action.length).toBeLessThanOrEqual(50);
      expect(r.resource.length).toBeLessThanOrEqual(50);
    }
  });

  it('keeps the governance vocabulary anchored on PLATFORM_ADMINISTRATOR', () => {
    expect(GOVERNANCE_ROLES[0]).toBe(PLATFORM_ADMINISTRATOR_ROLE);
    expect(new Set(GOVERNANCE_ROLES).size).toBe(GOVERNANCE_ROLES.length);
    expect(GOVERNANCE_ROLES).toHaveLength(11);
  });
});
