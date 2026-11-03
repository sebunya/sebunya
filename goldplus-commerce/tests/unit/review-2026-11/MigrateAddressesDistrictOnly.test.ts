import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '../../../apps/api/src/scripts/migrate-existing-addresses.ts'), 'utf8');

describe('migrate-existing-addresses: a district-only match goes to ops review', () => {
  it('flags district-only address links as needs_ops_review and says so in the audit', () => {
    expect(src).toMatch(/const districtOnly = m\.via === 'district'/);
    expect(src).toMatch(/resolution_status = case when \$\{districtOnly\} then 'needs_ops_review'/);
    expect(src).toMatch(/DISTRICT-LEVEL match only\. Linked to a representative area/);
  });
});
