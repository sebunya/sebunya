import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Loyalty ledger immutability contract (migration 0050).
 *
 * The behaviour itself is proven against a real PostgreSQL 16 during migration
 * rehearsal — a trigger cannot be exercised without a database. What this suite
 * guards is that the control is not quietly weakened later: the trigger stays
 * absolute, covers both UPDATE and DELETE, and no carve-out appears.
 *
 * Real-database evidence recorded at implementation time:
 *   UPDATE points / reason / idempotency_key  -> rejected
 *   DELETE single row / bulk UPDATE / bulk DELETE -> rejected
 *   SQLSTATE 23001 (restrict_violation)
 *   original row unchanged (points=500, reason='order paid')
 *   appending a reversal still works; derived balance 500 + (-500) = 0
 *   idempotency unique index still enforced
 */

const repoRoot = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(
  path.join(repoRoot, 'apps/api/src/infrastructure/db/migrations/0050_loyalty_ledger_immutability.sql'),
  'utf8',
);

describe('loyalty ledger immutability migration', () => {
  it('is registered in the journal, or the runner would never apply it', () => {
    const journal = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, 'apps/api/src/infrastructure/db/migrations/meta/_journal.json'),
        'utf8',
      ),
    );
    const tags = journal.entries.map((e: { tag: string }) => e.tag);
    expect(tags).toContain('0050_loyalty_ledger_immutability');
    // Monotonic ordering: it must come after the ceiling it builds on.
    expect(tags.indexOf('0050_loyalty_ledger_immutability')).toBe(
      tags.indexOf('0049_module_activation_approvals') + 1,
    );
  });

  it('blocks both UPDATE and DELETE — not just one', () => {
    expect(migration).toMatch(/BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+loyalty_ledger_entries/i);
    expect(migration).toMatch(/FOR\s+EACH\s+ROW/i);
  });

  it('raises rather than silently swallowing the mutation', () => {
    // A trigger that RETURNs NULL would discard the write and report success,
    // which is worse than allowing it: the caller believes it succeeded.
    expect(migration).toMatch(/RAISE\s+EXCEPTION/i);
    expect(migration).not.toMatch(/RETURN\s+NULL\s*;/i);
  });

  it('uses a machine-readable errcode so callers can distinguish it', () => {
    expect(migration).toMatch(/ERRCODE\s*=\s*'restrict_violation'/i);
  });

  it('names the correction path in the error, so the fix is obvious', () => {
    expect(migration).toMatch(/reversal/i);
    expect(migration).toMatch(/adjustment/i);
  });

  it('grants no carve-out — an exception makes provenance unanswerable', () => {
    const body = migration.slice(migration.indexOf('RETURNS trigger'));
    // No conditional escape inside the trigger function.
    expect(body).not.toMatch(/\bIF\b[^;]*\bTHEN\b[\s\S]*RETURN\s+(OLD|NEW)/i);
    expect(body).not.toMatch(/current_setting\s*\(/i);
    expect(body).not.toMatch(/session_user|current_user/i);
  });

  it('is idempotent, so a replayed chain does not fail', () => {
    expect(migration).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
    expect(migration).toMatch(/DROP\s+TRIGGER\s+IF\s+EXISTS/i);
  });

  it('is additive — it moves and discards no data', () => {
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migration).not.toMatch(/\bTRUNCATE\b/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migration).not.toMatch(/\bALTER\s+TABLE\b[\s\S]*\bDROP\s+COLUMN\b/i);
  });

  it('states its rollback', () => {
    expect(migration).toMatch(/DROP TRIGGER loyalty_ledger_entries_immutable/i);
  });
});
