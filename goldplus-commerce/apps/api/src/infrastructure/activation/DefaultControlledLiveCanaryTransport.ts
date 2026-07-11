import { ControlledLiveCanaryTransport, CanaryDeliveryAttempt } from '../../application/ports/activation/ControlledLiveCanaryTransport.js';

export class DefaultControlledLiveCanaryTransport implements ControlledLiveCanaryTransport {
  async sendCanary(
    canaryId: string,
    destination: string,
    payloads: any[],
    canaryCap: number
  ): Promise<CanaryDeliveryAttempt> {
    const attemptId = `attempt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Rule: destination must be exactly 'posthog'
    if (destination !== 'posthog') {
      return {
        id: attemptId,
        canaryId,
        destination,
        status: 'FAILED',
        redactedPayloadSummary: 'Destination validation failed: destination must be exactly posthog',
        redactedResponseSummary: 'BLOCKED: destination allowlist mismatch',
        attemptedAt: new Date()
      };
    }

    // Rule: canary cap must be exactly 1
    if (canaryCap !== 1) {
      return {
        id: attemptId,
        canaryId,
        destination,
        status: 'FAILED',
        redactedPayloadSummary: `Cap validation failed: cap was ${canaryCap}`,
        redactedResponseSummary: 'BLOCKED: canary cap mismatch',
        attemptedAt: new Date()
      };
    }

    // Rule: payload count must be exactly 1
    if (payloads.length !== 1) {
      return {
        id: attemptId,
        canaryId,
        destination,
        status: 'FAILED',
        redactedPayloadSummary: `Payload count validation failed: count was ${payloads.length}`,
        redactedResponseSummary: 'BLOCKED: event count mismatch',
        attemptedAt: new Date()
      };
    }

    // Rule: Refuse if payload contains raw PII or keys
    const containsPii = (obj: any): boolean => {
      const piiKeys = ['email', 'phone', 'name', 'address', 'payment_token', 'token', 'secret', 'key'];
      const str = JSON.stringify(obj).toLowerCase();
      
      // Check for PII keywords in keys/values
      if (piiKeys.some(k => str.includes(k))) return true;
      // Check for email or phone-like patterns
      if (/@/.test(str)) return true;
      if (/07\d{8}/.test(str)) return true;
      return false;
    };

    if (containsPii(payloads[0])) {
      return {
        id: attemptId,
        canaryId,
        destination,
        status: 'FAILED',
        redactedPayloadSummary: 'PII validation failed: raw PII or secret keywords found',
        redactedResponseSummary: 'BLOCKED: raw PII or secret keywords detected in payload',
        attemptedAt: new Date()
      };
    }

    // Rule: Verify provider config
    const host = process.env.POSTHOG_HOST;
    const apiKey = process.env.POSTHOG_PROJECT_API_KEY;

    if (!host || !apiKey) {
      return {
        id: attemptId,
        canaryId,
        destination,
        status: 'NOT_CONFIGURED',
        redactedPayloadSummary: 'PostHog credentials check failed',
        redactedResponseSummary: 'NOT_CONFIGURED: missing POSTHOG_HOST or POSTHOG_PROJECT_API_KEY',
        attemptedAt: new Date()
      };
    }

    // Safe payload shape construction
    const safeRefId = `ref-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const posthogPayload = {
      api_key: apiKey,
      event: 'goldplus_controlled_live_canary_smoke',
      distinct_id: `canary-id-${safeRefId}`,
      timestamp: new Date().toISOString(),
      properties: {
        source: 'measurement_control_tower',
        environment: 'controlled_canary',
        event_type: 'diagnostic_canary',
        canary: true,
        canary_cap: 1,
        consent_status: 'granted',
        contains_no_raw_pii: true,
        safe_reference_id: safeRefId
      }
    };

    const targetUrl = host.startsWith('http') ? `${host.replace(/\/$/, '')}/capture/` : `https://${host.replace(/\/$/, '')}/capture/`;

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(posthogPayload)
      });

      const responseStatus = response.status;
      const accepted = responseStatus >= 200 && responseStatus < 300;

      return {
        id: attemptId,
        canaryId,
        destination,
        status: accepted ? 'ACCEPTED' : 'REJECTED',
        redactedPayloadSummary: `PostHog Capture event: goldplus_controlled_live_canary_smoke, distinct_id: canary-id-***, safe_ref: ${safeRefId}`,
        redactedResponseSummary: `PostHog response status: ${responseStatus}, state: ${accepted ? 'ACCEPTED' : 'REJECTED'}, ref: ${safeRefId}`,
        attemptedAt: new Date()
      };
    } catch (e: any) {
      return {
        id: attemptId,
        canaryId,
        destination,
        status: 'FAILED',
        redactedPayloadSummary: `PostHog Capture send failed, safe_ref: ${safeRefId}`,
        redactedResponseSummary: `PostHog capture delivery failed: network error, ref: ${safeRefId}`,
        attemptedAt: new Date()
      };
    }
  }
}
