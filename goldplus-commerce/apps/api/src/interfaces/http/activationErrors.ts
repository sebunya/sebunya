/**
 * The controlled-activation use cases refuse with plain Errors ('Activation
 * request not found', 'Forbidden: Cannot approve activation', a separation-of-
 * duties reason, 'Cannot approve without rollback plan'). With no mapping, the
 * global handler turned every one of them into a generic 500 — an operator
 * opening a stale id, or a requester trying to approve their own request, was
 * told "An unexpected error occurred" instead of why.
 *
 * Only these KNOWN refusal shapes are mapped, and only their own messages
 * (written in the use cases, never a database or library message) go back.
 * Anything else returns null and still reaches the global handler as a 500
 * with a generic message.
 */
export interface ActivationRefusal {
  status: 403 | 404 | 409;
  code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT';
  message: string;
}

const NOT_FOUND = /\bnot found\b/i;
const FORBIDDEN = /^(forbidden\b|unauthori[sz]ed\b)|\bnot authori[sz]ed\b/i;
// Rule refusals the use cases state in words: missing prerequisites, state
// conflicts, and separation of duties (the requester cannot approve their own).
const RULE = /\b(required|cannot|must|approve their own|separation|segregation)\b/i;

export function activationRefusal(err: unknown): ActivationRefusal | null {
  // A DomainError carries its own category; the global handler maps it already.
  if (!(err instanceof Error) || (err as { category?: unknown }).category !== undefined) return null;
  if ((err as { code?: unknown }).code !== undefined) return null; // driver / SQLSTATE errors
  const message = err.message ?? '';
  if (NOT_FOUND.test(message)) return { status: 404, code: 'NOT_FOUND', message };
  if (FORBIDDEN.test(message)) return { status: 403, code: 'FORBIDDEN', message: 'You are not allowed to do that.' };
  if (RULE.test(message)) return { status: 409, code: 'CONFLICT', message };
  return null;
}
