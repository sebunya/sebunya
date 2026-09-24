import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { ListAuditLogsUseCase, isAuditActorId } from '../../apps/api/src/application/use-cases/admin/ListAuditLogsUseCase';
import { FraudTriageOperationsUseCase } from '../../apps/api/src/application/use-cases/fraud/FraudTriageOperationsUseCase';
import { adminEmailDeliveryState } from '../../apps/api/src/domain/notifications/AdminOrderEmail';
import { GetCustomerWorkspaceUseCase } from '../../apps/api/src/application/use-cases/admin/GetCustomerWorkspaceUseCase';
import { GetCustomerDnaUseCase, maskIdentifier } from '../../apps/api/src/application/use-cases/customer-dna/CustomerDnaUseCases';

/**
 * Admin sweep batch 3 (2026-09-24) — insight, audit, notifications, fraud.
 */
const read = (p: string) => readFileSync(p, 'utf8');
const ID = '11111111-1111-4111-8111-111111111111';

describe('audit log filters', () => {
  const rows = [{ id: 'a', actorId: ID, action: 'ROLE_CREATED', entity: 'role', entityId: 'r', previousState: null, newState: null, createdAt: new Date('2026-09-01T00:00:00Z') }];
  it('an entity alone narrows the feed (Role history = entity=role)', async () => {
    const audit = { findAll: vi.fn(async () => rows), findByEntity: vi.fn(), save: vi.fn() };
    await new ListAuditLogsUseCase(audit as any).execute({ entity: 'role' });
    expect(audit.findAll).toHaveBeenCalledWith(expect.objectContaining({ entity: 'role' }));
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleAuditRepository.ts')).toMatch(/if \(opts\?\.entity\) conditions\.push\(eq\(auditLogs\.entity, opts\.entity\)\)/);
  });
  it('a short (8-character) actor id is a 400 at the route, never a 500', () => {
    expect(isAuditActorId('1a2b3c4d')).toBe(false);
    expect(isAuditActorId(ID)).toBe(true);
    const route = read('apps/api/src/interfaces/http/routes/admin/audit.ts');
    expect(route).toMatch(/if \(actorFilter && !isAuditActorId\(actorFilter\)\)/);
    expect(route).toMatch(/BAD_ACTOR_ID/);
  });
});

describe('admin order email delivery state reads the status column first', () => {
  it('a dead-lettered, not-retryable failure is DEAD_LETTER, never RETRYING', () => {
    expect(adminEmailDeliveryState({ isProcessed: true, status: 'DEAD_LETTER', attemptCount: 1, lastError: 'Not retryable: HTTP error status 401 | class=unauthorized | retryable=no' })).toBe('DEAD_LETTER');
  });
  it('an unrecognised processed failure is FAILED', () => {
    expect(adminEmailDeliveryState({ isProcessed: true, status: 'PROCESSED', attemptCount: 1, lastError: 'something odd' })).toBe('FAILED');
  });
  it('keeps the configuration and success states', () => {
    expect(adminEmailDeliveryState({ isProcessed: true, status: 'DEAD_LETTER', attemptCount: 1, lastError: 'channel not_configured' })).toBe('MISSING_CONFIG');
    expect(adminEmailDeliveryState({ isProcessed: true, status: 'PROCESSED', attemptCount: 1, lastError: null })).toBe('SENT');
    expect(adminEmailDeliveryState({ isProcessed: false, status: 'PENDING', attemptCount: 2 })).toBe('RETRYING');
  });
});

describe('fraud triage', () => {
  it('refuses assigning a case to an id that is not an active fraud reviewer', async () => {
    const repo = { assign: vi.fn(async () => ({ id: 'c' })) };
    const uc = new FraudTriageOperationsUseCase(repo as any, { isEligibleReviewer: async (id) => id === ID });
    await expect(uc.assign({ id: 'c', expectedVersion: 1, assigneeId: '00000000-0000-4000-8000-000000000001', actorId: 'a', reason: 'triage' })).rejects.toMatchObject({ code: 'ASSIGNEE_NOT_ELIGIBLE' });
    expect(repo.assign).not.toHaveBeenCalled();
    await uc.assign({ id: 'c', expectedVersion: 1, assigneeId: ID, actorId: 'a', reason: 'triage' });
    expect(repo.assign).toHaveBeenCalled();
  });
  it('validates ids and never returns raw database errors', () => {
    const route = read('apps/api/src/interfaces/http/routes/admin/fraud.ts');
    expect(route).toMatch(/assignedTo must be a reviewer id/);
    expect(route).toMatch(/if \(!known\) \{/);
    expect(route).not.toMatch(/message: error instanceof Error \? error\.message/);
    expect(read('apps/api/src/interfaces/http/routes/admin/customer-dna.ts')).toMatch(/if \(!CUSTOMER_ID\.test\(id\)\) return notFound\(c\);/);
    expect(read('apps/api/src/interfaces/http/routes/admin/notifications.ts')).toMatch(/message: 'The notification timeline could not be read\.'/);
  });
  it('the admin says a HOLD/DECLINE is advisory and the queue is not monitored', () => {
    expect(read('apps/web/src/pages/admin/fraud/[id].astro')).toMatch(/Advisory only: a HOLD or DECLINE here is recorded for review and does not stop the order/);
    expect(read('apps/web/src/pages/admin/fraud/index.astro')).not.toMatch(/no risk cases exist/);
  });
});

describe('customer DNA and decision intelligence say what is missing', () => {
  it('conflicts are masked on the server', async () => {
    const identities = { listConflicts: vi.fn(async () => [{ signalType: 'STABLE_ANONYMOUS_ID', identifierKey: 'abcd1234efgh5678', status: 'CONFLICT', createdAt: new Date() }]) };
    const uc = new GetCustomerDnaUseCase({} as any, identities as any, {} as any, {} as any, {} as any);
    const [row] = await uc.listConflicts(10);
    expect(row).not.toHaveProperty('identifierKey');
    expect(row.identifierMasked).toBe(maskIdentifier('abcd1234efgh5678'));
    expect(row.identifierMasked).toBe('abcd…5678');
  });
  it('lifecycle / NBA signals are MISSING without profiles; zero-result growth is MISSING (cumulative counters)', () => {
    const reader = read('apps/api/src/infrastructure/db/repositories/DrizzleDecisionEvidenceReader.ts');
    expect(reader).toMatch(/if \(\(row\?\.total \?\? 0\) === 0\) return missing\('customer_profiles', NO_PROFILE_PIPELINE\);/);
    expect(reader).toMatch(/if \(\(profiles\?\.n \?\? 0\) === 0\) return missing\('nba_decisions', NO_PROFILE_PIPELINE\);/);
    expect(reader).toMatch(/return missing\('search_demand_signals', 'cumulative counters/);
    expect(read('apps/web/src/pages/admin/customer-dna/index.astro')).not.toMatch(/Profiles appear as customers are observed/);
  });
  it("'Resolved today' starts at Kampala midnight", () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleDecisionInsightRepository.ts');
    expect(repo).toMatch(/kampalaDayStartUtc\(kampalaDayOf\(now\)\)/);
    expect(repo).not.toMatch(/setHours\(0, 0, 0, 0\)/);
  });
});

describe('customer workspace support tickets', () => {
  it('matches a ticket filed under another email by the customer id', async () => {
    const created = new Date('2026-09-01T00:00:00Z');
    const uc = new GetCustomerWorkspaceUseCase({
      users: { findById: async () => ({ id: ID, email: 'a@x.ug', phone: null, isActive: true, createdAt: created }) },
      orders: { listForUser: async () => [] },
      loyalty: { findAccountByUserId: async () => null, listEntries: async () => [] },
      staff: { isStaff: async () => false },
      support: {
        execute: async () => [
          { ticket: { id: 't1', email: 'other@x.ug', customerId: ID, status: 'open', priority: 'normal', createdAt: created } },
          { ticket: { id: 't2', email: 'A@x.ug', customerId: null, status: 'open', priority: 'normal', createdAt: created } },
          { ticket: { id: 't3', email: 'stranger@x.ug', customerId: null, status: 'open', priority: 'normal', createdAt: created } },
        ],
      },
    });
    const ws = await uc.execute(ID, created, { includeSupport: true });
    expect(ws?.support.map((s) => s.id)).toEqual(['t1', 't2']);
  });
});
