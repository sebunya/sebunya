import { describe, it } from 'vitest';
import { readText, assertContains, assertMatches, assertFileExists } from './helpers/phase2UatAssertions';

describe('Phase 2 UAT: Closeout Documentation Safety', () => {
  it('all required runbooks exist', () => {
    assertFileExists('docs/measurement-control-tower/PHASE_2_CLOSEOUT.md');
    assertFileExists('docs/measurement-control-tower/OPERATIONAL_HANDOVER.md');
    assertFileExists('docs/measurement-control-tower/UAT_EVIDENCE_GUIDE.md');
    assertFileExists('docs/measurement-control-tower/RELEASE_READINESS_RUNBOOK.md');
    assertFileExists('docs/measurement-control-tower/GTM_SAFE_OPERATIONS_RUNBOOK.md');
    assertFileExists('docs/measurement-control-tower/CONSENT_AND_PRIVACY_RUNBOOK.md');
    assertFileExists('docs/measurement-control-tower/PESAPAL_RECONCILIATION_RUNBOOK.md');
    assertFileExists('docs/measurement-control-tower/PRODUCT_FINDER_AND_ZERO_PARTY_DATA_RUNBOOK.md');
    assertFileExists('docs/measurement-control-tower/ADMIN_CONTROL_TOWER_RUNBOOK.md');
    assertFileExists('docs/measurement-control-tower/INCIDENT_RESPONSE_RUNBOOK.md');
    assertFileExists('docs/measurement-control-tower/ROLLBACK_AND_DISABLEMENT_RUNBOOK.md');
  });

  it('PHASE_2_CLOSEOUT.md states GTM publish is not enabled', () => {
    const text = readText('docs/measurement-control-tower/PHASE_2_CLOSEOUT.md');
    assertMatches(text, /not enabled|disabled/i, 'Must clarify what is NOT enabled');
  });

  it('UAT_EVIDENCE_GUIDE.md states what evidence is safe to share', () => {
    const text = readText('docs/measurement-control-tower/UAT_EVIDENCE_GUIDE.md');
    assertContains(text, 'Safe:', 'Must clarify safe sharing');
  });
});
