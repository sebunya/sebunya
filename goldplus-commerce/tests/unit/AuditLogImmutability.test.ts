import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `audit_logs` carried no constraint, trigger or grant restriction: the
 * application's own database role could UPDATE or DELETE any row.
 *
 * The account most likely to want a row gone is the one that produced it.
 * Whoever compromises an admin session can perform an action and then erase the
 * record of it, on the same connection, with no second system involved.
 */
const migration = readFileSync(
  join(__dirname, '../../apps/api/src/infrastructure/db/migrations/0055_audit_log_immutability.sql'),
  'utf8',
);

describe('audit log is append-only', () => {
  it('rejects UPDATE and DELETE at the database, not in application code', () => {
    // Application-level enforcement is bypassed by anyone with the connection.
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON audit_logs');
    expect(migration).toContain('RAISE EXCEPTION');
  });

  it('leaves INSERT untouched so writing an audit entry is unchanged', () => {
    expect(migration).not.toMatch(/BEFORE\s+INSERT/i);
    expect(migration).not.toMatch(/OR\s+INSERT/i);
  });

  it('fires per row, so a bulk statement cannot slip past', () => {
    expect(migration).toContain('FOR EACH ROW');
  });

  it('tells the operator how to correct a mistaken entry', () => {
    // Without this the refusal reads as an obstacle rather than a design.
    expect(migration).toContain('HINT');
    expect(migration).toContain('Append a further entry');
  });

  it('is idempotent, so a replay does not fail the migration chain', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION');
    expect(migration).toContain('DROP TRIGGER IF EXISTS');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS');
  });

  it('indexes the two queries an investigation actually runs', () => {
    // "what did this actor do" and "what happened to this entity", in time order.
    expect(migration).toContain('"actor_id", "created_at" DESC');
    expect(migration).toContain('"entity", "entity_id", "created_at" DESC');
  });

  it('does not silently delete history as part of the change', () => {
    expect(migration).not.toMatch(/DELETE\s+FROM\s+audit_logs/i);
    expect(migration).not.toMatch(/TRUNCATE/i);
  });
});
