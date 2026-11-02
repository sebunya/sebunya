/**
 * Small helpers the ops scripts used to copy into every file. Pure: importing
 * this module touches no database and reads no environment by itself.
 */

/** The rows of a `db.execute(...)` result, whichever shape the driver returned. */
export const rowsOf = (r: unknown): Record<string, unknown>[] =>
  (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));

const ACTOR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The acting admin's uuid from ACTOR_USER_ID (or the variable named). When
 * `required` is true a missing or malformed value throws; otherwise it is
 * returned as given (possibly empty) for a dry run that writes nothing.
 */
export function actorUserId(required: boolean, variable = 'ACTOR_USER_ID', env: NodeJS.ProcessEnv = process.env): string {
  const id = String(env[variable] ?? '').trim();
  if (required && !ACTOR_UUID.test(id)) throw new Error(`${variable} must be the acting admin uuid.`);
  return id;
}
