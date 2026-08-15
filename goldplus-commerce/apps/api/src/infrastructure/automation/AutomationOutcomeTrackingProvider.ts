import { IAutomationActionRepository } from '../../application/ports/IAutomationActionRepository';
import {
  INotificationProvider,
  NotificationDispatchPayload,
  NotificationDispatchResult,
} from '../../application/ports/INotificationProvider';

/**
 * The outcomes an automation action can actually END at.
 *
 * Narrower than NotificationStatus on purpose: the lifecycle phases
 * (PENDING/PREPARED/DISPATCH_STARTED/NOT_DISPATCHED) describe a send in
 * progress, and an automation OUTCOME is by definition finished.
 */
type AutomationOutcomeStatus = 'SENT' | 'FAILED' | 'OUTCOME_UNKNOWN' | 'DRY_RUN' | 'NOT_CONFIGURED' | 'DISABLED';
const AUTOMATION_OUTCOME_STATUSES: readonly AutomationOutcomeStatus[] = [
  'SENT', 'FAILED', 'OUTCOME_UNKNOWN', 'DRY_RUN', 'NOT_CONFIGURED', 'DISABLED',
];

const NON_ATTEMPT_FAILURE_CODES = new Set(['INVALID_RECIPIENT']);
const AMBIGUOUS_FAILURE_CODES = new Set(['PROVIDER_ERROR', 'ADAPTER_THREW']);
const PROVIDER_ATTEMPT_LEASE_MS = 5 * 60_000;

/** Records truthful Automation outcomes while delegating transport to the existing provider. */
export class AutomationOutcomeTrackingProvider implements INotificationProvider {
  constructor(
    private readonly delegate: INotificationProvider,
    private readonly outcomes: IAutomationActionRepository,
    private readonly actionExecutionId: string,
    private readonly noSendGuarantee: boolean,
    private readonly noSendStatus: 'DRY_RUN' | 'DISABLED' | 'NOT_CONFIGURED' = 'DISABLED'
  ) {}

  async dispatch(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult> {
    if (this.noSendGuarantee) {
      const result = {
        status: this.noSendStatus,
        providerCode: this.noSendStatus === 'DRY_RUN' ? 'AUTOMATION_DRY_RUN' : 'AUTOMATION_NO_SEND_GUARANTEE',
        providerMessage: 'Automation intent is no-send.',
      };
      await this.outcomes.recordProviderOutcome({ actionExecutionId: this.actionExecutionId, ...result, attempted: false });
      return result;
    }

    const claim = await this.outcomes.claimProviderAttempt({
      actionExecutionId: this.actionExecutionId,
      workerId: `automation-delivery-${process.pid}`,
      now: new Date(),
      leaseMs: PROVIDER_ATTEMPT_LEASE_MS,
    });
    if (claim.outcome === 'BUSY') {
      return { status: 'DISABLED', providerCode: 'AUTOMATION_ATTEMPT_IN_PROGRESS', providerMessage: 'Another delivery attempt owns the active lease.' };
    }
    if (claim.outcome === 'TERMINAL') {
      if (claim.status === 'SENT') {
        return { status: 'SENT', providerCode: 'AUTOMATION_ALREADY_SENT', providerMessage: 'Successful provider evidence is already recorded.' };
      }
      if (claim.status === 'OUTCOME_UNKNOWN') {
        return { status: 'OUTCOME_UNKNOWN', providerCode: 'AUTOMATION_OUTCOME_UNKNOWN', providerMessage: 'Ambiguous provider outcome requires reconciliation.' };
      }
      const terminalStatus = claim.status === 'DRY_RUN' || claim.status === 'NOT_CONFIGURED' || claim.status === 'DISABLED'
        ? claim.status
        : 'DISABLED';
      return { status: terminalStatus, providerCode: 'AUTOMATION_TERMINAL', providerMessage: `Automation action is terminal: ${claim.status}.` };
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
      // An automation OUTCOME is terminal by definition, so the lifecycle
      // phases (PENDING/PREPARED/DISPATCH_STARTED/NOT_DISPATCHED) have no
      // meaning here. No adapter returns one from dispatch(), but the type now
      // admits them, and the honest reading of "a dispatch came back still in
      // flight" is that we cannot prove what happened — which is exactly
      // OUTCOME_UNKNOWN. Fail closed rather than widening an outcome store to
      // hold states it has no way to interpret.
      const terminalStatus = AUTOMATION_OUTCOME_STATUSES.includes(status as AutomationOutcomeStatus)
        ? (status as AutomationOutcomeStatus)
        : 'OUTCOME_UNKNOWN';

      await this.outcomes.recordProviderOutcome({
        actionExecutionId: this.actionExecutionId,
        status: terminalStatus,
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
