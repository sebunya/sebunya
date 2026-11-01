import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const R = resolve(__dirname, '../../apps/api/src/infrastructure/db/repositories');

describe('admin searches escape LIKE wildcards', () => {
  it('audit action filter and customer search use likeContains, not raw %…%', () => {
    for (const f of ['DrizzleAuditRepository.ts', 'DrizzleCustomerDnaRepositories.ts']) {
      const src = readFileSync(resolve(R, f), 'utf8');
      expect(src, f).toContain('likeContains(');
      expect(src, f).not.toMatch(/ilike[^\n]*'%' \+/);
      expect(src, f).not.toMatch(/ilike\([^)]*`%\$\{/);
    }
  });
});
