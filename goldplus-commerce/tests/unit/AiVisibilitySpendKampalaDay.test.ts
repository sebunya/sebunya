import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const seen: unknown[] = [];
vi.mock('../../apps/api/src/infrastructure/db/client', () => ({
  db: { execute: async (q: unknown) => { seen.push(q); return []; } },
}));

import { DrizzleAiVisibilityRepository } from '../../apps/api/src/infrastructure/db/repositories/DrizzleAiVisibilityRepository';

describe('AI visibility spend buckets use the Kampala day and month', () => {
  it('spendToDate truncates in Africa/Kampala, never bare UTC now()', async () => {
    await new DrizzleAiVisibilityRepository().spendToDate('00000000-0000-4000-8000-000000000001');
    const q = new PgDialect().sqlToQuery(seen[0] as never).sql;
    expect(q).toContain("date_trunc('day', now() at time zone 'Africa/Kampala') at time zone 'Africa/Kampala'");
    expect(q).toContain("date_trunc('month', now() at time zone 'Africa/Kampala') at time zone 'Africa/Kampala'");
    expect(q).not.toMatch(/date_trunc\('(day|month)', now\(\)\)/);
  });
});
