import { describe, it, expect } from 'vitest';
import { requiresDistinctApprover, DEFAULT_PROMOTION_APPROVAL_POLICY as policy } from '../../../apps/api/src/domain/pricing/Pricing';

describe('FIXED_PRICE approval measures canonical minus the fixed price', () => {
  it('a fixed price of 5,000 on a 185,000 product (180,000 off) needs a second approver', () => {
    expect(requiresDistinctApprover([{ type: 'FIXED_PRICE', value: 5_000 } as any], policy, 185_000)).toBe(true);
  });
  it('a fixed price of 150,000 on a 185,000 product (35,000 off) does not', () => {
    expect(requiresDistinctApprover([{ type: 'FIXED_PRICE', value: 150_000 } as any], policy, 185_000)).toBe(false);
  });
  it('unknown scope price: fail safe, a second approver is required', () => {
    expect(requiresDistinctApprover([{ type: 'FIXED_PRICE', value: 150_000 } as any], policy)).toBe(true);
  });
  it('FIXED_AMOUNT_OFF unchanged', () => {
    expect(requiresDistinctApprover([{ type: 'FIXED_AMOUNT_OFF', value: 150_000 } as any], policy)).toBe(true);
    expect(requiresDistinctApprover([{ type: 'FIXED_AMOUNT_OFF', value: 50_000 } as any], policy)).toBe(false);
  });
});
