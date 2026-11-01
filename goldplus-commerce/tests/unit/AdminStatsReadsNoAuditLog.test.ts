import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** The admin home stats must not load the whole audit log (it did, on every visit, and never used it). */
describe('GET /governance/admin/stats', () => {
  it('does not read the audit log', () => {
    const src = readFileSync('apps/api/src/interfaces/http/routes/governance.ts', 'utf8');
    const handler = src.slice(src.indexOf("routes.get('/admin/stats'"), src.indexOf('// Admin List Routes'));
    expect(handler).toContain('supportRepo.findAll()');
    expect(handler).not.toContain('auditRepo.findAll');
  });
});
