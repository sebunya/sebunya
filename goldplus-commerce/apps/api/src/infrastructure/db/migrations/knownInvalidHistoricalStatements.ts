/**
 * Slice 14C — migration-history integrity shim data.
 *
 * Historical migration 0018 contains exactly four FK statements that join
 * varchar(36) columns to users.id (uuid). PostgreSQL rejects them with
 * SQLSTATE 42804 on every fresh bootstrap, so NO environment has ever gained
 * these constraints — the statements are dead code that only breaks new
 * installs. Migration 0018 itself stays byte-identical to its original
 * committed content; during fresh bootstrap the migration runner skips ONLY
 * these four exact statements (recorded below verbatim), and additive
 * migration 0028 performs the real repair (uuid casts + valid constraints).
 *
 * This is deliberately NOT a generic error-suppression mechanism: matching is
 * exact (whitespace-normalized string equality against the four historical
 * statements) and anything else — including any other statement in 0018 —
 * executes unchanged.
 */

const DEAD_0018_CONSTRAINTS = [
  'release_decisions_recorded_by_users_id_fk',
  'release_readiness_audit_log_admin_user_id_users_id_fk',
  'release_readiness_gate_results_acknowledged_by_users_id_fk',
  'release_readiness_runs_triggered_by_users_id_fk',
] as const;

const ALTER_BY_CONSTRAINT: Record<string, string> = {
  release_decisions_recorded_by_users_id_fk:
    'ALTER TABLE "release_decisions" ADD CONSTRAINT "release_decisions_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;',
  release_readiness_audit_log_admin_user_id_users_id_fk:
    'ALTER TABLE "release_readiness_audit_log" ADD CONSTRAINT "release_readiness_audit_log_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;',
  release_readiness_gate_results_acknowledged_by_users_id_fk:
    'ALTER TABLE "release_readiness_gate_results" ADD CONSTRAINT "release_readiness_gate_results_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;',
  release_readiness_runs_triggered_by_users_id_fk:
    'ALTER TABLE "release_readiness_runs" ADD CONSTRAINT "release_readiness_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;',
};

/** The four exact DO-block statements as drizzle executes them from 0018. */
export const KNOWN_INVALID_0018_STATEMENTS: readonly string[] = DEAD_0018_CONSTRAINTS.map(
  (name) => `DO $$ BEGIN\n ${ALTER_BY_CONSTRAINT[name]}\nEXCEPTION\n WHEN duplicate_object THEN null;\nEND $$;`
);

const normalize = (statement: string) => statement.replace(/\s+/g, ' ').trim();

const NORMALIZED = new Set(KNOWN_INVALID_0018_STATEMENTS.map(normalize));

/** Exact (whitespace-normalized) match against the four dead 0018 statements only. */
export function isKnownInvalidHistoricalStatement(statement: string): boolean {
  return NORMALIZED.has(normalize(statement));
}
