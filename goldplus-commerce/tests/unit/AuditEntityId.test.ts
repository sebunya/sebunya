import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditEntityId, isUuid } from '../../apps/api/src/domain/audit/AuditEntityId';

/**
 * audit_logs.entity_id is a UUID column. Nine admin routes audit singletons
 * under names like 'global' — and every one of those inserts failed AFTER the
 * save, so the operator saw "unexpected error" on a change that had gone
 * through, and no history was written. Production had ZERO audit rows for
 * taxonomy, hero, nav, business-info or homepage saves when this was found.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

describe('every audit reference becomes a valid, stable UUID', () => {
  it('a singleton name maps to the same UUID every time, per entity', () => {
    const a = auditEntityId('taxonomy_config', 'global');
    expect(isUuid(a)).toBe(true);
    expect(auditEntityId('taxonomy_config', 'global')).toBe(a);
    expect(auditEntityId('hero_settings', 'global')).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('a real UUID passes through unchanged (lower-cased)', () => {
    expect(auditEntityId('product', '00B84A38-6BBC-4A28-88FC-DCC46E953703')).toBe('00b84a38-6bbc-4a28-88fc-dcc46e953703');
  });
  it('the writer and the reader use the same mapping', () => {
    expect(read('apps/api/src/application/use-cases/audit/CreateAuditLogUseCase.ts')).toMatch(/auditEntityId\(entity, entityId\)/);
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleAuditRepository.ts')).toMatch(/eq\(auditLogs\.entityId, auditEntityId\(entity, entityId\)\)/);
  });
  it('bulk approval audits each batch under its own UUID, never a bare word', () => {
    const route = read('apps/api/src/interfaces/http/routes/admin/products.ts');
    expect(route).toMatch(/const batchId = randomUUID\(\);/);
    expect(route).not.toMatch(/entityId: 'bulk'/);
  });
});
