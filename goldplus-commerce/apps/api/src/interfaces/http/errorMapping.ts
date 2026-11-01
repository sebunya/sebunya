import { ContentfulStatusCode } from 'hono/utils/http-status';
import { DomainError, ErrorCategory, isDomainError } from '../../domain/errors/DomainError';

/**
 * The one place an error becomes an HTTP response. Central so no route reinvents
 * status mapping, and so the rule "an unexpected error never leaks its message"
 * holds in exactly one auditable place.
 *
 * DB failures are classified by their PostgreSQL SQLSTATE `code` — NOT by string
 * matching the message, which is brittle, locale-dependent and was flagged in the
 * §20 hostile review.
 */

const CATEGORY_STATUS: Record<ErrorCategory, ContentfulStatusCode> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL: 500,
};

const GENERIC_MESSAGE: Record<ErrorCategory, string> = {
  VALIDATION: 'The request was invalid.',
  UNAUTHENTICATED: 'Authentication is required.',
  FORBIDDEN: 'You do not have access to this resource.',
  NOT_FOUND: 'The requested resource was not found.',
  CONFLICT: 'The request conflicts with the current state.',
  RATE_LIMITED: 'Too many requests, please try again later.',
  DEPENDENCY_UNAVAILABLE: 'Service temporarily unavailable.',
  INTERNAL: 'An unexpected error occurred.',
};

export interface MappedError {
  status: ContentfulStatusCode;
  body: { success: false; error: { code: string; message: string }; meta?: { requestId?: string } };
}

/** PostgreSQL connection-class SQLSTATEs → dependency unavailable. */
const PG_UNAVAILABLE = new Set(['08000', '08003', '08006', '08001', '08004', '57P01', '57P03']);

function pgCategory(code: string): ErrorCategory | null {
  if (PG_UNAVAILABLE.has(code)) return 'DEPENDENCY_UNAVAILABLE';
  if (code === '23505') return 'CONFLICT'; // unique_violation
  if (code === '23503') return 'CONFLICT'; // foreign_key_violation
  if (code === '23514' || code === '23502') return 'VALIDATION'; // check / not-null violation
  return null;
}

export function mapErrorToHttp(err: unknown, requestId?: string): MappedError {
  const meta = requestId ? { requestId } : undefined;

  if (isDomainError(err)) {
    const status = CATEGORY_STATUS[err.category];
    const message = err.clientSafe ? err.message : GENERIC_MESSAGE[err.category];
    return { status, body: { success: false, error: { code: err.code, message }, meta } };
  }

  // A postgres-js / node-pg error carries a SQLSTATE on `.code`. Classify by
  // that, never by the message text.
  const code = (err as { code?: unknown })?.code;
  if (typeof code === 'string') {
    // Connection refused surfaces as a Node errno, not a SQLSTATE.
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
      const cat: ErrorCategory = 'DEPENDENCY_UNAVAILABLE';
      return { status: CATEGORY_STATUS[cat], body: { success: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message: GENERIC_MESSAGE[cat] }, meta } };
    }
    const cat = pgCategory(code);
    if (cat) {
      return { status: CATEGORY_STATUS[cat], body: { success: false, error: { code: cat, message: GENERIC_MESSAGE[cat] }, meta } };
    }
  }

  // Unknown: never surface the message.
  return {
    status: CATEGORY_STATUS.INTERNAL,
    body: { success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: GENERIC_MESSAGE.INTERNAL }, meta },
  };
}

export { DomainError };
