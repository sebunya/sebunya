import { describe, it, expect } from 'vitest';
import { authorizeActivationApproval } from '../../apps/api/src/domain/activation/SeparationOfDuties';

describe('authorizeActivationApproval — two-person integrity', () => {
  it('denies the requester approving their own activation', () => {
    const r = authorizeActivationApproval('admin-1', 'admin-1');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/separation of duties/i);
  });

  it('allows a different admin to approve', () => {
    expect(authorizeActivationApproval('admin-1', 'admin-2').allowed).toBe(true);
  });

  it('denies a missing approver', () => {
    expect(authorizeActivationApproval('admin-1', '').allowed).toBe(false);
    expect(authorizeActivationApproval('admin-1', null).allowed).toBe(false);
  });

  it('allows when the requester is unknown (cannot prove a collision)', () => {
    // A legacy request with no recorded requester must not be un-approvable.
    expect(authorizeActivationApproval(null, 'admin-2').allowed).toBe(true);
  });
});
