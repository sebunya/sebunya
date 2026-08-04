import { PERMISSIONS } from '@goldplus/shared';
export { GOVERNANCE_ROLES, LEGACY_FULL_ACCESS_ROLE, PLATFORM_ADMINISTRATOR_ROLE } from '@goldplus/shared';

/**
 * Pure contract for the permission-registry sync — no database imports, so the split
 * semantics and role vocabulary are unit-testable in isolation.
 *
 * WHY THIS EXISTS
 * The permissions table stores (action, resource) and the auth middleware grants the
 * code `${action}.${resource}`. During the 2026-08-03 production recovery, permissions
 * were granted by hand-written SQL and the first attempt inserted the pair REVERSED,
 * silently producing codes like `read.promotions` that matched nothing. The registry in
 * code is the single truth; this module is the only place allowed to translate it into
 * rows, and the running API converges on it at boot instead of depending on anyone
 * typing SQL correctly under incident pressure.
 */

/** Split a registry code into its stored (action, resource) pair. */
export function splitPermissionCode(code: string): { action: string; resource: string } {
  const dot = code.indexOf('.');
  // First-dot split, NOT last-dot: `analytics.alerts.manage` stores
  // action='analytics', resource='alerts.manage', because that is exactly how
  // `${action}.${resource}` reassembles into the granted code.
  if (dot <= 0 || dot === code.length - 1) {
    throw new Error(`Malformed permission code: ${JSON.stringify(code)}`);
  }
  const action = code.slice(0, dot);
  const resource = code.slice(dot + 1);
  if (action.length > 50 || resource.length > 50) {
    // varchar(50) columns; a silent truncate would grant a code nothing checks for.
    throw new Error(`Permission code segment exceeds column width: ${code}`);
  }
  return { action, resource };
}

/** Every registry permission as a stored row, deduplicated, stable order. */
export function registryPermissionRows(): Array<{ code: string; action: string; resource: string }> {
  const seen = new Set<string>();
  const rows: Array<{ code: string; action: string; resource: string }> = [];
  for (const code of Object.values(PERMISSIONS)) {
    if (seen.has(code)) continue;
    seen.add(code);
    rows.push({ code, ...splitPermissionCode(code) });
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}



