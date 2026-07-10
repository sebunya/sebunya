import { IReleaseEvidenceRedactor } from '../../application/ports/release/ReleaseEvidenceRedactor';

export class DefaultReleaseEvidenceRedactor implements IReleaseEvidenceRedactor {
  private readonly REPLACEMENTS = [
    { regex: /bearer\s+[a-zA-Z0-9\-._~]+/gi, replacement: 'bearer [REDACTED]' },
    { regex: /api_key=[a-zA-Z0-9\-._~]+/gi, replacement: 'api_key=[REDACTED]' },
    { regex: /(pesapal_consumer_secret|gtm_secret_foo)[=\s]+[a-zA-Z0-9\-_]+/gi, replacement: '$1=[REDACTED]' },
    { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL_REDACTED]' },
    { regex: /(\+?254|0)[71]\d{8}/g, replacement: '[PHONE_REDACTED]' }
  ];

  redactEvidence(evidence: Record<string, any>): Record<string, any> {
    return JSON.parse(this.redactCommandOutput(JSON.stringify(evidence)));
  }

  redactCommandOutput(output: string): string {
    if (!output) return output;
    let redacted = output;
    for (const rule of this.REPLACEMENTS) {
      redacted = redacted.replace(rule.regex, rule.replacement);
    }
    return redacted;
  }

  redactMetadata(metadata: Record<string, any>): Record<string, any> {
    return this.redactEvidence(metadata);
  }
}
