import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '../../../apps/api/src/infrastructure/db/repositories/DrizzlePricingCapacityRepository.ts'), 'utf8');

describe('a budget pause keeps the promotion definition in step', () => {
  it('pauses the definition whose active version the budget paused, in the same transaction', () => {
    const i = src.indexOf("THEN 'PAUSED' ELSE");
    const after = src.slice(i, i + 1200);
    expect(after).toMatch(/tx\s*\.update\(promotionDefinitions\)\s*\.set\(\{ status: 'PAUSED'/);
    expect(after).toMatch(/eq\(promotionDefinitions\.activeVersionId, versionId\)/);
    expect(after).toMatch(/pv\.status = 'PAUSED'/);
  });
});
