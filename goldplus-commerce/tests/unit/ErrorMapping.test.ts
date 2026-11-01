import { describe, it, expect } from 'vitest';
import { mapErrorToHttp } from '../../apps/api/src/interfaces/http/errorMapping';
import {
  DomainError,
  NotFoundError,
  ConflictError,
  ValidationError,
  ForbiddenError,
} from '../../apps/api/src/domain/errors/DomainError';

describe('mapErrorToHttp — central, leak-proof HTTP error mapping', () => {
  it('maps domain errors by category to the right status and preserves the code', () => {
    expect(mapErrorToHttp(NotFoundError('ORDER_NOT_FOUND', 'no order')).status).toBe(404);
    expect(mapErrorToHttp(ConflictError('STALE_VERSION', 'stale')).status).toBe(409);
    expect(mapErrorToHttp(ValidationError('BAD_INPUT', 'bad')).status).toBe(400);
    expect(mapErrorToHttp(ForbiddenError('NO_ACCESS', 'nope')).body.error.code).toBe('NO_ACCESS');
  });

  it('shows a client-safe domain message but hides an internal one', () => {
    const safe = mapErrorToHttp(NotFoundError('X', 'the widget 42 was not found'));
    expect(safe.body.error.message).toBe('the widget 42 was not found');
    const internal = mapErrorToHttp(new DomainError('BOOM', 'INTERNAL', 'stack trace: secret at line 5'));
    expect(internal.status).toBe(500);
    expect(internal.body.error.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(internal)).not.toContain('secret at line 5');
  });

  it('classifies PostgreSQL failures by SQLSTATE code, never by message', () => {
    // A connection-class SQLSTATE => 503, even with a misleading message.
    expect(mapErrorToHttp({ code: '57P01', message: 'looks fine' }).status).toBe(503);
    expect(mapErrorToHttp({ code: '23505', message: 'anything' }).status).toBe(409); // unique_violation
    expect(mapErrorToHttp({ code: '23514' }).status).toBe(400); // check_violation
    expect(mapErrorToHttp({ code: 'ECONNREFUSED' }).status).toBe(503);
  });

  it('never leaks the message of an unexpected (non-domain) error', () => {
    const mapped = mapErrorToHttp(new Error('DB password is hunter2 at postgres://user:pw@host'));
    expect(mapped.status).toBe(500);
    expect(mapped.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(mapped)).not.toContain('hunter2');
    expect(JSON.stringify(mapped)).not.toContain('postgres://');
  });

  it('carries the request id through when provided', () => {
    expect(mapErrorToHttp(new Error('x'), 'req-123').body.meta?.requestId).toBe('req-123');
  });
});
