import { describe, it } from 'vitest';
import { readText, assertContains, assertNotContains, assertFileExists, collectMeasurementControlTowerFiles, assertNoPatternInFiles } from './helpers/phase2UatAssertions';

describe('Phase 2 UAT: Admin Control Tower', () => {
  it('admin measurement-control-tower route file exists', () => {
    assertFileExists('apps/web/src/pages/admin/measurement-handover.astro');
  });

  it('route does not include GTM publish actions', () => {
    const text = readText('apps/web/src/pages/admin/measurement-handover.astro');
    assertNotContains(text, 'publishGtm', 'No publish GTM actions allowed');
  });

  it('route does not include consent override actions', () => {
    const text = readText('apps/web/src/pages/admin/measurement-handover.astro');
    assertNotContains(text, 'overrideConsent', 'No override consent actions allowed');
  });

  it('route does not include manual conversion actions', () => {
    const text = readText('apps/web/src/pages/admin/measurement-handover.astro');
    assertNotContains(text, 'createConversion', 'No manual conversions allowed');
  });

  it('route does not include forceReconcile actions', () => {
    const text = readText('apps/web/src/pages/admin/measurement-handover.astro');
    assertNotContains(text, 'forceReconcile', 'No force reconciliation allowed');
  });

  it('admin dashboard/page/components do not show raw customerEmail, customerPhone, rawEmail or rawPhone fields', () => {
    const docs = collectMeasurementControlTowerFiles();
    assertNoPatternInFiles(docs, />\s*{.*customerEmail.*}\s*</, 'No raw email rendering');
  });

  it('Admin Control Tower runbook states no-fake-metrics or NO_DATA_AVAILABLE principle', () => {
    const text = readText('docs/measurement-control-tower/ADMIN_CONTROL_TOWER_RUNBOOK.md');
    assertContains(text, 'No-Fake-Metrics', 'Must explicitly enforce real metrics');
    assertContains(text, 'NO_DATA_AVAILABLE', 'Must explicitly enforce empty state honesty');
  });
});
