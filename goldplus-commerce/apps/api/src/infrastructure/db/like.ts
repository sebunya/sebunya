/**
 * Build a LIKE/ILIKE pattern from user text.
 *
 * `%` and `_` are wildcards inside a pattern. Interpolating a search box's
 * value straight into `%…%` let a typed `%` match every row and a typed `_`
 * match any single character, so a search for "10_000" or "50%" answered with
 * the whole catalogue. Postgres reads the backslash as the escape character by
 * default, so escaping the three special characters is sufficient.
 */
export function likeContains(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
