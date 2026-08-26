/**
 * One error type for the battery module. Routes map `code` to a status; the
 * message is safe to show an operator (never a stack, never a SQL fragment).
 */
export class BatteryOperationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new BatteryOperationError('NOT_FOUND', `${what} was not found.`, 404);
export const conflict = (code: string, message: string, details?: unknown) => new BatteryOperationError(code, message, 409, details);
export const forbidden = (code: string, message: string) => new BatteryOperationError(code, message, 403);
export const invalid = (message: string, details?: unknown) => new BatteryOperationError('BAD_INPUT', message, 400, details);
export const unprocessable = (code: string, message: string, details?: unknown) => new BatteryOperationError(code, message, 422, details);
