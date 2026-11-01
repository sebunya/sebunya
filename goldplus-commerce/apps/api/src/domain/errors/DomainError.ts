/**
 * Typed domain errors. Pure domain — no HTTP.
 *
 * A domain error carries a stable machine `code` and a `category` that the
 * interface layer maps to an HTTP status. The message is developer-facing; the
 * HTTP mapper decides what a client sees, so a raw message never leaks by
 * default. Errors that are safe to show a user set `clientSafe`.
 */

export type ErrorCategory =
  | 'VALIDATION' // 400
  | 'UNAUTHENTICATED' // 401
  | 'FORBIDDEN' // 403
  | 'NOT_FOUND' // 404
  | 'CONFLICT' // 409
  | 'RATE_LIMITED' // 429
  | 'DEPENDENCY_UNAVAILABLE' // 503
  | 'INTERNAL'; // 500

export class DomainError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly clientSafe: boolean;

  constructor(
    code: string,
    category: ErrorCategory,
    message: string,
    opts: { clientSafe?: boolean } = {},
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.category = category;
    // Validation/not-found/conflict/forbidden messages are typically safe to
    // show; internal ones never are unless explicitly opted in.
    this.clientSafe = opts.clientSafe ?? category !== 'INTERNAL';
  }
}

export const isDomainError = (err: unknown): err is DomainError => err instanceof DomainError;

/** Convenience constructors for the common categories. */
export const ValidationError = (code: string, message: string) =>
  new DomainError(code, 'VALIDATION', message);
export const NotFoundError = (code: string, message: string) =>
  new DomainError(code, 'NOT_FOUND', message);
export const ConflictError = (code: string, message: string) =>
  new DomainError(code, 'CONFLICT', message);
export const ForbiddenError = (code: string, message: string) =>
  new DomainError(code, 'FORBIDDEN', message);
export const DependencyUnavailableError = (code: string, message: string) =>
  new DomainError(code, 'DEPENDENCY_UNAVAILABLE', message, { clientSafe: false });
