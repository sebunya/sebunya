import { describe, expect, it } from 'vitest';
import { kampalaWallTimeToIso } from '../../apps/web/src/lib/pricingVersionDraft';
import * as kampala from '../../apps/web/src/lib/kampalaTime';

describe('kampalaTime imports a module that exists', () => {
  it('resolves pricingVersionDraft.kampalaWallTimeToIso', () => {
    expect(typeof kampalaWallTimeToIso).toBe('function');
    expect(Object.keys(kampala).length).toBeGreaterThan(0);
  });
});
