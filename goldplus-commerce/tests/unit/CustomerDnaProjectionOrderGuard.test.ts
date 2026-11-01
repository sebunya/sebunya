import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const wheres: unknown[] = [];
vi.mock('../../apps/api/src/infrastructure/db/client', () => {
  const chain = {
    set: () => chain,
    where: (w: unknown) => { wheres.push(w); return chain; },
    returning: async () => [],
  };
  return { db: { update: () => chain } };
});

import { DrizzleCustomerProfileRepository } from '../../apps/api/src/infrastructure/db/repositories/DrizzleCustomerDnaRepositories';

describe('customer profile projection never goes backwards', () => {
  it('the update is gated on the stored sourceVersion being <= the snapshot, at ms precision', async () => {
    await new DrizzleCustomerProfileRepository().upsertProjection({
      canonicalCustomerId: '00000000-0000-4000-8000-000000000001', accountUserId: null,
      sourceVersion: 5, profileVersion: 1, identityConfidence: 'HIGH', firstSeen: null, lastSeen: null,
      primaryLifecycleStage: 'ACTIVE', valueFlags: [], riskFlags: [], consentEligible: null,
      communicationPreferences: null, freshness: { staleAfterHours: 24, computedAt: new Date() }, computedAt: new Date(),
    } as never);
    const q = new PgDialect().sqlToQuery(wheres[0] as never);
    expect(q.sql).toMatch(/\("customer_profiles"\."source_version" <= \$\d+\) and \(/);
    expect(q.sql).toContain("date_trunc('milliseconds'");
    expect(q.sql).not.toContain("date_trunc('second'");
  });
});
