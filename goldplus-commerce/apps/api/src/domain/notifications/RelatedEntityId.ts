/**
 * The identity contract for a notification's related entity.
 *
 * `notification_attempts.related_entity_id` is `uuid NULL`. Nullable means
 * absence is legitimate — a phone-verification SMS relates to a phone number,
 * not to a row with a uuid — so ABSENCE IS A VALUE, and it has exactly one
 * representation: null.
 *
 * The router used to spell it a second way:
 *
 *     String(payload.relatedEntityId || payload.id || '')
 *
 * `''` is not a uuid and it is not null. PostgreSQL rejected the cast, the
 * whole outbox item threw, and the worker retried it — 299 times over nine
 * days for one event. The dispatch call sits BEFORE the record call, so every
 * one of those retries re-sent the message before failing to write it down.
 * A malformed id must therefore be caught here, at the boundary, and never
 * discovered by the database.
 *
 * Two rules:
 *   1. Absent, blank, or whitespace-only  -> null. Not '', not a zero uuid,
 *      and never a generated one: inventing an id would attach the attempt to
 *      an entity that does not exist.
 *   2. Present but malformed -> null, and say so, so it becomes a validation
 *      fact rather than a crash loop.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value.trim());

/**
 * Narrows any candidate to a persistable uuid or the canonical absence.
 * Never throws: a notification must not be lost because its optional back
 * reference was malformed.
 */
export const toRelatedEntityId = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text.length === 0) return null;
  return UUID.test(text) ? text : null;
};
