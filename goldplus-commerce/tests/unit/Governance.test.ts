import { expect, test, describe } from 'vitest';
import { AuditLog } from '../../apps/api/src/domain/governance/AuditLog';

describe('AuditLog Domain Entity', () => {
  test('Should create audit log with correct properties', () => {
    const log = AuditLog.log(
      'a1', 
      'admin1', 
      'product_approval', 
      'p1', 
      { status: 'draft' }, 
      { status: 'approved' }
    );

    expect(log.actorId).toBe('admin1');
    expect(log.action).toBe('product_approval');
    expect(log.entityId).toBe('p1');
    expect(log.previousState.status).toBe('draft');
    expect(log.newState.status).toBe('approved');
  });
});
