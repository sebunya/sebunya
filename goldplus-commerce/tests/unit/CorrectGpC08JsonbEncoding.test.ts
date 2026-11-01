import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(__dirname, '../../apps/api/src/scripts/correct-gp-c08-wattage.ts'), 'utf8');

describe('correct-gp-c08-wattage writes real jsonb, not a jsonb string', () => {
  it('casts through text and decodes a double-encoded read', () => {
    expect(src).toContain('${JSON.stringify(after.features)}::text::jsonb');
    expect(src).toContain('${JSON.stringify(after.specs)}::text::jsonb');
    expect(src).not.toMatch(/JSON\.stringify\([^)]*\)\}::jsonb/);
    expect(src).toContain('decoded(row.features)');
  });
});
