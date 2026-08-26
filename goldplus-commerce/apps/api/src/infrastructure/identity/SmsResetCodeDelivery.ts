import type { INotificationProvider } from '../../application/ports/INotificationProvider';
import type { ResetCodeDeliveryPort } from '../../application/use-cases/identity/SmsPasswordResetUseCases';
import { logger } from '../logging/logger';

/**
 * Delivers a password reset code by SMS, synchronously.
 *
 * Deliberately NOT through the outbox. An outbox row would hold the code in
 * plain text until a worker picked it up, which is a persisted bearer secret
 * for a password reset; the phone verification OTP tolerates that, a reset
 * must not. The provider is called directly, exactly as the email reset link
 * is, and the wording comes from the one customer wording table
 * (CustomerMessages, template PASSWORD_RESET_CODE) via the adapter.
 *
 * The attempt is recorded for operators WITHOUT the code: template, status
 * and the provider's own words only.
 */
export class SmsResetCodeDelivery implements ResetCodeDeliveryPort {
  constructor(
    private readonly provider: INotificationProvider,
    private readonly recordAttempt?: {
      execute(input: {
        channel: string;
        recipient: string;
        template: string;
        status: string;
        providerCode: string | null;
        providerMessage: string | null;
        relatedEntity: string | null;
        relatedEntityId: string | null;
      }): Promise<unknown>;
    },
  ) {}

  async sendResetCode(input: { phoneE164: string; code: string; expiresInMinutes: number }): Promise<{
    status: 'SENT' | 'FAILED' | 'NOT_CONFIGURED' | 'DRY_RUN' | 'DISABLED';
    detail?: string;
  }> {
    try {
      const result = await this.provider.dispatch({
        recipient: input.phoneE164,
        template: 'PASSWORD_RESET_CODE',
        data: { code: input.code, expiresInMinutes: input.expiresInMinutes },
        relatedEntity: 'password_reset',
        relatedEntityId: null,
      });
      const status =
        result.status === 'SENT' ||
        result.status === 'DRY_RUN' ||
        result.status === 'NOT_CONFIGURED' ||
        result.status === 'DISABLED'
          ? result.status
          : 'FAILED';
      if (status === 'NOT_CONFIGURED' || status === 'DISABLED') {
        logger.error(
          { template: 'PASSWORD_RESET_CODE', status, providerCode: result.providerCode, providerMessage: result.providerMessage },
          status === 'NOT_CONFIGURED' ? 'PASSWORD_RESET_SMS_NOT_CONFIGURED' : 'PASSWORD_RESET_SMS_BLOCKED_BY_POLICY',
        );
      }
      await this.recordAttempt
        ?.execute({
          channel: 'sms',
          recipient: input.phoneE164,
          template: 'PASSWORD_RESET_CODE',
          status,
          providerCode: result.providerCode,
          providerMessage: result.providerMessage,
          relatedEntity: 'password_reset',
          relatedEntityId: null,
        })
        .catch(() => undefined);
      return { status, detail: result.providerMessage };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.error({ err: detail }, 'PASSWORD_RESET_SMS_FAILED');
      return { status: 'FAILED', detail };
    }
  }
}
