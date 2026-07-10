import { describe, it } from 'vitest';
import { readText, assertContains, assertNotContains, assertFileExists, collectReleaseReadinessFiles, assertNoPatternInFiles } from './helpers/phase2UatAssertions';

describe('Phase 2 UAT: Release Readiness', () => {
  it('release-readiness route file exists', () => {
    assertFileExists('apps/api/src/infrastructure/release/SafeReleaseReadinessCheckRunner.ts');
  });

  it('SafeReleaseReadinessCheckRunner source contains an allowlist or supported-check pattern', () => {
    const text = readText('apps/api/src/infrastructure/release/SafeReleaseReadinessCheckRunner.ts');
    assertContains(text, 'getSupportedChecks', 'Safe runner must be allowlist driven');
  });

  it('SafeReleaseReadinessCheckRunner rejects unknown or unsafe checks', () => {
    const text = readText('apps/api/src/infrastructure/release/SafeReleaseReadinessCheckRunner.ts');
    assertContains(text, 'NOT_CONFIGURED', 'Must explicitly reject unsafe checks');
  });

  it('SafeReleaseReadinessCheckRunner does not run git push', () => {
    const text = readText('apps/api/src/infrastructure/release/SafeReleaseReadinessCheckRunner.ts');
    assertNotContains(text, 'git push', 'No pushing allowed');
  });

  it('SafeReleaseReadinessCheckRunner does not run live paid-social delivery', () => {
    const files = collectReleaseReadinessFiles();
    assertNoPatternInFiles(files, /sendLive/, 'No live delivery');
  });

  it('RecordReleaseDecisionUseCase source blocks APPROVED_FOR_CONTROLLED_ACTIVATION on critical FAIL or BLOCKED gates', () => {
    const text = readText('apps/api/tests/unit/release/RecordReleaseDecisionUseCase.test.ts');
    assertContains(text, 'FAIL', 'Must assert failures');
  });

  it('Release Readiness runbook states readiness is not launch', () => {
    const text = readText('docs/measurement-control-tower/RELEASE_READINESS_RUNBOOK.md');
    assertContains(text, 'Launch', 'Runbook must clarify this is not a launch button');
  });
});
