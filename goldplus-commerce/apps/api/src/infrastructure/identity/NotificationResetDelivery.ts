import type { INotificationProvider } from '../../application/ports/INotificationProvider';
import type { ResetDeliveryPort } from '../../application/use-cases/identity/PasswordResetUseCases';
import { logger } from '../logging/logger';

/**
 * Password-reset delivery over the ONE canonical notification provider.
 *
 * No second mail path is created here. If the provider is not configured it
 * says NOT_CONFIGURED and this reports that faithfully — the house rule is
 * that a disabled integration says so rather than pretending, and a reset
 * email that silently evaporates is the most expensive kind of pretending.
 *
 * The raw token is passed to the provider and to nothing else. It is never
 * logged, not even at debug: a reset link in a log file is a takeover waiting
 * for whoever reads the log.
 */
export class NotificationResetDelivery implements ResetDeliveryPort {
  constructor(
    private readonly provider: INotificationProvider,
    private readonly publicBaseUrl: string,
    /**
     * Records the attempt, so "what happened to my reset email?" is a query
     * rather than a log search.
     *
     * This path calls the provider directly instead of going through the
     * outbox, and the outbox worker is what writes attempt rows — so a failed
     * password reset previously left NO row anywhere. Production had a reset
     * refused by the provider with 429 and `notification_attempts` showed
     * nothing at all, which is why the first diagnosis of it was wrong.
     *
     * Optional so existing construction sites keep working; recording is
     * best-effort and must never fail the reset itself.
     */
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

  async sendPasswordReset(input: { email: string; rawToken: string; expiresAt: Date }): Promise<{
    status: 'SENT' | 'FAILED' | 'NOT_CONFIGURED' | 'DRY_RUN' | 'DISABLED';
    detail?: string;
  }> {
    const resetUrl = `${this.publicBaseUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(input.rawToken)}`;

    try {
      const result = await this.provider.dispatch({
        recipient: input.email,
        template: 'password_reset',
        data: {
          resetUrl,
          expiresAtIso: input.expiresAt.toISOString(),
          expiresInMinutes: Math.max(1, Math.round((input.expiresAt.getTime() - Date.now()) / 60000)),
        },
        relatedEntity: 'password_reset',
        // The recipient, not the token: this id ends up in attempt records.
        relatedEntityId: input.email,
      });

      // Pass the provider's own verdict through. Flattening DISABLED into
      // FAILED told the operator delivery had broken when in fact a governance
      // flag was refusing customer email — a different problem with a
      // different fix, and production reported exactly that.
      const status =
        result.status === 'SENT' ||
        result.status === 'DRY_RUN' ||
        result.status === 'NOT_CONFIGURED' ||
        result.status === 'DISABLED'
          ? result.status
          : 'FAILED';

      if (status === 'NOT_CONFIGURED' || status === 'DISABLED') {
        // Loud, because the customer has been told a link is coming and no
        // transport exists to send it. This is an operator problem and it
        // should be visible as one.
        logger.error(
          { template: 'password_reset', status, providerCode: result.providerCode, providerMessage: result.providerMessage },
          status === 'NOT_CONFIGURED'
            ? 'PASSWORD_RESET_DELIVERY_NOT_CONFIGURED'
            : 'PASSWORD_RESET_DELIVERY_BLOCKED_BY_POLICY',
        );
      }

      // Durable, queryable evidence of the attempt. The recipient is the
      // related id — never the token, which appears in nothing but the message
      // body handed to the provider.
      await this.recordAttempt
        ?.execute({
          channel: 'email',
          recipient: input.email,
          template: 'PASSWORD_RESET',
          status,
          providerCode: result.providerCode,
          providerMessage: result.providerMessage,
          relatedEntity: 'password_reset',
          relatedEntityId: null,
        })
        .catch(() => undefined);

      return { status, detail: result.providerMessage };
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        'PASSWORD_RESET_DELIVERY_FAILED',
      );
      return { status: 'FAILED', detail: 'delivery threw' };
    }
  }
}
