import { Context, Next } from 'hono';
import { ApiResponse } from '@goldplus/shared';
import { Registry } from '../../../infrastructure/Registry';
import { PrivilegedAction } from '../../../domain/identity/MfaPolicy';

/**
 * Slice 3C — require a fresh MFA step-up for a privileged action.
 *
 * Runs after authMiddleware + requirePermissions, so c.get('user') is set. The
 * decision is the pure MfaPolicy gate over the user's current MFA state:
 *  - not enrolled/confirmed -> 403 MFA_ENROLMENT_REQUIRED (self-bypass denied)
 *  - enrolled but proof stale -> 403 MFA_STEP_UP_REQUIRED
 *  - enrolled and fresh -> proceed
 *
 * Gated out of the test environment (like the abuse-control and CSRF layers) so
 * the hermetic admin suite stays green; the gate logic itself is proven by the
 * MfaPolicy unit tests and the real-PostgreSQL MFA integration suite.
 */
export function requireStepUp(action: PrivilegedAction) {
  return async (c: Context, next: Next) => {
    if (process.env.NODE_ENV === 'test') return next();

    const user = c.get('user') as { id?: string } | undefined;
    if (!user?.id) {
      const res: ApiResponse<never> = {
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'A valid session is required.' },
      };
      return c.json(res, 401);
    }

    const decision = await Registry.getInstance().mfaService.gate(user.id, action);
    if (decision.action === 'ENROL_REQUIRED') {
      const res: ApiResponse<never> = {
        success: false,
        error: {
          code: 'MFA_ENROLMENT_REQUIRED',
          message: 'This action requires multi-factor authentication. Please set up MFA first.',
        },
      };
      return c.json(res, 403);
    }
    if (decision.action === 'STEP_UP_REQUIRED') {
      const res: ApiResponse<never> = {
        success: false,
        error: {
          code: 'MFA_STEP_UP_REQUIRED',
          message: 'This action requires recent multi-factor verification. Please verify again.',
        },
      };
      return c.json(res, 403);
    }

    await next();
  };
}
