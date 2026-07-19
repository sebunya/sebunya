import { IAutomationActionRepository } from '../../application/ports/IAutomationActionRepository';
import {
  INotificationProvider,
  NotificationDispatchPayload,
  NotificationDispatchResult,
} from '../../application/ports/INotificationProvider';

const NON_ATTEMPT_FAILURE_CODES = new Set(['INVALID_RECIPIENT']);
const AMBIGUOUS_FAILURE_CODES = new Set(['PROVIDER_ERROR', 'ADAPTER_THREW']);

/** Records truthful Automation outcomes while delegating transport to the existing provider. */
export class AutomationOutcomeTrackingProvider implements INotificationProvider {
  constructor(
    private readonly delegate: INotificationProvider,
    private readonly outcomes: IAutomationActionRepository,
    private readonly actionExecutionId: string,
    private readonly noSendGuarantee: boolean
  ) {}

  async dispatch(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult> {
    if (this.noSendGuarantee) {
      const result = { status: 'DISABLED' as const, providerCode: 'AUTOMATION_NO_SEND_GUARANTEE', providerMessage: 'Automation intent is no-send.' };
      await this.outcomes.recordProviderOutcome({ actionExecutionId: this.actionExecutionId, ...result, attempted: false });
      return result;
    }

    try {
      const result = await this.delegate.dispatch(payload);
      let status = result.status;
      let attempted = status === 'SENT' || status === 'FAILED';
      if (result.providerCode === 'DRY_RUN_SUCCESS') {
        status = 'DRY_RUN';
        attempted = false;
      } else if (status === 'FAILED' && NON_ATTEMPT_FAILURE_CODES.has(result.providerCode ?? '')) {
        status = 'NOT_CONFIGURED';
        attempted = false;
      } else if (status === 'FAILED' && AMBIGUOUS_FAILURE_CODES.has(result.providerCode ?? '')) {
        status = 'OUTCOME_UNKNOWN';
        attempted = true;
      }
      await this.outcomes.recordProviderOutcome({
        actionExecutionId: this.actionExecutionId,
        status,
        attempted,
        providerCode: result.providerCode,
        providerMessage: result.providerMessage,
      });
      return { ...result, status };
    } catch (error) {
      const result = {
        status: 'OUTCOME_UNKNOWN' as const,
        providerCode: 'ADAPTER_THREW',
        providerMessage: error instanceof Error ? error.message : 'Provider outcome unknown.',
      };
      await this.outcomes.recordProviderOutcome({ actionExecutionId: this.actionExecutionId, ...result, attempted: true });
      return result;
    }
  }
}
