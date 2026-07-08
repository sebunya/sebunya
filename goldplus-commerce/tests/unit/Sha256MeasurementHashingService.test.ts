import { describe, it, expect } from 'vitest';
import { Sha256MeasurementHashingService } from '../../apps/api/src/application/services/measurement/Sha256MeasurementHashingService';

describe('Sha256MeasurementHashingService', () => {
  const hasher = new Sha256MeasurementHashingService();

  it('hashes a string correctly', () => {
    const hash1 = hasher.hashString('test@example.com');
    const hash2 = hasher.hashString(' Test@Example.com ');
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);
  });

  it('hashes a phone number correctly by stripping non-digits', () => {
    const hash1 = hasher.hashPhone('+1 (555) 123-4567');
    const hash2 = hasher.hashPhone('15551234567');
    expect(hash1).toBe(hash2);
  });
});
