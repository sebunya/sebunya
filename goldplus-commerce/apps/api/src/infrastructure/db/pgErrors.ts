/** PostgreSQL unique_violation (23505), on the error itself or on a driver/ORM wrapper's cause. */
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === 'object'; i++) {
    if ((e as { code?: unknown }).code === '23505') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
