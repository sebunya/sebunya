import type { ConsentOperationsCounters } from '../../ports/consent/ConsentOperationsSummaryRepository';

export type ConsentOperationsStatus = 'green' | 'amber' | 'red';
export type ConsentIncidentSeverity = 'info' | 'warning' | 'critical';

export interface ConsentOperationsFeatureState {
  monitoringEnabled: boolean;
  incidentControlsRequested: boolean;
  safeOperatorStateAvailable: boolean;
  preferenceCentrePilotSaveEnabled: boolean;
  publicSavesEnabled: boolean;
  providerSendsEnabled: boolean;
  customerCommunicationsEnabled: boolean;
  notificationDeliveryEnabled: boolean;
}

export interface ConsentOperationsIncident {
  severity: ConsentIncidentSeverity;
  code: string;
  message: string;
  recommendedAction: string;
}

export interface ConsentOperationsSummary {
  status: ConsentOperationsStatus;
  generatedAt: string;
  pilot: {
    state: 'read_only' | 'paused' | 'pilot_enabled' | 'blocked';
    ring: 'ring_0' | 'ring_1' | 'ring_2' | 'ring_3' | 'unknown';
    publicSavesEnabled: boolean;
    providerSendsEnabled: boolean;
    customerCommunicationsEnabled: boolean;
    incidentControlsEnabled: boolean;
  };
  ledger: {
    totalEvents: number;
    grants: number;
    withdrawals: number;
    providerSuppressions: number;
    policyBlocks: number;
    duplicateLifecycleGroups: number;
    lastEventAt: string | null;
  };
  noSend: {
    providerCallbacks: number;
    providerUnsubscribes: number;
    outboxRows: number;
    notificationAttempts: number;
    transportCalls: number;
  };
  preferenceCentre: {
    publicSavesEnabled: boolean;
    currentMode: 'read_only' | 'save_disabled' | 'pilot_save_enabled' | 'unknown';
    noChangesSavedConfirmed: boolean | null;
  };
  incidents: ConsentOperationsIncident[];
  actions: {
    canPause: boolean;
    canResume: boolean;
    canForceReadOnly: boolean;
    canEnableSends: false;
  };
}

const incident = (
  severity: ConsentIncidentSeverity,
  code: string,
  message: string,
  recommendedAction: string,
): ConsentOperationsIncident => Object.freeze({ severity, code, message, recommendedAction });

const criticalCounterRules: ReadonlyArray<{
  key: keyof Pick<ConsentOperationsCounters, 'providerCallbacks' | 'providerUnsubscribes' | 'outboxRows' | 'notificationAttempts' | 'transportCalls' | 'duplicateLifecycleGroups'>;
  code: string;
  message: string;
}> = [
  { key: 'providerCallbacks', code: 'PROVIDER_CALLBACK_ACTIVITY', message: 'Provider callback activity is present.' },
  { key: 'providerUnsubscribes', code: 'PROVIDER_UNSUBSCRIBE_ACTIVITY', message: 'Provider unsubscribe activity is present.' },
  { key: 'outboxRows', code: 'OUTBOX_ACTIVITY', message: 'Outbox activity is present.' },
  { key: 'notificationAttempts', code: 'NOTIFICATION_ATTEMPT_ACTIVITY', message: 'Notification attempt activity is present.' },
  { key: 'transportCalls', code: 'TRANSPORT_ACTIVITY', message: 'Provider transport activity is present.' },
  { key: 'duplicateLifecycleGroups', code: 'DUPLICATE_CONSENT_LIFECYCLE', message: 'Duplicate consent lifecycle groups were detected.' },
] as const;

export function readConsentOperationsFeatureState(
  source: Readonly<Record<string, string | undefined>> = process.env,
): ConsentOperationsFeatureState {
  const enabled = (name: string) => source[name]?.trim().toLowerCase() === 'true';
  return Object.freeze({
    monitoringEnabled: enabled('CONSENT_OPERATIONS_MONITORING_ENABLED'),
    incidentControlsRequested: enabled('CONSENT_INCIDENT_CONTROLS_ENABLED'),
    safeOperatorStateAvailable: false,
    preferenceCentrePilotSaveEnabled: enabled('CONSENT_PREFERENCE_CENTRE_SAVE_ENABLED'),
    publicSavesEnabled: enabled('CONSENT_PUBLIC_SAVES_ENABLED'),
    providerSendsEnabled: enabled('CONSENT_PROVIDER_LIVE_SENDS_ENABLED') || enabled('PROVIDER_DELIVERY_ENABLED'),
    customerCommunicationsEnabled: enabled('CUSTOMER_COMMUNICATIONS_ENABLED'),
    notificationDeliveryEnabled: enabled('NOTIFICATION_DELIVERY_ENABLED'),
  });
}

export class ConsentOperationsSummaryService {
  evaluate(
    counters: Readonly<ConsentOperationsCounters>,
    features: Readonly<ConsentOperationsFeatureState>,
    generatedAt: string,
  ): ConsentOperationsSummary {
    const incidents: ConsentOperationsIncident[] = [];

    for (const rule of criticalCounterRules) {
      if (counters[rule.key] > 0) {
        incidents.push(incident('critical', rule.code, rule.message, 'Force read-only posture, preserve evidence, and escalate before any further pilot activity.'));
      }
    }
    if (features.providerSendsEnabled) incidents.push(incident('critical', 'PROVIDER_SENDS_ENABLED', 'A provider delivery gate is enabled.', 'Disable provider delivery and escalate immediately.'));
    if (features.customerCommunicationsEnabled) incidents.push(incident('critical', 'CUSTOMER_COMMUNICATIONS_ENABLED', 'Customer communications are enabled.', 'Disable customer communications and escalate immediately.'));
    if (features.notificationDeliveryEnabled) incidents.push(incident('critical', 'NOTIFICATION_DELIVERY_ENABLED', 'Notification delivery is enabled.', 'Disable notification delivery and escalate immediately.'));
    if (features.publicSavesEnabled) incidents.push(incident('critical', 'PUBLIC_PREFERENCE_SAVES_ENABLED', 'Public Preference Centre saves are enabled outside the controlled pilot.', 'Disable public saves and force the Preference Centre to read-only.'));
    if (features.incidentControlsRequested && !features.safeOperatorStateAvailable) {
      incidents.push(incident('critical', 'INCIDENT_CONTROLS_PERSISTENCE_UNAVAILABLE', 'Incident controls were requested without a safe operator-state store.', 'Keep controls disabled and follow the manual incident runbook.'));
    }
    if (features.preferenceCentrePilotSaveEnabled && counters.lastEventAt === null) {
      incidents.push(incident('warning', 'PILOT_EVENT_TIMESTAMP_UNAVAILABLE', 'The pilot save gate is enabled but no consent event timestamp is available.', 'Pause pilot activity and verify the ledger source before resuming.'));
    }
    if (!features.monitoringEnabled) {
      incidents.push(incident('info', 'MONITORING_GATE_DISABLED', 'The monitoring feature gate is disabled; this protected read-only snapshot remains available.', 'Enable monitoring only through an approved configuration change.'));
    }

    const status: ConsentOperationsStatus = incidents.some(item => item.severity === 'critical')
      ? 'red'
      : incidents.some(item => item.severity === 'warning')
        ? 'amber'
        : 'green';
    const incidentControlsEnabled = features.incidentControlsRequested && features.safeOperatorStateAvailable;
    const pilotState = features.publicSavesEnabled
      ? 'blocked' as const
      : features.preferenceCentrePilotSaveEnabled
        ? 'pilot_enabled' as const
        : 'read_only' as const;
    const preferenceMode = features.publicSavesEnabled
      ? 'unknown' as const
      : features.preferenceCentrePilotSaveEnabled
        ? 'pilot_save_enabled' as const
        : 'read_only' as const;

    return Object.freeze({
      status,
      generatedAt,
      pilot: Object.freeze({
        state: pilotState,
        ring: features.preferenceCentrePilotSaveEnabled ? 'ring_1' : 'ring_2',
        publicSavesEnabled: features.publicSavesEnabled,
        providerSendsEnabled: features.providerSendsEnabled,
        customerCommunicationsEnabled: features.customerCommunicationsEnabled,
        incidentControlsEnabled,
      }),
      ledger: Object.freeze({
        totalEvents: counters.totalEvents,
        grants: counters.grants,
        withdrawals: counters.withdrawals,
        providerSuppressions: counters.providerSuppressions,
        policyBlocks: counters.policyBlocks,
        duplicateLifecycleGroups: counters.duplicateLifecycleGroups,
        lastEventAt: counters.lastEventAt,
      }),
      noSend: Object.freeze({
        providerCallbacks: counters.providerCallbacks,
        providerUnsubscribes: counters.providerUnsubscribes,
        outboxRows: counters.outboxRows,
        notificationAttempts: counters.notificationAttempts,
        transportCalls: counters.transportCalls,
      }),
      preferenceCentre: Object.freeze({
        publicSavesEnabled: features.publicSavesEnabled,
        currentMode: preferenceMode,
        noChangesSavedConfirmed: features.preferenceCentrePilotSaveEnabled ? null : !features.publicSavesEnabled,
      }),
      incidents: Object.freeze(incidents) as ConsentOperationsIncident[],
      actions: Object.freeze({
        canPause: false,
        canResume: false,
        canForceReadOnly: false,
        canEnableSends: false as const,
      }),
    });
  }

  counterSourceUnavailable(features: Readonly<ConsentOperationsFeatureState>, generatedAt: string): ConsentOperationsSummary {
    const empty: ConsentOperationsCounters = {
      totalEvents: 0,
      grants: 0,
      withdrawals: 0,
      providerSuppressions: 0,
      policyBlocks: 0,
      duplicateLifecycleGroups: 0,
      lastEventAt: null,
      providerCallbacks: 0,
      providerUnsubscribes: 0,
      outboxRows: 0,
      notificationAttempts: 0,
      transportCalls: 0,
    };
    const summary = this.evaluate(empty, features, generatedAt);
    return Object.freeze({
      ...summary,
      status: 'red',
      incidents: Object.freeze([
        incident('critical', 'COUNTER_SOURCE_UNAVAILABLE', 'Consent operations counters are unavailable.', 'Keep all writes and sends disabled; restore the read-only counter source and escalate.'),
        ...summary.incidents,
      ]) as ConsentOperationsIncident[],
      actions: Object.freeze({ canPause: false, canResume: false, canForceReadOnly: false, canEnableSends: false as const }),
    });
  }
}
