import { describe, it, expect } from 'vitest';
import { hashCustomerPhoneIdentity } from '../../../apps/api/src/domain/pricing/CustomerIdentity';

describe('first-order identity hashes the E.164 phone', () => {
  it('every spelling of one Ugandan number is one identity', () => {
    const a = hashCustomerPhoneIdentity('0772123456', 'pepper');
    expect(hashCustomerPhoneIdentity('+256772123456', 'pepper')).toBe(a);
    expect(hashCustomerPhoneIdentity('256 772 123 456', 'pepper')).toBe(a);
    expect(hashCustomerPhoneIdentity('+256 (772) 123-456', 'pepper')).toBe(a);
  });
  it('different numbers differ', () => {
    expect(hashCustomerPhoneIdentity('0772123456', 'p')).not.toBe(hashCustomerPhoneIdentity('0772123457', 'p'));
  });
});
