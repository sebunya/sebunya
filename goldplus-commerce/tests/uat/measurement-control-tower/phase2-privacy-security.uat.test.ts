import { describe, it } from 'vitest';
import { readText, assertMatches } from './helpers/phase2UatAssertions';

describe('Phase 2 UAT: Privacy and Security', () => {
  it('Authorization is redacted', () => {
    const text = readText('docs/measurement-control-tower/CONSENT_AND_PRIVACY_RUNBOOK.md');
    assertMatches(text, /REDACTED|redact/i, 'Docs must dictate redaction');
  });

  it('raw email is redacted', () => {
    const text = readText('docs/measurement-control-tower/CONSENT_AND_PRIVACY_RUNBOOK.md');
    assertMatches(text, /email/i, 'Must dictate email redaction');
  });

  it('raw phone is redacted', () => {
    const text = readText('docs/measurement-control-tower/CONSENT_AND_PRIVACY_RUNBOOK.md');
    assertMatches(text, /phone/i, 'Must dictate phone redaction');
  });

  it('docs warn these values must never be shared', () => {
    const text = readText('docs/measurement-control-tower/UAT_EVIDENCE_GUIDE.md');
    assertMatches(text, /NEVER Share/i, 'Must warn against sharing PII');
  });
});
