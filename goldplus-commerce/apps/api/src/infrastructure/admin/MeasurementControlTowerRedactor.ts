import { IMeasurementControlTowerRedactor } from '../../application/ports/admin/MeasurementControlTowerRedactor';

export class MeasurementControlTowerRedactor implements IMeasurementControlTowerRedactor {
  /**
   * Redacts any raw PII or secrets from measurement event payloads.
   * Replaces sensitive fields with '[REDACTED]'.
   */
  public redactPayload(payload: any): any {
    if (!payload || typeof payload !== 'object') {
      return payload;
    }

    const redacted = { ...payload };

    const sensitiveKeys = [
      'email',
      'customerEmail',
      'rawEmail',
      'phone',
      'customerPhone',
      'rawPhone',
      'authorization',
      'access_token',
      'access-token',
      'refresh_token',
      'refresh-token',
      'client_secret',
      'client-secret',
      'payment_token',
      'payment-token',
    ];

    for (const key of Object.keys(redacted)) {
      // If the key itself contains sensitive terms
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        redacted[key] = '[REDACTED]';
        continue;
      }

      // If it's an object, recurse
      if (typeof redacted[key] === 'object' && redacted[key] !== null) {
        redacted[key] = this.redactPayload(redacted[key]);
      }
    }

    return redacted;
  }
}
